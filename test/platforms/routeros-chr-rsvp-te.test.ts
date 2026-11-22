// RSVP-TE (RFC 3209) on the three CHRs of the devices workflow, linked in a triangle. OSPF carries the loopbacks and each link's bandwidth (RFC 3630), and LDP sets up a pseudowire from pe-01 to pe-02. A tunnel carries it along an explicit path through p-01, then along the direct link CSPF computes. A tunnel that reserves more than a link has stays down. The tests run in order.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const firstPeChr = process.env.CIRCUIT_TEST_CHR;
const pChr = process.env.CIRCUIT_TEST_CHR_B;
const secondPeChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-rsvp-te-")));

/** A test applies to three routers, and waits for OSPF, LDP, the tunnel, and the pseudowire. */
const TEST_MS = 300_000;

/** How long OSPF, LDP, a tunnel, and a pseudowire have to come up, or a tunnel to go. */
const WAIT_MS = 90_000;

const POLL_MS = 3000;

/** How long a tunnel that can't reserve its bandwidth is watched, to see that it stays down. */
const STAYS_DOWN_MS = 30_000;

/** The pings sent across the pseudowire, whose frames p-01 counts when the tunnel crosses it. */
const PINGS = 100;

/** How many of them must come back: the first few can be lost while the far PE learns where to send its replies. */
const ENOUGH_BACK = 90;

/** Seconds between those pings. */
const PING_INTERVAL = 0.02;

/** How long apart a counter is read until it stops rising, and how often at most: a CHR counts packets a moment after they leave. */
const COUNTER_SETTLE_MS = 2000;
const COUNTER_READS = 5;

/** The MTU of a VLAN interface on a bridge where a pseudowire runs, which RouterOS lowers it to (TRAPS.md). */
const VLAN_MTU = 1496;

/** The bandwidth each link lets tunnels reserve, what the tunnel reserves, and more than any link has. */
const LINK_BANDWIDTH = "10M";
const TUNNEL_BANDWIDTH = "1M";
const TOO_MUCH = "20M";

/** The pseudowire's VLAN and PW ID. */
const VPWS = { id: 201, pw: 201 };

/** One router of the lab: its name, CHR, management network, loopback, its address on each link, and in the pseudowire's VLAN. */
type Router = {
    name: string;
    chr: string;
    management: string;
    loopback: string;
    links: Record<string, string>;
    vpws?: string;
};

const FIRST_PE: Router = {
    name: "pe-01",
    chr: firstPeChr!,
    management: "10.0.0",
    loopback: "192.0.2.101",
    links: { "virtual-2": "192.0.2.17", "virtual-3": "192.0.2.21" },
    vpws: "203.0.113.1",
};
const P: Router = {
    name: "p-01",
    chr: pChr!,
    management: "10.0.1",
    loopback: "192.0.2.102",
    links: { "virtual-2": "192.0.2.18", "virtual-3": "192.0.2.25" },
};
const SECOND_PE: Router = {
    name: "pe-02",
    chr: secondPeChr!,
    management: "10.0.2",
    loopback: "192.0.2.103",
    links: { "virtual-2": "192.0.2.22", "virtual-3": "192.0.2.26" },
    vpws: "203.0.113.2",
};
const ROUTERS = [P, SECOND_PE, FIRST_PE];

/** The explicit path: strict to p-01, then strict to pe-02, each by its address on the link from the router before. */
const THROUGH_P = [
    { address: P.links["virtual-2"]!, hop_type: "strict" },
    { address: SECOND_PE.links["virtual-3"]!, hop_type: "strict" },
];

/** The tunnel pe-01 starts: how it finds its path, and what it reserves. */
type Tunnel = { path: "explicit" | "cspf"; bandwidth: string };

/** What the lab runs on its links: nothing, OSPF and LDP with the pseudowire, or RSVP-TE and OSPF's traffic engineering as well. */
type Mode = "bare" | "ldp" | "te";

