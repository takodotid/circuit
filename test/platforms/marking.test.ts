// DSCP and PCP marking (RFC 2474, IEEE 802.1Q). RouterOS is applied on CHRs in CI, and what leaves is counted on the next router (routeros-chr-marking.test.ts).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Checks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Project } from "../../src/project";

const options = { secrets: false, rollback: 10 };

/** A router of `platform` with a VLAN interface `phones`, and these groups. */
function device(platform: string, model: string, more: object): Device {
    const written = {
        name: "edge-01",
        site: "lab",
        platform,
        model,
        connection: { host: "192.0.2.10", user: "netops" },
        system: { users: { netops: { role: "admin", password: { secret: "NETOPS" } } } },
        switching: { vlans: { phones: { id: 20 } } },
        interfaces: {
            vlan_interface: { phones: { vlan: "phones", addresses: ["192.0.2.1/26", "2001:db8:20::1/64"] } },
        },
        ...more,
    };
    return written as Device;
}

const marking = (found: string[]) => found.filter((field) => field.includes("marking"));

test("RouterOS marks in the mangle table's forward chain, each rule ending the chain for what it marks", () => {
    const sample = device("routeros", "CHR", {
        qos: {
            marking: [
                {
                    description: "Voice",
                    if: { in_interface: "phones", protocol: "udp", dst_port: { min: 16384, max: 32767 } },
                    then: { dscp: "ef", pcp: 5 },
                },
                { description: "Video", if: { family: "ipv4", dscp: "af42" }, then: { dscp: "af41" } },
                { description: "Background", if: { src: "2001:db8:20::/64" }, then: { pcp: 1 } },
            ],
        },
    });

    expect(marking(Platforms.get("routeros").unsupported(sample))).toEqual([]);
    const adapter = Platforms.get("routeros");
    const text = adapter.render(sample);
    expect(adapter.plan(text, text, options).steps).toEqual([]);

    const ipv4 = text.slice(text.indexOf("/ip firewall mangle"), text.indexOf("\n/", text.indexOf("/ip firewall mangle") + 1));
    expect(ipv4.split("\n").slice(1)).toEqual([
        "add action=set-priority chain=forward comment=Voice dst-port=16384-32767 in-interface=phones new-priority=5 protocol=udp",
        "add action=change-dscp chain=forward comment=Voice dst-port=16384-32767 in-interface=phones new-dscp=46 passthrough=no protocol=udp",
        "add action=change-dscp chain=forward comment=Video dscp=36 new-dscp=34 passthrough=no",
    ]);
    expect(text).toContain(
        "add action=set-priority chain=forward comment=Background new-priority=1 passthrough=no src-address=2001:db8:20::/64"
    );
});

test("RouterOS refuses marking that packets would skip", () => {
    const sample = device("routeros", "CCR2216-1G-12XS-2XQ", {
        system: { users: {}, hardware_offload: true },
        interfaces: {
            vlan_interface: {
                phones: { vlan: "phones", addresses: ["192.0.2.1/26"], hardware_offload: false },
                office: { vlan: "phones", addresses: ["192.0.2.65/26"] },
            },
        },
        firewall: { filter: { forward: { rules: [{ then: "accept", fast_path: true }] } } },
        qos: {
            marking: [
                { if: { in_interface: "phones" }, then: { dscp: "ef" } },
                { if: { in_interface: "office", dscp: ["af11", "af12"] }, then: { dscp: "cs0" } },
            ],
        },
    });

    expect(marking(Platforms.get("routeros").unsupported(sample))).toEqual([
        "qos.marking beside a fast_path rule, whose flows skip the mangle table: take fast_path off",
        "qos.marking[1] while system.hardware_offload is on, whose routed traffic skips the mangle table: match in if.in_interface or if.out_interface a VLAN interface with hardware_offload: false",
        "qos.marking[1].if.dscp, a list: write one rule for each",
    ]);
});

test("every other platform refuses marking, which it does not build", () => {
    const rules = { qos: { marking: [{ then: { dscp: "cs0" } }] } };
    for (const [platform, model] of [
        ["junos", "QFX5100-48S-6Q"],
        ["raisecom-ros", "RAX721-C-6C48"],
    ] as const)
        expect(marking(Platforms.get(platform).unsupported(device(platform, model, rules)))).toEqual([
            "qos.marking, which the platform does not build",
        ]);
});

test("validate says what is wrong in a marking rule", () => {
    const sample = device("routeros", "CHR", {
        qos: {
            marking: [
                { if: { dscp: "EF" }, then: { dscp: "af44" } },
                { then: {} },
                { then: "ef" },
                { if: { dscp: [] }, then: { pcp: 8 } },
                { if: { src: "192.0.2.0/24", dst: "2001:db8::/32" }, then: { dscp: "cs1" } },
            ],
        },
    });

    const messages = Checks.run([sample], undefined).map((finding) => finding.message);
    expect(messages.filter((message) => message.includes("qos.marking"))).toEqual([
        "qos.marking: src and dst differ in family, so no packet matches both",
        'qos.marking[0].then.dscp "af44" is no DSCP name. Did you mean af41?',
        'qos.marking[0].if.dscp "EF" is no DSCP name. Did you mean ef?',
        "qos.marking[1].then marks nothing: write dscp, pcp, class, or several",
        'qos.marking[2].then "ef" is no marking: write it as { dscp: "ef" }, { pcp: 5 }, { class: "voice" }, or several',
        "qos.marking[3].then.pcp 8 is not a whole number from 0 to 7",
        "qos.marking[3].if.dscp is an empty list, which matches no packet: leave it out",
    ]);
});

const folder = mkdtempSync(join(tmpdir(), "circuit-marking-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

let read: Awaited<ReturnType<typeof Project.read>>;
beforeAll(async () => {
    const router = device("routeros", "CHR", {
        firewall: { interface_sets: { inside: ["phones", "office"] } },
        interfaces: {
            vlan_interface: {
                phones: { vlan: "phones", addresses: ["192.0.2.1/26"] },
                office: { vlan: "phones", addresses: ["192.0.2.65/26"] },
            },
        },
        qos: { marking: [{ description: "Remark", if: { in_interface_set: "inside", dscp: ["af11", "af12"] }, then: { dscp: "cs1" } }] },
    });
    writeFileSync(join(folder, "circuit.ts"), `export const net = circuit({ asn: 64500, sites: { lab: { description: "lab" } } });\n`);
    mkdirSync(join(folder, "sites", "lab"), { recursive: true });
    writeFileSync(
        join(folder, "sites", "lab", "edge-01.ts"),
        `import { net } from "../../circuit";\n\nexport default net.device(${JSON.stringify(router, null, 4)});\n`
    );
    read = await Project.read(folder);
});

test("a list or an interface set in a marking rule makes one rule for each value: interfaces first, the DSCP last", () => {
    expect(read.networks[0]?.devices["edge-01"]?.qos?.marking).toEqual([
        { description: "Remark", if: { in_interface: "phones", dscp: "af11" }, then: { dscp: "cs1" } },
        { description: "Remark", if: { in_interface: "phones", dscp: "af12" }, then: { dscp: "cs1" } },
        { description: "Remark", if: { in_interface: "office", dscp: "af11" }, then: { dscp: "cs1" } },
        { description: "Remark", if: { in_interface: "office", dscp: "af12" }, then: { dscp: "cs1" } },
    ]);
});
