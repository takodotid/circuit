// EVPN over VXLAN (RFC 7432, RFC 8365) on the three CHRs of the devices workflow. Each routes its loopback in OSPF over a trunk to the first, and runs iBGP with the other two. Each has a VXLAN segment in EVPN, a port of one VLAN. The first also holds two hosts in VRFs: one behind the second, one behind the third. The tests run in order. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const firstChr = process.env.CIRCUIT_TEST_CHR;
const secondChr = process.env.CIRCUIT_TEST_CHR_B;
const thirdChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-evpn-")));

/** A test applies to three routers, and waits for OSPF, BGP, and EVPN. */
const TEST_MS = 400_000;

/** How long routes have to arrive, or go. */
const WAIT_MS = 120_000;

const POLL_MS = 3000;

/** The segment's VNI. */
const VNI = 10100;

/** What the segment writes: every VTEP's route targets, and the number in each one's route distinguisher. Also the VLAN ID of the second's VLAN, which the first's trunk carries too. */
type Segment = { target: string; distinguisher: number; secondVlanId: number };

/** The segment as first applied, then changed in each. */
const SEGMENT: Segment = { target: "64500:10100", distinguisher: 100, secondVlanId: 102 };
const CHANGED: Segment = { target: "64500:10101", distinguisher: 101, secondVlanId: 112 };

/** The hosts, on the first router: each a VLAN interface with a MAC of its own, in a VRF of its own. */
const HOSTS = {
    second: { name: "host-02", vrf: "site-02", vlan: "lan-02", mac: "02:00:00:00:01:02", address: "198.51.100.2" },
    third: { name: "host-03", vrf: "site-03", vlan: "lan-03", mac: "02:00:00:00:01:03", address: "198.51.100.3" },
};

/** One router of the lab: its CHR, management network, loopback, the VLAN its segment is a port of, and its VLAN interfaces toward the first router. */
type Router = {
    name: string;
    chr: string;
    management: string;
    loopback: string;
    lan: { name: string; id: number };
    trunks: Record<string, { core: { name: string; id: number; address: string }; lan?: string }>;
};