/** Runs Circuit from the sources in the lab project, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, OPERATOR_PASSWORD: password },
    });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ circuit ${args.join(" ")}\n${output}`);
    return { status: run.status, output };
}

/** Whether `check` holds within `WAIT_MS`, asking every `POLL_MS`. */
function eventually(check: () => boolean, within = WAIT_MS): boolean {
    const deadline = Date.now() + within;
    while (!check()) {
        if (Date.now() > deadline) return false;
        Bun.sleepSync(POLL_MS);
    }
    return true;
}

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** A router of the lab, running what `mode` says, and pe-01's tunnel to pe-02 when `tunnel`. */
function writeRouter(router: Router, mode: Mode, tunnel?: Tunnel): void {
    const te = mode === "te";
    const [host, port] = router.chr.split(":");
    const links = Object.keys(router.links);
    const ports = Object.entries(router.links)
        .map(([link, address]) => `"${link}": { description: "lab link", addresses: ["${address}/30"] },`)
        .join("\n            ");
    const ospf = links.map((link) => `"${link}": { network: "point-to-point" },`).join(" ");
    const far = router === FIRST_PE ? SECOND_PE : FIRST_PE;
    const vpws =
        router.vpws && mode !== "bare"
            ? {
                  vlan: `switching: { vlans: { vpws: { id: ${VPWS.id} } } },`,
                  interfaces: `vlan_interface: { "vlan-vpws": { vlan: "vpws", mtu: ${VLAN_MTU}, addresses: ["${router.vpws}/26"] } },
        pseudowire: { "pw-vpws": { peer: "${far.loopback}", pw_id: ${VPWS.pw}, access_vlan: "vpws" } },`,
              }
            : { vlan: "", interfaces: "" };
    const path = tunnel?.path === "cspf" ? "cspf: true" : `explicit_path: ${JSON.stringify(THROUGH_P)}`;
    const tunnels = tunnel
        ? `tunnels: { "pe-02": { destination: "${SECOND_PE.loopback}", bandwidth: "${tunnel.bandwidth}", ${path} } },`
        : "";
    const rsvpTe = te
        ? `rsvp_te: { interfaces: { ${links.map((link) => `"${link}": { bandwidth: "${LINK_BANDWIDTH}" }`).join(", ")} }, ${tunnels} },`
        : "";
    const routing =
        mode === "bare"
            ? ""
            : `routing: {
        router_id: "${router.loopback}",
        ospf: { areas: { "0.0.0.0": { ${te ? "traffic_engineering: true," : ""} interfaces: { loopback: { passive: true }, ${ospf} } } } },
        mpls: {
            ldp: { lsr_id: "${router.loopback}", interfaces: ${JSON.stringify(links)} },
            ${rsvpTe}
        },
    },`;
    write(
        `sites/lab/${router.name}.ts`,
        `import { lab } from "../../circuit";

export default lab.device({
    name: "${router.name}",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["${router.management}.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${router.management}.1/24"] },
            ${ports}
        },
        loopback: { loopback: { addresses: ["${router.loopback}/32"] } },
        ${vpws.interfaces}
    },
    ${vpws.vlan}
    ${routing}
});
`
    );
}

/** The three routers, running what `mode` says, and pe-01's `tunnel`. */
function writeLab(mode: Mode, tunnel?: Tunnel): void {
    for (const router of ROUTERS) writeRouter(router, mode, router === FIRST_PE ? tunnel : undefined);
}

/** How many times the router's routing process failed, by its log: RouterOS writes `supout.rif` again each time. */
function crashes(device: string): number {
    const output = exec(device, `:put [:len [/log find where message~"supout.rif file generated"]]`);
    return Number(/^(\d+)\s*$/m.exec(output)?.[1] ?? Number.NaN);
}

/** Applies to each router of `routers`, and finds that none of their routing processes failed meanwhile. */
function applyWithoutCrash(routers: readonly Router[]): void {
    const before = routers.map(({ name }) => crashes(name));
    apply(routers);
    expect(routers.map(({ name }) => crashes(name))).toEqual(before);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** The next hop pe-01's tunnel to pe-02 forwards on, while it forwards, from `forwarding-on="primary, Iface=ether2, Nexthop=192.0.2.18, Label=16"`. Flagged `F` when it forwards. */
function tunnelNextHop(): string | undefined {
    const output = exec("pe-01", "/mpls traffic-eng tunnel print detail without-paging");
    if (!/^\s*\d+\s+F\s+name="pe-02"/m.test(output)) return undefined;
    return /forwarding-on="[^"]*Nexthop=(\d+\.\d+\.\d+\.\d+)/.exec(output)?.[1];
}

/** The tunnel the pseudowire to pe-02 crosses, and the next hop and label it leaves with, as `/interface vpls monitor` prints them: `te-tunnel: pe-02` and `nexthops: { label=16; nh=192.0.2.18; interface=ether2 }`. */
function pseudowirePath(): { tunnel?: string; nextHop?: string } {
    const output = exec("pe-01", "/interface vpls monitor pw-vpws once");
    return { tunnel: /te-tunnel:\s*(\S+)/.exec(output)?.[1], nextHop: /nh=(\d+\.\d+\.\d+\.\d+)/.exec(output)?.[1] };
}

/** The packets p-01 has sent toward pe-02. */
function sentTowardSecondPe(): number {
    const output = exec("p-01", ":put [/interface get [find default-name=ether3] tx-packet]");
    return Number(/^(\d+)\s*$/m.exec(output)?.[1] ?? Number.NaN);
}

/** The packets p-01 has sent toward pe-02, once its counter stops rising. */
function settledSentTowardSecondPe(): number {
    let last = sentTowardSecondPe();
    for (let read = 0; read < COUNTER_READS; read++) {
        Bun.sleepSync(COUNTER_SETTLE_MS);
        const now = sentTowardSecondPe();
        if (now === last) return now;
        last = now;
    }
    return last;
}

/** How many of `PINGS` pings across the pseudowire came back, and how many packets p-01 sent toward pe-02 meanwhile. */
function pingAcross(): { received: number; crossedP: number } {
    const before = settledSentTowardSecondPe();
    const output = exec("pe-01", `:put [/ping ${SECOND_PE.vpws} count=${PINGS} interval=${PING_INTERVAL}]`);
    const received = Number(/^(\d+)\s*$/m.exec(output)?.[1] ?? 0);
    return { received, crossedP: settledSentTowardSecondPe() - before };
}

