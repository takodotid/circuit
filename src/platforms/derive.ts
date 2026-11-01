// Values more than one adapter derives from a device in the same way.

import { Address } from "../core/address";
import { Utils } from "../core/utils";
import type { Device, Interface, InterfaceKind, Port } from "../model";

/** One interface of a device, with the group it is in. */
export type NamedInterface = { name: string; kind: InterfaceKind; settings: Interface };

/** The groups of `interfaces` besides `ethernet`, in the order Circuit reads them. */
const KINDS: readonly InterfaceKind[] = ["lag", "vlan_interface", "bridge", "loopback", "gre", "vxlan", "wireguard"];

/** A feature a platform renders once proved on one of its devices. */
export type ProvedFeature =
    | "bfd-timers"
    | "static-route-bfd"
    | "multihop-bfd"
    | "alarm-severity"
    | "mac-limit"
    | "ethertype-filter"
    | "management-vdom"
    | "routing-tables";

export class Derive {
    /** Every interface that is not a port, group by group (`KINDS`), each in the order it is written. */
    static interfaces(device: Device): NamedInterface[] {
        return KINDS.flatMap((kind) =>
            Object.entries<Interface | undefined>(device.interfaces?.[kind] ?? {}).flatMap(([name, settings]) =>
                settings ? [{ name, kind, settings }] : []
            )
        );
    }

    /** Every port the device writes, in the order it is written. */
    static ports(device: Device): [string, Port][] {
        return Object.entries<Port | undefined>(device.interfaces?.ethernet ?? {}).flatMap(([name, port]) =>
            port ? [[name, port] as [string, Port]] : []
        );
    }

    /** A port or an interface by its name, whatever group it is in. */
    static settings(device: Device, name: string): Port | Interface | undefined {
        return device.interfaces?.ethernet?.[name] ?? Derive.interfaces(device).find((entry) => entry.name === name)?.settings;
    }

    /** Each LAG's number: its own `id`, or its position among the device's LAGs. */
    static lagIds(device: Device): Map<string, number> {
        const numbers = new Map<string, number>();
        let position = 0;

        for (const [name, lag] of Object.entries(device.interfaces?.lag ?? {})) {
            position++;
            numbers.set(name, lag?.id ?? position);
        }

        return numbers;
    }

    /** The IPv4 networks of a port's or an interface's addresses. */
    static ipv4Networks(device: Device, iface: string): string[] {
        const addresses = (Derive.settings(device, iface)?.addresses ?? []).map((entry) =>
            typeof entry === "string" ? entry : entry.address
        );

        return addresses.filter((address) => Address.family(address) === "ipv4").map((address) => Address.prefixOf(address));
    }

    /** Fields a platform renders only once they are proved on one of its devices. */
    private static readonly UNPROVED_PORT_FIELDS = ["mac_limit", "ethertypes"] as const;

    /** Fields a platform refuses until it has proved them on a device. A platform names the ones it has proved, and the rest are refused. */
    static unproved(device: Device, proved: readonly ProvedFeature[] = []): string[] {
        const found: string[] = [];
        const routing = device.routing;
        const unproved = "not proved on a device yet";
        const has = (feature: ProvedFeature) => proved.includes(feature);

        if (routing?.bfd && !has("bfd-timers")) found.push(`routing.bfd, BFD timers are ${unproved}`);
        if (device.system?.vdoms && !has("management-vdom")) found.push(`system.vdoms, a management VDOM is ${unproved}`);

        for (const route of routing?.static_routes ?? []) {
            if (route.bfd && !has("static-route-bfd"))
                found.push(`routing.static_routes ${route.prefix} bfd, BFD on a static route is ${unproved}`);
            if (Utils.otherTable(route.routing_table) && !has("routing-tables"))
                found.push(`routing.static_routes ${route.prefix} routing_table, a routing table beside the main one is ${unproved}`);
        }

        if (!has("routing-tables")) {
            if (routing?.tables) found.push(`routing.tables, a routing table beside the main one is ${unproved}`);
            if (routing?.policy_routing) found.push(`routing.policy_routing, policy routing is ${unproved}`);
        }

        const bgp = routing?.bgp;

        for (const [name, group] of Object.entries(bgp?.neighbor_groups ?? {})) {
            if (Utils.otherTable(group?.routing_table) && !has("routing-tables"))
                found.push(`routing.bgp.neighbor_groups.${name}.routing_table, a routing table beside the main one is ${unproved}`);
        }

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            if (!neighbor) continue;
            if (Utils.otherTable(neighbor.routing_table) && !has("routing-tables"))
                found.push(`routing.bgp.neighbors.${name}.routing_table, a routing table beside the main one is ${unproved}`);

            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const bfd = neighbor.bfd ?? group?.bfd;
            const multihop = neighbor.multihop ?? group?.multihop;

            if (bfd && multihop && !has("multihop-bfd"))
                found.push(`routing.bgp.neighbors.${name}.bfd, BFD on a multihop session is ${unproved}`);
        }

