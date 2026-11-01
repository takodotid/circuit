// What `circuit validate` finds in a network read with `readProject`: each device's own rules, what its platform cannot express or does otherwise, what its
// model's hardware holds, the rules across devices, and the built-in checks the network turns on. What reading the project stops on is not checked again.

import type { Device } from "../model";
import type { Finding } from "../platforms/finding";
import { Platforms } from "../platforms";
import { CrossChecks } from "./across";
import { BuiltInChecks, type NetworkChecks } from "./built-in";
import { DeviceChecks } from "./device";

export type { NetworkChecks } from "./built-in";

export class Validation {
    /** Every finding on the network's devices, in the model, with the built-in checks its `checks` turns on. Own checks in `checks` are left out: reading the project runs them. */
    static run(devices: readonly Device[], checks: NetworkChecks | undefined): Finding[] {
        const findings: Finding[] = [];

        for (const device of devices) {
            findings.push(...DeviceChecks.run(device));

            const adapter = Platforms.find(device.platform);
            if (!adapter) {
                findings.push({ level: "error", device: device.name, message: `no adapter for platform ${device.platform}` });
                continue;
            }

            for (const field of adapter.unsupported(device)) {
                findings.push({ level: "error", device: device.name, message: `${device.platform} cannot express ${field}` });
            }
            findings.push(...(adapter.checks?.(device) ?? []));
        }

        findings.push(...CrossChecks.run(devices));
        findings.push(...BuiltInChecks.run(devices, checks));

        return findings;
    }
}