/** What each router holds of RSVP-TE, for the job's log. */
function logTe(): void {
    for (const { name } of ROUTERS)
        exec(
            name,
            "/mpls traffic-eng export",
            "/mpls traffic-eng tunnel print detail without-paging",
            "/mpls traffic-eng flow print detail without-paging",
            "/mpls traffic-eng interface print detail without-paging",
            "/interface vpls monitor [find] once"
        );
}

/** Applies to each router of `routers`, and finds nothing to change after. */
function apply(routers: readonly Router[] = ROUTERS): void {
    for (const { name } of routers) {
        // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
        circuit("diff", name);
        expect(circuit("apply", name, "--confirm").status).toBe(0);
        expect(circuit("diff", name).status).toBe(0);
    }
}

describe.skipIf(!pChr || !firstPeChr || !secondPeChr)("RSVP-TE between three CHRs", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked in a triangle." } } });\n`);
        writeLab("te", { path: "explicit", bandwidth: TUNNEL_BANDWIDTH });
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "pe-01's tunnel to pe-02 follows its explicit path through p-01, and the pseudowire's frames cross it by label",
        () => {
            apply();
            const up = eventually(() => tunnelNextHop() === P.links["virtual-2"]);
            logTe();
            expect(up).toBe(true);

            let path = pseudowirePath();
            expect(
                eventually(() => {
                    path = pseudowirePath();
                    return path.tunnel === "pe-02" && path.nextHop === P.links["virtual-2"];
                })
            ).toBe(true);
            expect(exec("p-01", "/mpls forwarding-table print detail without-paging")).toContain("type=traffic-eng");

            let crossing = { received: 0, crossedP: 0 };
            expect(
                eventually(() => {
                    crossing = pingAcross();
                    return crossing.received >= ENOUGH_BACK;
                })
            ).toBe(true);
            // Each ping that came back crossed p-01 on its way.
            expect(crossing.crossedP).toBeGreaterThanOrEqual(crossing.received);

            // The tunnel's own state, which the export leaves out, changes nothing to plan.
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "with cspf, the tunnel takes the direct link to pe-02, and the pseudowire's frames no longer cross p-01",
        () => {
            writeLab("te", { path: "cspf", bandwidth: TUNNEL_BANDWIDTH });
            apply([FIRST_PE]);
            const direct = eventually(() => tunnelNextHop() === SECOND_PE.links["virtual-2"]);
            logTe();
            expect(direct).toBe(true);
            expect(eventually(() => pseudowirePath().nextHop === SECOND_PE.links["virtual-2"])).toBe(true);

            let crossing = { received: 0, crossedP: 0 };
            expect(
                eventually(() => {
                    crossing = pingAcross();
                    return crossing.received >= ENOUGH_BACK;
                })
            ).toBe(true);
            // p-01 sent only its own packets meanwhile, such as hellos, far fewer than the pings.
            expect(crossing.crossedP).toBeLessThan(crossing.received / 2);
        },
        TEST_MS
    );

    test(
        "a tunnel that reserves more than any link has stays down, computed or explicit, and comes up once it fits",
        () => {
            for (const path of ["cspf", "explicit"] as const) {
                writeLab("te", { path, bandwidth: TOO_MUCH });
                apply([FIRST_PE]);
                expect(eventually(() => tunnelNextHop() === undefined)).toBe(true);
                Bun.sleepSync(STAYS_DOWN_MS);
                logTe();
                expect(tunnelNextHop()).toBeUndefined();
            }

            writeLab("te", { path: "explicit", bandwidth: TUNNEL_BANDWIDTH });
            apply([FIRST_PE]);
            expect(eventually(() => tunnelNextHop() === P.links["virtual-2"])).toBe(true);
        },
        TEST_MS
    );

    test(
        "without RSVP-TE in the config, each apply removes it, and OSPF's traffic engineering with it, with no crash",
        () => {
            writeLab("ldp");
            applyWithoutCrash([FIRST_PE, P, SECOND_PE]);
            for (const { name } of ROUTERS) {
                expect(exec(name, "/mpls traffic-eng export")).not.toMatch(/^add /m);
                expect(exec(name, "/routing ospf instance export")).not.toContain("mpls-te");
            }
        },
        TEST_MS
    );

    test(
        "without OSPF and MPLS in the config, each apply removes OSPF with its traffic engineering, with no crash",
        () => {
            writeLab("te", { path: "cspf", bandwidth: TUNNEL_BANDWIDTH });
            apply();
            expect(eventually(() => tunnelNextHop() === SECOND_PE.links["virtual-2"])).toBe(true);

            writeLab("bare");
            applyWithoutCrash([FIRST_PE, P, SECOND_PE]);
            for (const { name } of ROUTERS) expect(exec(name, "/routing ospf export", "/mpls traffic-eng export")).not.toMatch(/^add /m);
        },
        TEST_MS
    );
});