        if (!has("alarm-severity")) {
            for (const name of Object.keys(device.system?.alarms ?? {})) {
                found.push(`system.alarms.${name}, an alarm's severity is ${unproved}`);
            }
        }

        const holders: { where: string; settings: { mac_limit?: number; ethertypes?: readonly string[] } | undefined }[] = [
            ...Derive.ports(device).map(([name, settings]) => ({ where: `interfaces.ethernet.${name}`, settings })),
            ...Object.entries(device.interfaces?.lag ?? {}).map(([name, settings]) => ({ where: `interfaces.lag.${name}`, settings })),
        ];

        for (const { where, settings } of holders) {
            for (const field of Derive.UNPROVED_PORT_FIELDS) {
                const feature = field === "mac_limit" ? "mac-limit" : "ethertype-filter";
                if (settings?.[field] !== undefined && !has(feature)) found.push(`${where}.${field}, ${unproved}`);
            }
        }

        return found;
    }

    /** Services the switch platforms run. Each takes its sources from `management.allow`, on the protocol's own port. */
    private static readonly SWITCH_SERVICES = ["ssh", "telnet", "snmp"] as const;

    /** Fields neither switch platform, VRP nor Raisecom ROS, expresses: a service's own sources or port, a user's description or keys, the IP stack's host settings, a point-to-point address, and offload per interface. `ownSources` names the services a platform gives their own sources. */
    static switchUnsupported(device: Device, ownSources: readonly ("ssh" | "telnet" | "snmp")[] = []): string[] {
        const found: string[] = [];

        for (const service of Derive.SWITCH_SERVICES) {
            // SNMP is in `monitoring`, the other services in `management`.
            const group = service === "snmp" ? "monitoring" : "management";
            const settings = service === "snmp" ? device.monitoring?.snmp : device.management?.[service];
            if (settings?.allow && !ownSources.includes(service))
                found.push(`${group}.${service}.allow, every service takes management.allow`);
            if (settings?.port) found.push(`${group}.${service}.port`);
        }

        for (const [name, user] of Object.entries(device.system?.users ?? {})) {
            if (user?.description) found.push(`system.users.${name}.description`);
            if (user?.ssh_keys?.length) found.push(`system.users.${name}.ssh_keys`);
        }

        if (device.system?.ip_stack) found.push("system.ip_stack");

        for (const [name, port] of Derive.ports(device)) {
            if (port.hardware_offload !== undefined) found.push(`interfaces.ethernet.${name}.hardware_offload`);
        }

        for (const { name, kind, settings } of Derive.interfaces(device)) {
            if (settings.addresses?.some((entry) => typeof entry !== "string"))
                found.push(`interfaces.${kind}.${name}.addresses with a peer`);
            if (settings.hardware_offload !== undefined) found.push(`interfaces.${kind}.${name}.hardware_offload`);
        }

        return found;
    }
}
