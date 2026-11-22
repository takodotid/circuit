// An RSVP-TE tunnel's options on the three CHRs of the devices workflow, linked in a triangle. pe-01's tunnel to pe-02 carries a pseudowire through p-01, and moves to a secondary path while p-01's link to pe-02 is down. Then a tunnel of a higher priority takes the bandwidth of a lower one. The tests run in order.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-rsvp-te-options-")));

/** A test applies to up to three routers, and waits for tunnels to come up, move, or go down. */
const TEST_MS = 420_000;

/** How long a tunnel has to come up or move. CSPF waits for OSPF to tell it the links' bandwidth, which took 93 s after a boot. */
const WAIT_MS = 180_000;

const POLL_MS = 3000;

/** How long a tunnel that lost its bandwidth is watched, to see that it stays down. */
const STAYS_DOWN_MS = 30_000;

/** The pings sent across the pseudowire, and how many must come back: the first few can be lost while the far PE learns where to send its replies. */
const PINGS = 100;
const ENOUGH_BACK = 90;
const PING_INTERVAL = 0.02;

/** The MTU of a VLAN interface on a bridge where a pseudowire runs, which RouterOS lowers it to (TRAPS.md). */
const VLAN_MTU = 1496;

/** The bandwidth each link lets tunnels reserve, what a tunnel reserves, and what two tunnels reserve that one link can't hold together. */
const LINK_BANDWIDTH = "10M";
const TUNNEL_BANDWIDTH = "1M";
const HALF_AND_MORE = "6M";

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

/** The next hops of pe-01's tunnels: p-01, or pe-02 across the direct link. */
const VIA_P = P.links["virtual-2"]!;
const DIRECT = SECOND_PE.links["virtual-2"]!;

/** Through p-01, strict to it and then to pe-02, each by its address on the link from the router before. */
const THROUGH_P = [
    { address: VIA_P, hop_type: "strict" },
    { address: SECOND_PE.links["virtual-3"]!, hop_type: "strict" },
];
const STRAIGHT = [{ address: DIRECT, hop_type: "strict" }];

/** What the lab runs: pe-01's tunnels, written as in a device file, and p-01's link to pe-02 down when `cut`. */
type Lab = { tunnels?: string; cut?: boolean };

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

/** Whether `check` holds within `within`, asking every `POLL_MS`. */
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

/** A router of the lab, as `lab` says. A link p-01 leaves out is a port Circuit disables. */
function writeRouter(router: Router, { tunnels, cut }: Lab): void {
    const [host, port] = router.chr.split(":");
    const links = Object.keys(router.links).filter((link) => !(cut && router === P && link === "virtual-3"));
    const ports = links
        .map((link) => `"${link}": { description: "lab link", addresses: ["${router.links[link]}/30"] },`)
        .join("\n            ");
    const ospf = links.map((link) => `"${link}": { network: "point-to-point" },`).join(" ");
    const far = router === FIRST_PE ? SECOND_PE : FIRST_PE;
    const vpws = router.vpws
        ? {
              vlan: `switching: { vlans: { vpws: { id: ${VPWS.id} } } },`,
              interfaces: `vlan_interface: { "vlan-vpws": { vlan: "vpws", mtu: ${VLAN_MTU}, addresses: ["${router.vpws}/26"] } },
        pseudowire: { "pw-vpws": { peer: "${far.loopback}", pw_id: ${VPWS.pw}, access_vlan: "vpws" } },`,
          }
        : { vlan: "", interfaces: "" };
    const rsvpTe = `rsvp_te: {
                interfaces: { ${links.map((link) => `"${link}": { bandwidth: "${LINK_BANDWIDTH}" }`).join(", ")} },
                ${router === FIRST_PE && tunnels ? `tunnels: ${tunnels},` : ""}
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
    routing: {
        router_id: "${router.loopback}",
        ospf: { areas: { "0.0.0.0": { traffic_engineering: true, interfaces: { loopback: { passive: true }, ${ospf} } } } },
        mpls: {
            ldp: { lsr_id: "${router.loopback}", interfaces: ${JSON.stringify(links)} },
            ${rsvpTe}
        },
    },
});
`
    );
}

/** The three routers, as `lab` says. */
function writeLab(lab: Lab): void {
    for (const router of ROUTERS) writeRouter(router, lab);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** One of pe-01's tunnels, as `print detail` shows it: whether it forwards, and on which path and next hop, from `forwarding-on="secondary, Iface=ether3, Nexthop=192.0.2.22, Label=0"`. */
function tunnel(name: string): { forwarding: boolean; path?: string; nextHop?: string; detail: string } {
    const output = exec("pe-01", "/mpls traffic-eng tunnel print detail without-paging");
    const detail = output.split(/\n(?=\s*\d+\s)/).find((entry) => entry.includes(`name="${name}"`)) ?? "";
    const forwarding = /^\s*\d+\s+[A-Z ]*F[A-Z ]*name=/.test(detail);
    const on = /forwarding-on="(\w+), [^"]*Nexthop=(\d+\.\d+\.\d+\.\d+)/.exec(detail);
    return { forwarding, path: forwarding ? on?.[1] : undefined, nextHop: forwarding ? on?.[2] : undefined, detail };
}