const FIRST: Router = {
    name: "vtep-01",
    chr: firstChr!,
    management: "10.0.0",
    loopback: "192.0.2.101",
    lan: { name: "lan-01", id: 100 },
    trunks: {
        "virtual-2": { core: { name: "core-02", id: 12, address: "192.0.2.17/30" }, lan: HOSTS.second.vlan },
        "virtual-3": { core: { name: "core-03", id: 13, address: "192.0.2.21/30" }, lan: HOSTS.third.vlan },
    },
};
const SECOND: Router = {
    name: "vtep-02",
    chr: secondChr!,
    management: "10.0.1",
    loopback: "192.0.2.102",
    lan: { name: HOSTS.second.vlan, id: 102 },
    trunks: { "virtual-2": { core: { name: "core-02", id: 12, address: "192.0.2.18/30" } } },
};
const THIRD: Router = {
    name: "vtep-03",
    chr: thirdChr!,
    management: "10.0.2",
    loopback: "192.0.2.103",
    lan: { name: HOSTS.third.vlan, id: 103 },
    trunks: { "virtual-2": { core: { name: "core-03", id: 13, address: "192.0.2.22/30" } } },
};
const ROUTERS = [FIRST, SECOND, THIRD];

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
function eventually(check: () => boolean): boolean {
    const deadline = Date.now() + WAIT_MS;
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

/** A router of the lab, with its segment in EVPN and its sessions when `segment` is given. The first router also holds the hosts. */
function writeRouter(router: Router, segment: Segment | undefined): void {
    const [host, port] = router.chr.split(":");
    const secondVlan = { name: HOSTS.second.vlan, id: (segment ?? SEGMENT).secondVlanId };
    const vlans = [router === SECOND ? secondVlan : router.lan, ...Object.values(router.trunks).map(({ core }) => core)];
    if (router === FIRST) vlans.push(secondVlan, { name: HOSTS.third.vlan, id: THIRD.lan.id });
    const ports = Object.entries(router.trunks)
        .map(
            ([trunk, { core, lan }]) =>
                `"${trunk}": { description: "lab link", trunk_vlans: ["${core.name}", "${lan ?? router.lan.name}"] },`
        )
        .join("\n            ");
    const cores = Object.values(router.trunks)
        .map(({ core }) => `"${core.name}": { vlan: "${core.name}", addresses: ["${core.address}"] },`)
        .join(" ");
    const hosts =
        router === FIRST
            ? Object.values(HOSTS)
                  .map((h) => `"${h.name}": { vlan: "${h.vlan}", vrf: "${h.vrf}", mac: "${h.mac}", addresses: ["${h.address}/24"] },`)
                  .join(" ")
            : "";
    const vrfs =
        router === FIRST
            ? `vrfs: { ${Object.values(HOSTS)
                  .map((h) => `"${h.vrf}": {}`)
                  .join(", ")} },`
            : "";
    const ospf = Object.values(router.trunks)
        .map(({ core }) => `"${core.name}": { network: "point-to-point" },`)
        .join(" ");
    const vxlan = segment
        ? `vxlan: {
            "vxlan-lan": {
                description: "The LAN of all three",
                vni: ${VNI},
                local_address: "${router.loopback}",
                access_vlan: "${router.lan.name}",
                evpn: {
                    route_distinguisher: "${router.loopback}:${segment.distinguisher}",
                    route_targets: { import: ["${segment.target}"], export: ["${segment.target}"] },
                },
            },
        },`
        : "";
    const neighbors = segment
        ? ROUTERS.filter((far) => far !== router)
              .map(
                  (far) =>
                      `"${far.name}": { address: "${far.loopback}", remote_as: 64500, local_address: "${router.loopback}", address_families: ["l2vpn-evpn"] },`
              )
              .join("\n                ")
        : "";

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
        vlan_interface: { ${cores} ${hosts} },
        ${vxlan}
    },
    switching: { vlans: { ${vlans.map(({ name, id }) => `"${name}": { id: ${id} }`).join(", ")} } },
    routing: {
        router_id: "${router.loopback}",
        ${vrfs}
        ospf: { areas: { "0.0.0.0": { interfaces: { loopback: { passive: true }, ${ospf} } } } },
        bgp: { neighbors: { ${neighbors} } },
    },
});
`
    );
}

/** The three routers, each with this segment in EVPN, or without EVPN. */
function writeLab(segment: Segment | undefined): void {
    for (const router of ROUTERS) writeRouter(router, segment);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** The far VTEPs a router's segment learned, `/interface vxlan vteps` entries it added itself: `0  D interface=vxlan-lan remote-ip=192.0.2.102`. */
function vteps(router: Router): string[] {
    return exec(router.name, "/interface vxlan vteps print detail without-paging")
        .split("\n")
        .flatMap((line) => /^\s*\d+\s+D\s+interface=vxlan-lan\s+remote-ip=(\S+)/.exec(line)?.[1] ?? [])
        .sort();
}

/** The EVPN routes a router holds, each entry as `print detail` shows it: flags, then its properties, `Ab afi=evpn ... dst-address=[192.0.2.103:10100]macip:0|02:00:00:00:01:03 ...`. */
function evpnRoutes(router: Router): string[] {
    return exec(router.name, "/routing route print detail without-paging where afi=evpn").split(/\n\s*\n/);
}

/** The destinations of the EVPN routes a router learned over BGP, flagged `b`, such as `[192.0.2.103:10100]macip:0|02:00:00:00:01:03`. */
function learned(router: Router): string[] {
    return evpnRoutes(router).flatMap((entry) => {
        const flags = /^\s*([A-Za-z]*)\s+afi=evpn/m.exec(entry)?.[1] ?? "";
        const destination = /dst-address=(\S+)/.exec(entry)?.[1];
        return flags.includes("b") && destination ? [destination] : [];
    });
}

/** The route targets of the EVPN routes a router learned over BGP, as `rt:64500:10100`. */
function learnedTargets(router: Router): string[] {
    return evpnRoutes(router).flatMap((entry) => {
        const flags = /^\s*([A-Za-z]*)\s+afi=evpn/m.exec(entry)?.[1] ?? "";
        return flags.includes("b") ? [...entry.matchAll(/\brt:(\S+?)(?:,|\s|$)/g)].map((match) => match[1]!) : [];
    });
}

/** Whether the host behind the second router reaches the one behind the third. */
function hostsReach(): boolean {
    return /received=[1-9]/.test(exec(FIRST.name, `/ping ${HOSTS.third.address} vrf=${HOSTS.second.vrf} count=3`));
}

/** What each router holds of EVPN, for the job's log. */
function logEvpn(): void {
    for (const { name } of ROUTERS)
        exec(
            name,
            "/routing bgp session print detail without-paging",
            "/routing route print detail without-paging where afi=evpn",
            "/interface vxlan vteps print detail without-paging",
            "/interface bridge host print detail without-paging where !local"
        );
}

/** Applies to each router, and finds nothing to change after. */
function applyAll(): void {
    for (const { name } of ROUTERS) {
        // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
        circuit("diff", name);
        expect(circuit("apply", name, "--confirm").status).toBe(0);
        expect(circuit("diff", name).status).toBe(0);
    }
}

/** Whether a router learned a type 3 route from each of the other two, with `segment`'s route distinguishers and route targets alone. */
function hasTypeThree(router: Router, segment: Segment): boolean {
    const routes = learned(router);
    const targets = learnedTargets(router);
    return (
        ROUTERS.filter((far) => far !== router).every((far) =>
            routes.includes(`[${far.loopback}:${segment.distinguisher}]imet:0|${far.loopback}`)
        ) &&
        targets.length > 0 &&
        targets.every((one) => one === segment.target)
    );
}

/** Each router's far VTEPs: the other two loopbacks. */
const everyVtep = () =>
    ROUTERS.every(
        (router) =>
            vteps(router).join() ===
            ROUTERS.filter((far) => far !== router)
                .map((far) => far.loopback)
                .sort()
                .join()
    );

describe.skipIf(!firstChr || !secondChr || !thirdChr)("EVPN over VXLAN among three CHRs", () => {
    beforeAll(() => {
        write(
            "circuit.ts",
            `export const lab = circuit({ asn: 64500, sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`
        );
        writeLab(SEGMENT);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "the segment forms over iBGP with no VTEP written: each router floods to the other two by their type 3 routes, learns the hosts' MAC addresses as type 2 routes, and the hosts reach each other",
        () => {
            applyAll();
            const formed = eventually(everyVtep);
            // A frame from each host makes the router it is behind announce its MAC address.
            const reached = eventually(hostsReach);
            const typeTwo = eventually(() => {
                hostsReach();
                const second = learned(SECOND).join(" ");
                const third = learned(THIRD).join(" ");
                const first = learned(FIRST).join(" ");
                return (
                    third.includes(`[${SECOND.loopback}:${SEGMENT.distinguisher}]macip:0|${HOSTS.second.mac}`) &&
                    second.includes(`[${THIRD.loopback}:${SEGMENT.distinguisher}]macip:0|${HOSTS.third.mac}`) &&
                    first.includes(HOSTS.second.mac) &&
                    first.includes(HOSTS.third.mac)
                );
            });
            logEvpn();
            expect(formed).toBe(true);
            expect(reached).toBe(true);
            expect(typeTwo).toBe(true);
            // Each router holds a type 3 route from each of the other two.
            for (const router of ROUTERS) expect(hasTypeThree(router, SEGMENT)).toBe(true);

            // The sessions, the VTEPs, and the MAC addresses EVPN learned change nothing to plan.
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "new route targets and route distinguishers on all three, and another VLAN ID at the second, converge, and the segment forms again with them",
        () => {
            writeLab(CHANGED);
            applyAll();
            const formed = eventually(() => everyVtep() && ROUTERS.every((router) => hasTypeThree(router, CHANGED)));
            const reached = eventually(hostsReach);
            logEvpn();
            expect(formed).toBe(true);
            expect(reached).toBe(true);
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "without EVPN in the config, each apply removes the segment and its entry, and diff then finds nothing to change",
        () => {
            writeLab(undefined);
            for (const { name } of ROUTERS) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
                expect(exec(name, "/interface vxlan export", "/routing bgp evpn export")).not.toMatch(/^add /m);
            }
        },
        TEST_MS
    );
});
