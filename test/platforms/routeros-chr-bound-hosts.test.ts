// Two RouterOS CHRs, which the devices workflow boots, and two hosts on the runner behind the first's ether4. With ether4 bound to one host, only what it sends from its own MAC and addresses reaches either CHR. Skipped without them.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Ssh } from "../../src/transport/ssh";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const firstChr = process.env.CIRCUIT_TEST_CHR;
const secondChr = process.env.CIRCUIT_TEST_CHR_B;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";
/** The namespace on the runner that holds the tap toward the first CHR's ether4, and the tap. */
const namespace = process.env.CHR_RA_NAMESPACE;
const tap = process.env.CHR_RA_TAP;

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-bound-hosts-")));

/** A test applies to two routers. */
const TEST_MS = 300_000;

/** A new IPv6 address takes no packets while duplicate address detection runs, so a ping that should answer is tried again (TRAPS.md). */
const TRIES = 5;

/** r-01's VLAN interface and r-02 share the subnet with the hosts. */
const GATEWAY = { ipv4: "192.0.2.1", ipv6: "2001:db8:10::1" };
const FAR = { ipv4: "192.0.2.2", ipv6: "2001:db8:10::2" };

/** The bound host, the other host, and an address the bound host may not send from. */
const BOUND = { name: "bound", mac: "02:00:00:00:00:01", ipv4: "192.0.2.11", ipv6: "2001:db8:10::11" };
const OTHER = { name: "other", mac: "02:00:00:00:00:02", ipv4: "192.0.2.12", ipv6: "2001:db8:10::12" };
const STOLEN = { ipv4: "192.0.2.14", ipv6: "2001:db8:10::14" };

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

/** A command on the runner, printed for the job's log. */
function shell(command: string): { status: number | null; output: string } {
    const run = spawnSync("sh", ["-c", command], { encoding: "utf8" });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ ${command}\n${output}`);
    return { status: run.status, output };
}

/** Runs a command on a CHR over SSH, for what `circuit exec` refuses: forgetting neighbors. */
async function onChr(chr: string, command: string): Promise<string> {
    const [host, port] = chr.split(":");
    const client = await Ssh.connect({ host: host!, port: Number(port), user: "operator+ct", password: () => password });
    try {
        const output = await Ssh.exec(client, command);
        console.log(`$ ${chr} ${command}\n${output}`);
        return output;
    } finally {
        client.end();
    }
}

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** A device of the lab project on `chr`, with these groups. */
function writeDevice(name: string, chr: string, groups: string): void {
    const [host, port] = chr.split(":");
    write(
        `sites/lab/${name}.ts`,
        `import { lab } from "../../circuit";

export default lab.device({
    name: "${name}",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    ${groups}
});
`
    );
}

/** r-01, with ether4 bound to the hosts in `bound`, or to any host when it is empty. */
function writeFirst(bound: string): void {
    writeDevice(
        "r-01",
        firstChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "r-02", access_vlan: "hosts" },
            "virtual-4": { description: "Servers", access_vlan: "hosts", ${bound} },
        },
        vlan_interface: { hosts: { vlan: "hosts", addresses: ["${GATEWAY.ipv4}/24", "${GATEWAY.ipv6}/64"] } },
    },
    switching: { vlans: { hosts: { id: 10 } } },`
    );
}

/** A host in a namespace of its own, on a MACVLAN of the tap. */
function hostUp(host: typeof BOUND): void {
    shell(`sudo ip netns add ${host.name}`);
    shell(`sudo ip netns exec ${namespace} ip link add link ${tap} name ${host.name} address ${host.mac} type macvlan mode bridge`);
    shell(`sudo ip netns exec ${namespace} ip link set ${host.name} netns ${host.name}`);
    shell(`sudo ip netns exec ${host.name} ip link set ${host.name} up`);
    shell(`sudo ip netns exec ${host.name} ip addr add ${host.ipv4}/24 dev ${host.name}`);
    shell(`sudo ip netns exec ${host.name} ip -6 addr add ${host.ipv6}/64 dev ${host.name} nodad`);
}

