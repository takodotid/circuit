// Tested on a CE6855 on V200R005C00SPC800 with unreachable servers. Each plan was committed with `commit trial`, the switch's own user logged in again, and the next plan was empty. Then the plan that takes it away was committed, and the plan after it was empty too. The adapter gets what the switch printed, its keys redacted by the read.

import { expect, test } from "bun:test";
import type { Aaa } from "../../src/config/system";
import type { Device } from "../../src/model";
import { LineDiff } from "../../src/platforms/line-diff";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const key = { secret: "AAA_KEY" } as const;
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

function withAaa(aaa: Aaa | undefined): Device {
    const device = Fixtures.device("single-site--switch");
    return { ...device, system: { ...device.system, aaa } };
}

const radius: Aaa = {
    radius: [
        { address: "192.0.2.10", secret_key: key, source_address: "192.168.10.2" },
        { address: "198.51.100.10", secret_key: key, source_address: "192.168.10.2" },
        { address: "192.0.2.20", secret_key: key, auth_port: 11812, acct_port: 11813 },
    ],
    remote_role: "read-only",
    accounting_events: ["login"],
};

const tacacs: Aaa = {
    tacacs: [
        { address: "192.0.2.10", secret_key: key, source_address: "192.168.10.2" },
        { address: "198.51.100.10", secret_key: key, source_address: "192.168.10.2" },
    ],
    remote_role: "admin",
    accounting_events: ["login", "command"],
};

const without = vrp.render(withAaa(undefined));
const users = " local-user operator level 3\n";

/** `without` as the switch prints it, with its own schemes and domains. */
const printedWithout = without.replace(
    users,
    `${users} #\n authentication-scheme default\n #\n domain default\n #\n domain default_admin\n`
);

/** `without` as the switch printed it with the servers' block and the lines of the AAA view in place. */
function printed(servers: string, schemes: string, domain: string, after = ""): string {
    return without
        .replace("aaa\n", `${servers}#\naaa\n`)
        .replace(
            users,
            `${users} #\n authentication-scheme default\n${schemes} domain default\n #\n domain default_admin\n${domain}${after}`
        );
}

const printedRadius = printed(
    "radius enable\n#\nradius server group circuit\n radius server authentication 192.0.2.10 1812 source ip-address 192.168.10.2 shared-key-cipher <redacted>\n radius server authentication 198.51.100.10 1812 source ip-address 192.168.10.2 shared-key-cipher <redacted> secondary\n radius server authentication 192.0.2.20 11812 shared-key-cipher <redacted> secondary\n radius server accounting 192.0.2.10 1813 source ip-address 192.168.10.2 shared-key-cipher <redacted>\n radius server accounting 198.51.100.10 1813 source ip-address 192.168.10.2 shared-key-cipher <redacted> secondary\n radius server accounting 192.0.2.20 11813 shared-key-cipher <redacted> secondary\n radius server user-name domain-excluded\n",
    " #\n authentication-scheme circuit\n  authentication-mode local radius\n #\n authorization-scheme default\n #\n accounting-scheme default\n #\n accounting-scheme circuit\n  accounting-mode radius\n #\n",
    "  authentication-scheme circuit\n  accounting-scheme circuit\n  adminuser-priority 1\n  radius server group circuit\n"
);

const printedTacacs = printed(
    "hwtacacs enable\n#\nhwtacacs server template circuit\n hwtacacs server 192.0.2.10 shared-key cipher <redacted>\n hwtacacs server 198.51.100.10 shared-key cipher <redacted> secondary\n hwtacacs server source-ip 192.168.10.2\n hwtacacs server user-name domain-excluded\n",
    " #\n authentication-scheme circuit\n  authentication-mode local hwtacacs\n #\n authorization-scheme default\n #\n authorization-scheme circuit\n  authorization-mode local hwtacacs if-authenticated\n #\n accounting-scheme default\n #\n accounting-scheme circuit\n  accounting-mode hwtacacs\n #\n",
    "  authentication-scheme circuit\n  authorization-scheme circuit\n  accounting-scheme circuit\n  adminuser-priority 3\n  hwtacacs server circuit\n",
    " #\n recording-scheme circuit\n  recording-mode hwtacacs circuit\n #\n cmd recording-scheme circuit\n"
);

test("VRP checks its own users first, then the RADIUS servers in order, for administrators who log in without a domain", () => {
    const desired = vrp.render(withAaa(radius));

    // The switch keeps its own domains.
    expect(sent(without, printedWithout)).toEqual([]);
    expect(sent(desired, printedWithout)).toEqual([
        "radius server group circuit",
        "radius server authentication 192.0.2.10 1812 source ip-address 192.168.10.2 shared-key-cipher <secret:AAA_KEY>",
        "radius server authentication 198.51.100.10 1812 source ip-address 192.168.10.2 shared-key-cipher <secret:AAA_KEY> secondary",
        "radius server authentication 192.0.2.20 11812 shared-key-cipher <secret:AAA_KEY> secondary",
        "radius server accounting 192.0.2.10 1813 source ip-address 192.168.10.2 shared-key-cipher <secret:AAA_KEY>",
        "radius server accounting 198.51.100.10 1813 source ip-address 192.168.10.2 shared-key-cipher <secret:AAA_KEY> secondary",
        "radius server accounting 192.0.2.20 11813 shared-key-cipher <secret:AAA_KEY> secondary",
        "radius server user-name domain-excluded",
        "quit",
        "aaa",
        "authentication-scheme circuit",
        "authentication-mode local radius",
        "quit",
        "quit",
        "aaa",
        "accounting-scheme circuit",
        "accounting-mode radius",
        "quit",
        "quit",
        "aaa",
        "domain default_admin",
        "authentication-scheme circuit",
        "accounting-scheme circuit",
        "radius server group circuit",
        "adminuser-priority 1",
        "quit",
        "quit",
        "radius enable",
    ]);

    expect(sent(desired, printedRadius)).toEqual([]);
    expect(vrp.unsupported(withAaa(radius))).toEqual([]);
});