/** How many of `PINGS` pings across the pseudowire came back. */
function pingAcross(): number {
    const output = exec("pe-01", `:put [/ping ${SECOND_PE.vpws} count=${PINGS} interval=${PING_INTERVAL}]`);
    return Number(/^(\d+)\s*$/m.exec(output)?.[1] ?? 0);
}

/** What each router holds of RSVP-TE, for the job's log. */
function logTe(): void {
    for (const { name } of ROUTERS)
        exec(
            name,
            "/mpls traffic-eng export",
            "/mpls traffic-eng tunnel print detail without-paging",
            "/mpls traffic-eng flow print detail without-paging",
            "/mpls traffic-eng interface print detail without-paging"
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

/** pe-01's tunnel through p-01, which records its route, with a secondary path across the direct link that it sets up ahead. */
const PROTECTED = `{ "pe-02": {
    destination: "${SECOND_PE.loopback}",
    bandwidth: "${TUNNEL_BANDWIDTH}",
    explicit_path: ${JSON.stringify(THROUGH_P)},
    secondary_paths: { "pe-02-direct": { explicit_path: ${JSON.stringify(STRAIGHT)}, standby: true } },
    record_route: true,
} }`;

/** Two tunnels across the direct link that it can't hold together, the first with priorities `low`, the second with `high`. */
const contending = (low: number, high: number) => `{
    "pe-02": { destination: "${SECOND_PE.loopback}", bandwidth: "${HALF_AND_MORE}", explicit_path: ${JSON.stringify(STRAIGHT)}, setup_priority: ${low}, hold_priority: ${low} },
    "pe-02-video": { destination: "${SECOND_PE.loopback}", bandwidth: "${HALF_AND_MORE}", explicit_path: ${JSON.stringify(STRAIGHT)}, setup_priority: ${high}, hold_priority: ${high} },
}`;

describe.skipIf(!pChr || !firstPeChr || !secondPeChr)("RSVP-TE tunnel options between three CHRs", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked in a triangle." } } });\n`);
        writeLab({ tunnels: PROTECTED });
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "pe-01's tunnel runs through p-01 and records its route, with its secondary path set up ahead across the direct link",
        () => {
            apply();
            const up = eventually(() => tunnel("pe-02").nextHop === VIA_P);
            logTe();
            expect(up).toBe(true);

            const { detail } = tunnel("pe-02");
            expect(detail).toContain('secondary="Path=pe-02-direct');
            // p-01's address toward pe-02 and its label, then pe-02's address and the label it gives last.
            expect(detail.replace(/\s+/g, "")).toMatch(/RecRoute=\{192\.0\.2\.25,\*\d+\*,192\.0\.2\.26,\*0\*\}/);
            expect(eventually(() => pingAcross() >= ENOUGH_BACK)).toBe(true);
        },
        TEST_MS
    );

    test(
        "while p-01's link to pe-02 is down, the tunnel and its pseudowire take the secondary path, and move back once the link is up",
        () => {
            writeLab({ tunnels: PROTECTED, cut: true });
            apply([P]);
            const moved = eventually(() => {
                const now = tunnel("pe-02");
                return now.path === "secondary" && now.nextHop === DIRECT;
            });
            logTe();
            expect(moved).toBe(true);
            expect(eventually(() => pingAcross() >= ENOUGH_BACK)).toBe(true);
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);

            writeLab({ tunnels: PROTECTED });
            apply([P]);
            const back = eventually(() => {
                const now = tunnel("pe-02");
                return now.path === "primary" && now.nextHop === VIA_P;
            });
            logTe();
            expect(back).toBe(true);
        },
        TEST_MS
    );

    test(
        "a tunnel of a higher priority takes the bandwidth of a lower one, which goes down, and gives it back once their priorities change",
        () => {
            writeLab({ tunnels: contending(7, 0) });
            apply([FIRST_PE]);
            expect(eventually(() => tunnel("pe-02-video").forwarding && !tunnel("pe-02").forwarding)).toBe(true);
            Bun.sleepSync(STAYS_DOWN_MS);
            logTe();
            expect(tunnel("pe-02").forwarding).toBe(false);

            writeLab({ tunnels: contending(0, 7) });
            apply([FIRST_PE]);
            const swapped = eventually(() => tunnel("pe-02").forwarding && !tunnel("pe-02-video").forwarding);
            logTe();
            expect(swapped).toBe(true);
        },
        TEST_MS
    );

    test(
        "without the options, each apply removes their paths and settings, and diff then finds nothing to change",
        () => {
            writeLab({ tunnels: `{ "pe-02": { destination: "${SECOND_PE.loopback}", explicit_path: ${JSON.stringify(THROUGH_P)} } }` });
            apply();
            expect(eventually(() => tunnel("pe-02").nextHop === VIA_P)).toBe(true);
            const exported = exec("pe-01", "/mpls traffic-eng export");
            logTe();
            expect(exported).not.toMatch(/pe-02-direct|pe-02-video|secondary-paths|priority|record-route/);
        },
        TEST_MS
    );
});
