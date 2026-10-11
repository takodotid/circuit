// Rules that span devices: what one device declares about another has to agree with what the other declares.

import type { Device } from "../schema";
import type { Finding } from "./define";

/** Every rule across devices. */
export function checkAcross(devices: readonly Device[]): Finding[] {
    return checkLinks(devices);
}

/** The VLAN ids a port carries, by how it carries them, so two ends can be compared across devices. */
function carried(device: Device, port: NonNullable<NonNullable<Device["ports"]>[string]>) {
    const id = (vlan: string | undefined) => (vlan ? device.vlans?.[vlan]?.id : undefined);
    return {
        access: id(port.access_vlan),
        native: id(port.native_vlan),
        trunk: (port.trunk_vlans ?? []).map(id).sort((a, b) => (a ?? 0) - (b ?? 0)),
    };
}

/** A link names a device and port that exist, the far end links back, and both ends carry the same VLANs the same way. */
function checkLinks(devices: readonly Device[]): Finding[] {
    const findings: Finding[] = [];
    const byName = new Map(devices.map((device) => [device.name, device]));

    for (const device of devices) {
        for (const [portName, port] of Object.entries(device.ports ?? {})) {
            const link = port?.link;
            if (!port || !link) continue;

            const report = (message: string) =>
                findings.push({
                    level: "error",
                    device: device.name,
                    message: `port ${portName} link: ${message}`,
                });

            const far = byName.get(link.device);
            if (!far) {
                report(`device ${link.device} is not in the network`);
                continue;
            }

            const farPort = far.ports?.[link.port];
            if (!farPort) {
                report(`${link.device} does not declare port ${link.port}`);
                continue;
            }

            const linksBack = farPort.link?.device === device.name && farPort.link.port === portName;
            if (!linksBack) report(`${link.device} ${link.port} does not link back to it`);

            const here = JSON.stringify(carried(device, port));
            const there = JSON.stringify(carried(far, farPort));
            if (here !== there) report(`carries ${here}, and ${link.device} ${link.port} carries ${there}`);
        }
    }

    return findings;
}
