// Layer 3 on Raisecom ROS: the addresses of routed ports, loopbacks, and VLAN interfaces, and static routes. A RAX721 on ROS 6.5.2 showed how it prints each.

import { Address } from "../../core/address";
import { Catalog } from "../../core/catalog";
import type { Device, Port, Routed } from "../../model";
import { RaisecomRosOspf } from "./ospf";

export class RaisecomRosRouting {
    /** A loopback's number: the switch takes 1 to 1024. */
    static readonly LOOPBACK = { min: 1, max: 1024 };

    /** Whether a port routes: it has an address. A port without `portswitch` routes on this switch. */
    static routes(port: Port): boolean {
        return Boolean(port.addresses?.length);
    }

    /** Each loopback's number, by its place among the device's loopbacks, from 1. */
    static loopbackIds(device: Device): Map<string, number> {
        const ids = new Map<string, number>();
        for (const [name, loopback] of Object.entries(device.interfaces?.loopback ?? {}))
            if (loopback) ids.set(name, RaisecomRosRouting.LOOPBACK.min + ids.size);
        return ids;
    }

    /** The VRF of a routed port, a loopback, or a VLAN interface, then its IPv4 addresses, each with its mask. IPv6 is refused. */
    static addressLines(settings: Pick<Routed, "addresses" | "vrf">): string[] {
        const lines = settings.vrf ? [`ip vrf forwarding ${settings.vrf}`] : [];

        for (const entry of settings.addresses ?? []) {
            const address = typeof entry === "string" ? entry : entry.address;
            if (Address.family(address) === "ipv4")
                lines.push(`ip address ${Address.host(address)} ${Address.netmask(Address.split(address).len)}`);
        }

        return lines;
    }

    /** An interface's layer 3 lines: its VRF and addresses, the routing protocols that run on it, and its uRPF check (RFC 3704). */
    static layer3(device: Device, name: string, settings: Pick<Routed, "addresses" | "vrf"> & { urpf?: Routed["urpf"] }): string[] {
        const lines = [...RaisecomRosRouting.addressLines(settings), ...RaisecomRosOspf.interfaceLines(device, name)];
        if (settings.urpf?.ipv4) lines.push(`ip urpf ${settings.urpf.ipv4}`);
        return lines;
    }

    /** Each VRF, a block of its own that holds nothing: its interfaces and routes name it. */
    static vrfs(device: Device): string[] {
        return Object.entries(device.routing?.vrfs ?? {}).flatMap(([name, vrf]) => (vrf ? [`ip vrf ${name}`, "!"] : []));
    }

    /** Each loopback as a block: always up, on no link. */
    static loopbacks(device: Device): string[] {
        const ids = RaisecomRosRouting.loopbackIds(device);

        return Object.entries(device.interfaces?.loopback ?? {}).flatMap(([name, loopback]) =>
            loopback ? [`interface loopback ${ids.get(name)}`, ...RaisecomRosRouting.layer3(device, name, loopback), "!"] : []
        );
    }

    /** The interface a route names after its next hop, as the switch spells it: a port, or a VLAN interface by its VLAN. Undefined for any other. */
    static routeInterface(device: Device, name: string): string | undefined {
        if (device.interfaces?.ethernet?.[name]) return Catalog.spell(device.platform, device.model, name);

        const vlan = device.interfaces?.vlan_interface?.[name]?.vlan;
        const id = vlan === undefined ? undefined : device.switching?.vlans?.[vlan]?.id;
        return id === undefined ? undefined : `vlan ${id}`;
    }

    /** The BFD session for each next hop a static route watches, numbered from 1 in the order the routes come, with the VLAN its interface is on. A next hop on no VLAN interface's network has none. */
    static bfdSessions(device: Device): Map<string, { id: number; vlan: string }> {
        const sessions = new Map<string, { id: number; vlan: string }>();

        for (const route of device.routing?.static_routes ?? []) {
            const nextHop = route.next_hop;
            if (!route.bfd || !nextHop || sessions.has(nextHop)) continue;

            const holder = Object.values(device.interfaces?.vlan_interface ?? {}).find((iface) =>
                (iface?.addresses ?? []).some((entry) => {
                    const address = typeof entry === "string" ? entry : entry.address;
                    return Address.family(address) === "ipv4" && Address.contains(Address.prefixOf(address), nextHop);
                })
            );

            if (holder) sessions.set(nextHop, { id: sessions.size + 1, vlan: holder.vlan });
        }

        return sessions;
    }

    /** IPv4 routes to a next hop, with the interface that reaches it when written, and with the BFD session that watches it. */
    static staticRoutes(device: Device): string[] {
        const sessions = RaisecomRosRouting.bfdSessions(device);
        const lines: string[] = [];

        for (const route of device.routing?.static_routes ?? []) {
            const { addr, len } = Address.split(route.prefix);
            if (Address.family(addr) !== "ipv4" || !route.next_hop) continue;

            const iface = route.interface ? RaisecomRosRouting.routeInterface(device, route.interface) : undefined;
            const session = route.bfd ? sessions.get(route.next_hop) : undefined;
            let line = `ip route ${route.vrf ? `vrf ${route.vrf} ` : ""}${addr} ${Address.netmask(len)} ${route.next_hop}`;
            if (iface) line += ` ${iface}`;
            if (session) line += ` track bfd ${session.id}`;
            lines.push(line);
        }

        return lines;
    }
}
