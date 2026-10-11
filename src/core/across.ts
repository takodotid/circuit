// Rules that span devices: what one device declares about another has to agree with what the other declares.

import type { Device, Port, Routed, Switched } from "../schema";
import { familyOf, host, isCidr, network as prefixOf } from "./addr";
import type { Finding } from "./define";
import { type Holder, holdersOf, keyOf } from "./graph";

/** Every rule across devices. */
export function checkAcross(devices: readonly Device[]): Finding[] {
    const holders = holdersOf(devices);

    return [...checkLinks(devices), ...checkAddresses(holders)];
}

/** The VLAN ids a port carries, by how it carries them, so two ends can be compared across devices. */
function carried(device: Device, port: Port<string, string, string, string>) {
    const id = (vlan: string | undefined) => (vlan ? device.vlans?.[vlan]?.id : undefined);
    return {
        access: id(port.access_vlan),
        native: id(port.native_vlan),
        trunk: (port.trunk_vlans ?? []).map(id).sort((a, b) => (a ?? 0) - (b ?? 0)),
    };
}

/** VLAN names by id, for the VLANs a port or LAG carries. */
function vlanNames(device: Device, settings: Switched<string>): Map<number, string> {
    const names = [settings.access_vlan, settings.native_vlan, ...(settings.trunk_vlans ?? [])].filter((name) => name !== undefined);

    return new Map(names.flatMap((name) => (device.vlans?.[name] ? [[device.vlans[name].id, name] as const] : [])));
}

/** What a port's settings are kept on: the LAG when the port is a member of one, otherwise the port. */
function carrierOf(device: Device, portName: string, port: Port<string, string, string, string>) {
    const lag = port.lag ? device.interfaces?.[port.lag] : undefined;
    if (port.lag && lag?.type === "lag") return { name: port.lag, settings: lag };

    return { name: portName, settings: port };
}

/** The plain addresses of one family on an interface, leaving out point-to-point ones. */
const plainAddresses = (settings: Routed<string>, family: string) =>
    (settings.addresses ?? []).filter((entry): entry is string => typeof entry === "string" && isCidr(entry) && familyOf(entry) === family);

/** Why the two ends of a cable cannot reach each other by address, or undefined when they can. */
function addressDisagreement(here: Routed<string>, there: Routed<string>, far: Device, farName: string): string | undefined {
    for (const family of ["ipv4", "ipv6"]) {
        const ours = plainAddresses(here, family);
        const theirs = plainAddresses(there, family);
        if (!ours.length || !theirs.length) continue;

        // A prefix includes its length, so 10.0.0.0/24 and 10.0.0.0/25 are not one.
        const theirPrefixes = new Set(theirs.map(prefixOf));
        if (!ours.some((address) => theirPrefixes.has(prefixOf(address)))) {
            return `has ${ours.join(", ")}, and ${far.name} ${farName} has ${theirs.join(", ")}: not one prefix of one length`;
        }
    }

    // A point-to-point address names the far end's own address as its peer.
    const farHosts = new Set((there.addresses ?? []).map((entry) => keyOf(host(typeof entry === "string" ? entry : entry.address))));

    for (const entry of here.addresses ?? []) {
        if (typeof entry === "string" || !keyOf(entry.peer) || farHosts.has(keyOf(entry.peer))) continue;
        return `${entry.address} names peer ${entry.peer}, which ${far.name} ${farName} does not hold`;
    }

    return undefined;
}

/** A link names a device and port that exist, the far end links back, and both ends carry the same VLANs the same way, with the same MTU, speed and addresses. */
function checkLinks(devices: readonly Device[]): Finding[] {
    const findings: Finding[] = [];
    const byName = new Map(devices.map((device) => [device.name, device]));

    for (const device of devices) {
        for (const [portName, port] of Object.entries(device.ports ?? {})) {
            const link = port?.link;
            if (!port || !link) continue;

            const report = (message: string, level: Finding["level"] = "error") =>
                findings.push({
                    level,
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
            if (!linksBack) {
                report(`${link.device} ${link.port} does not link back to it`);
                continue;
            }

            const here = JSON.stringify(carried(device, port));
            const there = JSON.stringify(carried(far, farPort));
            if (here !== there) report(`carries ${here}, and ${link.device} ${link.port} carries ${there}`);

            if (port.speed && farPort.speed && port.speed !== farPort.speed) {
                report(`speed ${port.speed}, and ${link.device} ${link.port} is ${farPort.speed}`);
            }

            const near = carrierOf(device, portName, port);
            const away = carrierOf(far, link.port, farPort);

            const mtu = near.settings.mtu ?? 1500;
            const farMtu = away.settings.mtu ?? 1500;
            if (mtu !== farMtu) report(`MTU ${mtu} on ${near.name}, and ${link.device} ${away.name} has ${farMtu}`);

            const disagreement = addressDisagreement(near.settings, away.settings, far, away.name);
            if (disagreement) report(`${near.name} ${disagreement}`);

            // One VLAN under two names works, but reads as two VLANs.
            const farNames = vlanNames(far, away.settings);
            for (const [id, name] of vlanNames(device, near.settings)) {
                const farName = farNames.get(id);
                if (farName && farName !== name) report(`VLAN ${id} is ${name} here and ${farName} on ${link.device}`, "warning");
            }
        }
    }

    return findings;
}

/** No address is held by two devices. Two loopbacks may hold one on purpose, for anycast, so that is a warning. */
function checkAddresses(holders: Holder[]): Finding[] {
    const findings: Finding[] = [];
    const first = new Map<string, Holder>();

    const isLoopback = (holder: Holder) => holder.device.interfaces?.[holder.name]?.type === "loopback";

    for (const holder of holders) {
        const key = keyOf(host(holder.address))!;
        const earlier = first.get(key);

        if (!earlier) {
            first.set(key, holder);
            continue;
        }

        // Two on one device are reported by the device's own checks.
        if (earlier.device === holder.device) continue;

        const anycast = isLoopback(earlier) && isLoopback(holder);

        findings.push({
            level: anycast ? "warning" : "error",
            device: holder.device.name,
            message: `${host(holder.address)} on ${holder.name} is also on ${earlier.device.name} ${earlier.name}${anycast ? ", which is right only for anycast" : ""}`,
        });
    }

    return findings;
}
