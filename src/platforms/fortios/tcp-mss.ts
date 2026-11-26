// A TCP MSS clamp is the `tcp-mss` of an interface, which lowers the MSS of each SYN and SYN-ACK that arrives on it, IPv4 and IPv6 (TRAPS.md).

import type { Device, TcpMssRule } from "../../model";
import { FortiOsNames } from "./names";

export class FortiOsTcpMss {
    /** The MSS each port, LAG, or VLAN interface clamps each SYN that arrives on it to, by Circuit's name. */
    static of(device: Device): Map<string, number> {
        const clamps = new Map<string, number>();

        for (const rule of device.firewall?.tcp_mss ?? []) {
            const name = FortiOsTcpMss.interfaceOf(rule);
            if (name !== undefined && typeof rule.mss === "number" && !clamps.has(name)) clamps.set(name, rule.mss);
        }

        return clamps;
    }

    static gaps(device: Device): string[] {
        const found: string[] = [];
        const interfaces = device.interfaces;
        const clamps = FortiOsTcpMss.of(device);

        (device.firewall?.tcp_mss ?? []).forEach((rule, index) => {
            const where = `firewall.tcp_mss[${index}]`;
            const name = FortiOsTcpMss.interfaceOf(rule);

            if (rule.mss === "path_mtu") found.push(`${where}.mss path_mtu, FortiOS 6.2 clamps to a number of bytes: write it`);
            if (name === undefined) {
                found.push(
                    `${where}.if, FortiOS clamps every SYN that arrives on an interface, of both families: write if.in_interface alone`
                );
                return;
            }

            const port = interfaces?.ethernet?.[name];
            const clamping = (port && !port.in_lag) || interfaces?.lag?.[name] || interfaces?.vlan_interface?.[name];
            if (!clamping)
                found.push(`${where}.if.in_interface ${name}, which is not a port, LAG, or VLAN interface: FortiOS clamps on those`);

            const first = clamps.get(name);
            if (typeof rule.mss === "number" && first !== undefined && first !== rule.mss)
                found.push(`${where}.mss ${rule.mss}, unlike ${first} before it on ${name}: FortiOS clamps on an interface to one MSS`);
        });

        return found;
    }

    /** The interface a rule clamps on, when its match is that interface alone. */
    private static interfaceOf(rule: TcpMssRule): string | undefined {
        const others = Object.keys(rule.if ?? {}).filter((key) => key !== "in_interface");
        return others.length ? undefined : FortiOsNames.single(rule.if?.in_interface);
    }
}