test("VRP's domain lets go of the schemes and servers by keyword before they go", () => {
    expect(sent(without, printedRadius)).toEqual([
        "aaa",
        "domain default_admin",
        "undo radius server group",
        "undo adminuser-priority",
        "undo accounting-scheme",
        "undo authentication-scheme",
        "quit",
        "quit",
        "aaa",
        "undo accounting-scheme circuit",
        "undo authentication-scheme circuit",
        "quit",
        "undo radius server group circuit",
        "undo radius enable",
    ]);
});

test("VRP sends every server of the group again, in order, when one changes, and undoes the secondaries before the primary", () => {
    const changed: Aaa = { ...radius, radius: [radius.radius![0]!, radius.radius![2]!], accounting_events: undefined };

    expect(sent(vrp.render(withAaa(changed)), printedRadius)).toEqual([
        "aaa",
        "domain default_admin",
        "undo accounting-scheme",
        "quit",
        "quit",
        "radius server group circuit",
        "undo radius server authentication 198.51.100.10 1812 source ip-address 192.168.10.2 secondary",
        "undo radius server authentication 192.0.2.20 11812 secondary",
        "undo radius server accounting 198.51.100.10 1813 source ip-address 192.168.10.2 secondary",
        "undo radius server accounting 192.0.2.20 11813 secondary",
        "undo radius server authentication",
        "undo radius server accounting",
        "radius server authentication 192.0.2.10 1812 source ip-address 192.168.10.2 shared-key-cipher <secret:AAA_KEY>",
        "radius server authentication 192.0.2.20 11812 shared-key-cipher <secret:AAA_KEY> secondary",
        "quit",
        "aaa",
        "undo accounting-scheme circuit",
        "quit",
    ]);
});

test("VRP authorizes TACACS+ users through the server and records their commands, after the recording scheme exists", () => {
    const desired = vrp.render(withAaa(tacacs));
    const steps = sent(desired, printedWithout);

    expect(steps).toEqual(
        expect.arrayContaining([
            "hwtacacs server 192.0.2.10 shared-key cipher <secret:AAA_KEY>",
            "hwtacacs server 198.51.100.10 shared-key cipher <secret:AAA_KEY> secondary",
            "hwtacacs server source-ip 192.168.10.2",
            "authorization-mode local hwtacacs if-authenticated",
            "recording-mode hwtacacs circuit",
            "hwtacacs server circuit",
            "adminuser-priority 3",
        ])
    );
    expect(steps.slice(-4)).toEqual(["aaa", "cmd recording-scheme circuit", "quit", "hwtacacs enable"]);
    expect(sent(desired, printedTacacs)).toEqual([]);

    expect(sent(without, printedTacacs)).toEqual([
        "aaa",
        "undo cmd recording-scheme",
        "quit",
        "aaa",
        "domain default_admin",
        "undo hwtacacs server",
        "undo adminuser-priority",
        "undo accounting-scheme",
        "undo authorization-scheme",
        "undo authentication-scheme",
        "quit",
        "quit",
        "aaa",
        "undo recording-scheme circuit",
        "undo accounting-scheme circuit",
        "undo authorization-scheme circuit",
        "undo authentication-scheme circuit",
        "quit",
        "undo hwtacacs server template circuit",
        "undo hwtacacs enable",
    ]);
});

test("VRP refuses command accounting over RADIUS, TACACS+ servers sending from different addresses, and IPv6 servers", () => {
    const refused = vrp.unsupported(
        withAaa({ ...radius, radius: [{ address: "2001:db8::10", secret_key: key }], accounting_events: ["command"] })
    );
    expect(refused).toEqual([
        "system.aaa.accounting_events command, the platform records commands through TACACS+ only",
        "system.aaa.radius[0].address, IPv6 is not tested",
    ]);

    const sources = withAaa({ ...tacacs, tacacs: [tacacs.tacacs![0]!, { address: "198.51.100.10", secret_key: key }] });
    expect(vrp.unsupported(sources)).toEqual([
        "system.aaa.tacacs source_address, the platform sends to every server from one address: write the same on each",
    ]);
});

test("the read redacts a RADIUS or TACACS+ key the switch prints", () => {
    expect(LineDiff.scrub(" radius server authentication 192.0.2.10 1812 shared-key-cipher %^%#abc%^%# secondary\n")).toBe(
        " radius server authentication 192.0.2.10 1812 shared-key-cipher <redacted> secondary\n"
    );
    expect(LineDiff.scrub(" hwtacacs server 192.0.2.10 shared-key cipher %^%#abc%^%#\n")).toBe(
        " hwtacacs server 192.0.2.10 shared-key cipher <redacted>\n"
    );
});
