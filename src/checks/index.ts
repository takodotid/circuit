import type { Device, Finding } from "../model";
import { Platforms } from "../platforms";
import { CrossChecks } from "./cross";
import { BuiltInChecks } from "./built-in";
import type { NetworkChecks } from "./built-in";
import { DeviceChecks } from "./device";

export type { NetworkChecks } from "./built-in";

export class Checks {
    /** What `circuit validate` finds on the network's devices, with the built-in checks `checks` turns on. Reading the project runs the project's own checks, and what it stops on is not checked again. */
    static run(devices: readonly Device[], checks: NetworkChecks | undefined, options: { experimental?: boolean } = {}): Finding[] {
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
            for (const field of adapter.experimental?.(device) ?? []) {
                findings.push(
                    options.experimental
                        ? {
                              level: "warning",
                              device: device.name,
                              message: `${field} is not tested on a real device yet. Sent because of --experimental: try it on a lab device first.`,
                          }
                        : {
                              level: "error",
                              device: device.name,
                              message: `${field} is not tested on a real device yet. Add --experimental to send it anyway.`,
                          }
                );
            }
            findings.push(...(adapter.checks?.(device) ?? []));
        }

        findings.push(...CrossChecks.run(devices));
        findings.push(...BuiltInChecks.run(devices, checks));

        return findings;
    }
}