/** Whether `host` reaches `target`, from `from` when given, after both routers forget their neighbors. */
async function reaches(host: typeof BOUND, target: string, from = "", tries = 1): Promise<boolean> {
    for (const chr of [firstChr!, secondChr!])
        await onChr(chr, "/ip arp remove [find where dynamic]; /ipv6 neighbor remove [find where dynamic]");
    const family = target.includes(":") ? "-6" : "-4";
    const source = from ? `-I ${from}` : "";
    for (let attempt = 0; attempt < tries; attempt++) {
        shell(`sudo ip netns exec ${host.name} ip neigh flush all`);
        if (/ [1-9]\d* received/.test(shell(`sudo ip netns exec ${host.name} ping ${family} -c 3 -W 2 ${source} ${target}`).output))
            return true;
    }
    return false;
}

/** Whether `host` reaches r-01 and r-02, in each family. */
async function reachesBoth(host: typeof BOUND, tries: number): Promise<boolean[]> {
    const answers: boolean[] = [];
    for (const target of [GATEWAY.ipv4, FAR.ipv4, GATEWAY.ipv6, FAR.ipv6]) answers.push(await reaches(host, target, "", tries));
    return answers;
}

/** What `exec` printed for `command` on `device`. */
function exec(device: string, command: string): string {
    const { status, output } = circuit("exec", device, command);
    expect(status).toBe(0);
    return output;
}

describe.skipIf(!firstChr || !secondChr || !namespace || !tap)("a CHR lets through only what a bound port's hosts send", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Two CHRs, and two hosts on the runner." } } });\n`);
        writeFirst("");
        writeDevice(
            "r-02",
            secondChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "r-01", addresses: ["${FAR.ipv4}/24", "${FAR.ipv6}/64"] },
        },
    },`
        );
        shell(`sudo ip netns exec ${namespace} ip link set ${tap} up`);
        hostUp(BOUND);
        hostUp(OTHER);
    });

    afterAll(() => {
        for (const host of [BOUND, OTHER]) shell(`sudo ip netns del ${host.name}`);
        rmSync(folder, { recursive: true, force: true });
    });

    test(
        "without bound_to, both hosts reach r-01 and r-02, and diff then finds nothing to change",
        async () => {
            for (const device of ["r-02", "r-01"]) {
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(await reachesBoth(BOUND, TRIES)).toEqual([true, true, true, true]);
            expect(await reachesBoth(OTHER, TRIES)).toEqual([true, true, true, true]);
        },
        TEST_MS
    );

    test(
        "bound to one host, ether4 lets through only its MAC and addresses, and diff then finds nothing to change",
        async () => {
            writeFirst(`bound_to: [{ mac: "${BOUND.mac}", addresses: ["${BOUND.ipv4}", "${BOUND.ipv6}"] }]`);
            expect(circuit("apply", "r-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "r-01").status).toBe(0);
            exec("r-01", "/interface bridge nat print stats without-paging");

            expect(await reachesBoth(BOUND, TRIES)).toEqual([true, true, true, true]);
            expect(await reachesBoth(OTHER, 1)).toEqual([false, false, false, false]);

            shell(`sudo ip netns exec ${BOUND.name} ip addr add ${STOLEN.ipv4}/24 dev ${BOUND.name}`);
            shell(`sudo ip netns exec ${BOUND.name} ip -6 addr add ${STOLEN.ipv6}/64 dev ${BOUND.name} nodad`);
            expect(await reaches(BOUND, GATEWAY.ipv4, STOLEN.ipv4)).toBe(false);
            expect(await reaches(BOUND, FAR.ipv4, STOLEN.ipv4)).toBe(false);
            expect(await reaches(BOUND, GATEWAY.ipv6, STOLEN.ipv6)).toBe(false);
            expect(await reaches(BOUND, FAR.ipv6, STOLEN.ipv6)).toBe(false);
            shell(`sudo ip netns exec ${BOUND.name} ip addr del ${STOLEN.ipv4}/24 dev ${BOUND.name}`);
            shell(`sudo ip netns exec ${BOUND.name} ip -6 addr del ${STOLEN.ipv6}/64 dev ${BOUND.name}`);
            exec("r-01", "/interface bridge nat print stats without-paging");
        },
        TEST_MS
    );

    test(
        "without it again, apply removes the rules, and the other host reaches both routers again",
        async () => {
            writeFirst("");
            expect(circuit("apply", "r-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "r-01").status).toBe(0);
            expect(exec("r-01", ":put [:len [/interface bridge nat find]]")).toMatch(/^0$/m);
            expect(await reachesBoth(OTHER, TRIES)).toEqual([true, true, true, true]);
        },
        TEST_MS
    );
});
