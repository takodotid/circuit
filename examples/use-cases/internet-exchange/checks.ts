// The exchange's own rules. `circuit validate` runs them beside Circuit's own.

import type { Check, Finding } from "@takodotid/circuit";
import { contains } from "@takodotid/circuit";
import { vlansOf } from "@takodotid/circuit/presets";
import { PEERING_LAN } from "./exchange";
import { MEMBERS } from "./members";

export default [
    // Every member has a name, an AS and addresses of its own. The route servers hold .1 and .2 of each family.
    () => {
        const findings: Finding[] = [];
        const error = (message: string) => findings.push({ level: "error", message });
        const taken = new Map<string, string>([
            ["203.0.113.1", "route server rs1"],
            ["203.0.113.2", "route server rs2"],
            ["2001:db8:ffff::1", "route server rs1"],
            ["2001:db8:ffff::2", "route server rs2"],
        ]);

        MEMBERS.forEach((m, index) => {
            for (const other of MEMBERS.slice(index + 1)) {
                if (other.name === m.name) error(`member ${m.name} is declared twice`);
                if (other.asn === m.asn) error(`members ${m.name} and ${other.name} share AS${m.asn}`);
            }

            for (const [address, lan] of [
                [m.ipv4, PEERING_LAN.v4],
                [m.ipv6, PEERING_LAN.v6],
            ] as const) {
                if (!contains(lan, address)) error(`${address} of ${m.name} is outside the peering LAN ${lan}`);
                const holder = taken.get(address);
                if (holder) error(`${address} of ${m.name} is already ${holder}'s`);
                taken.set(address, m.name);
            }
        });

        return findings;
    },

    // The peering LAN is the only VLAN a member port carries, so no member ever reaches the management network.
    (devices) =>
        devices.flatMap((device) =>
            Object.entries(device.ports ?? {})
                .filter(([, port]) => port && vlansOf(port).includes("peering") && vlansOf(port).length > 1)
                .map(([name]) => ({
                    level: "error" as const,
                    device: device.name,
                    message: `port ${name} carries the peering LAN beside another VLAN`,
                }))
        ),
] satisfies Check[];
