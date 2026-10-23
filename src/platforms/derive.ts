// Values more than one adapter derives from a device in the same way.

import { Address } from "../core/address";
import type { Device } from "../schema";

export class Derive {
    /** Each LAG's number: its own `id`, or its position among the device's LAGs. */
    static lagIds(device: Device): Map<string, number> {
        const numbers = new Map<string, number>();
        let position = 0;

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "lag") continue;

            position++;
            numbers.set(name, iface.id ?? position);
        }

        return numbers;
    }

    /** The IPv4 networks of a port's or an interface's addresses. */
    static ipv4Networks(device: Device, iface: string): string[] {
        const settings = device.interfaces?.[iface] ?? device.ports?.[iface as keyof typeof device.ports];
        const addresses = (settings?.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

        return addresses.filter((address) => Address.family(address) === "ipv4").map((address) => Address.prefixOf(address));
    }

    /** Services the switch platforms run. Each takes its sources from `management.allow`, on the protocol's own port. */
    private static readonly SWITCH_SERVICES = ["ssh", "telnet", "snmp"] as const;

    /** Fields neither switch platform, VRP nor Raisecom ROS, expresses: a service's own sources or port, a user's description or keys, the IP stack's host settings, a point-to-point address, and offload per interface. */
    static switchUnsupported(device: Device): string[] {
        const found: string[] = [];

        for (const service of Derive.SWITCH_SERVICES) {
            const settings = device.management?.[service];
            if (settings?.allow) found.push(`management.${service}.allow, every service takes management.allow`);
            if (settings?.port) found.push(`management.${service}.port`);
        }

        for (const [name, user] of Object.entries(device.users ?? {})) {
            if (user.description) found.push(`users.${name}.description`);
            if (user.ssh_keys?.length) found.push(`users.${name}.ssh_keys`);
        }

        if (device.system?.ip) found.push("system.ip");

        for (const [name, port] of Object.entries(device.ports ?? {})) {
            if (port?.hardware_offload !== undefined) found.push(`ports.${name}.hardware_offload`);
        }

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.addresses?.some((entry) => typeof entry !== "string")) found.push(`interfaces.${name}.addresses with a peer`);
            if (iface.hardware_offload !== undefined) found.push(`interfaces.${name}.hardware_offload`);
        }

        return found;
    }
}
