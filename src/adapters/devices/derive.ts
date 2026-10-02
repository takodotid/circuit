// Values more than one adapter derives from a device in the same way.

import { familyOf, network } from "../../core/addr";
import type { Device } from "../../schema";

/** Each LAG's number: its own `id`, or its position among the device's LAGs. */
export function lagIds(device: Device): Map<string, number> {
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
export function ipv4Networks(device: Device, iface: string): string[] {
    const settings = device.interfaces?.[iface] ?? device.ports?.[iface as keyof typeof device.ports];
    const addresses = (settings?.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

    return addresses.filter((address) => familyOf(address) === "ipv4").map((address) => network(address));
}
