// Values derived from a device the same way everywhere: in checks, adapters, and integrations.

import { Address } from "./address";
import { Utils } from "./utils";
import type {
    AsNumbers,
    AsRange,
    Device,
    Family,
    FilterRule,
    Interface,
    InterfaceKind,
    NatRule,
    NeighborSettings,
    Port,
    Routed,
} from "../model";

/** A BGP neighbor's `max_prefixes` in its long form. Without `restart_after` or `warn_only`, the session stays closed. */
type PrefixLimit = { limit: number; restart_after?: number; warn_only?: boolean };

/** One interface of a device, with the group it is in. */
export type NamedInterface = { name: string; kind: InterfaceKind; settings: Interface };

/** A port or an interface that can hold an address, with its path, such as `interfaces.ethernet.10g-1`. */
export type Holder = { where: string; name: string; kind: "ethernet" | InterfaceKind; settings: Routed };

/** The uRPF mode that one setting for many interfaces would hold, as `Derive.sharedUrpf` finds it. */
export type SharedUrpf = {
    /** The mode, when every interface with an address of the family has it. */
    mode?: NonNullable<Routed["urpf"]>[Family];
    /** Each port and interface that sets a mode for the family. */
    setting: Holder[];
    /** The names of those with an address of the family and no mode for it. */
    missing: string[];
};

/** A feature a platform renders once tested on one of its devices. */
export type TestedFeature =
    | "bfd-timers"
    | "static-route-bfd"
    | "multihop-bfd"
    | "alarm-severity"
    | "mac-limit"
    | "ethertype-filter"
    | "port-binding"
    | "management-vdom"
    | "routing-tables";

/** A feature only some platforms build. */
export type BuiltFeature =
    | "eoip"
    | "round-robin-lag"
    | "link-check"
    | "shaping"
    | "port-shaping"
    | "tcp-mss"
    | "proxy-arp"
    | "dhcp-client"
    | "lag-mac"
    | "wireguard-table"
    | "upnp"
    | "nat-state"
    | "urpf";

export class Derive {
    /** The groups of `interfaces` besides `ethernet`, in the order Circuit reads them. */
    private static readonly KINDS: readonly InterfaceKind[] = [
        "lag",
        "vlan_interface",
        "bridge",
        "loopback",
        "gre",
        "vxlan",
        "wireguard",
        "eoip",
    ];

    /** Fields a platform renders only once they are tested on one of its devices. */
    private static readonly UNTESTED_PORT_FIELDS = [
        ["mac_limit", "mac-limit"],
        ["ethertypes", "ethertype-filter"],
        ["bound_to", "port-binding"],
    ] as const;

    /** The kinds of interface without `urpf`: no packet arrives on a loopback, and a bridge doesn't route. */
    private static readonly UNCHECKED_KINDS: readonly Holder["kind"][] = ["loopback", "bridge"];

    /** Each takes its sources from `management.allow`, on the protocol's own port. */
    private static readonly SWITCH_SERVICES = ["ssh", "telnet", "snmp"] as const;

    /** Every interface that is not a port, group by group (`KINDS`), each in the order it is written. */
    static interfaces(device: Device): NamedInterface[] {
        return Derive.KINDS.flatMap((kind) =>
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

    /** Ports, then interfaces group by group, that can hold an address. */
    static holders(device: Device): Holder[] {
        return [
            ...Derive.ports(device).map(([name, settings]): Holder => ({
                where: `interfaces.ethernet.${name}`,
                name,
                kind: "ethernet",
                settings,
            })),
            ...Derive.interfaces(device).map(({ name, kind, settings }): Holder => ({
                where: `interfaces.${kind}.${name}`,
                name,
                kind,
                settings,
            })),
        ];
    }

    /** Whether a port or an interface has an address of `family`. A DHCP client gives a port IPv4. */
    static hasFamily(settings: Routed | Port, family: Family): boolean {
        const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
        const dhcp = family === "ipv4" && "dhcp_client" in settings && Boolean(settings.dhcp_client);
        return dhcp || addresses.some((address) => Address.family(address) === family);
    }

    /** The one uRPF mode of `family` that `holders` share, for a platform that has one setting for all of them. Loopbacks and bridges have no `urpf`, and are left out. */
    static sharedUrpf(holders: readonly Holder[], family: Family): SharedUrpf {
        const checked = holders.filter(({ kind }) => !Derive.UNCHECKED_KINDS.includes(kind));
        const setting = checked.filter(({ settings }) => settings.urpf?.[family]);
        const routed = checked.filter(({ settings }) => Derive.hasFamily(settings, family));
        const modes = new Set([...setting, ...routed].map(({ settings }) => settings.urpf?.[family]));
        const missing = routed.filter(({ settings }) => !settings.urpf?.[family]).map(({ name }) => name);

        return { mode: modes.size === 1 ? [...modes][0] : undefined, setting, missing };
    }

    /** A port or an interface by its name, in any group. */
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

    /** A neighbor's prefix limit in its long form, or none. */
    static prefixLimit(settings: NeighborSettings): PrefixLimit | undefined {
        const max = settings.max_prefixes;
        return typeof max === "number" ? { limit: max } : max;
    }

    /** AS numbers as ranges, a single number as a range of one. */
    static asRanges(numbers: AsNumbers): AsRange[] {
        return [numbers].flat().map((each) => (typeof each === "number" ? { min: each, max: each } : each));
    }

    /** The IPv4 networks of a port's or an interface's addresses. */
    static ipv4Networks(device: Device, iface: string): string[] {
        const addresses = (Derive.settings(device, iface)?.addresses ?? []).map((entry) =>
            typeof entry === "string" ? entry : entry.address
        );

        return addresses.filter((address) => Address.family(address) === "ipv4").map((address) => Address.prefixOf(address));
    }

    /** Fields of features a platform does not build, each refused by name. A platform names the ones it builds. */
    static unbuilt(device: Device, built: readonly BuiltFeature[] = []): string[] {
        const found: string[] = [];
        const notBuilt = "which the platform does not build";
        const has = (feature: BuiltFeature) => built.includes(feature);

        if (!has("eoip")) for (const name of Object.keys(device.interfaces?.eoip ?? {})) found.push(`interfaces.eoip.${name}, ${notBuilt}`);

        for (const [name, lag] of Object.entries(device.interfaces?.lag ?? {})) {
            if (lag?.mode === "round_robin" && !has("round-robin-lag")) found.push(`interfaces.lag.${name}.mode round_robin, ${notBuilt}`);
            if (lag?.link_check && !has("link-check")) found.push(`interfaces.lag.${name}.link_check, ${notBuilt}`);
        }

        if (!has("shaping"))
            for (const { name, kind, settings } of Derive.interfaces(device))
                if (settings.shaping) found.push(`interfaces.${kind}.${name}.shaping, ${notBuilt}`);

        if (device.firewall?.tcp_mss && !has("tcp-mss")) found.push(`firewall.tcp_mss, ${notBuilt}`);

        for (const [name, port] of Derive.ports(device)) {
            if (port.dhcp_client && !has("dhcp-client")) found.push(`interfaces.ethernet.${name}.dhcp_client, ${notBuilt}`);
            if (port.shaping && !has("port-shaping")) found.push(`interfaces.ethernet.${name}.shaping, ${notBuilt}`);
        }
        for (const [name, lag] of Object.entries(device.interfaces?.lag ?? {}))
            if (lag?.mac && !has("lag-mac")) found.push(`interfaces.lag.${name}.mac, ${notBuilt}`);
        for (const [name, wireguard] of Object.entries(device.interfaces?.wireguard ?? {}))
            if (wireguard?.routing_table && !has("wireguard-table")) found.push(`interfaces.wireguard.${name}.routing_table, ${notBuilt}`);
        if (device.services?.upnp && !has("upnp")) found.push(`services.upnp, ${notBuilt}`);

        const chains: { where: string; rules: readonly (FilterRule | NatRule)[] | undefined }[] = [
            ...Object.entries(device.firewall?.filter ?? {}).map(([chain, settings]) => ({
                where: `firewall.filter.${chain}.rules`,
                rules: settings?.rules,
            })),
            { where: "firewall.nat.source", rules: device.firewall?.nat?.source },
            { where: "firewall.nat.destination", rules: device.firewall?.nat?.destination },
        ];
        if (!has("nat-state"))
            for (const { where, rules } of chains)
                (rules ?? []).forEach((rule, index) => {
                    if (rule.if?.connection_nat_state) found.push(`${where}[${index}].if.connection_nat_state, ${notBuilt}`);
                });

        if (!has("proxy-arp"))
            for (const [name, iface] of Object.entries(device.interfaces?.vlan_interface ?? {}))
                if (iface?.proxy_arp) found.push(`interfaces.vlan_interface.${name}.proxy_arp, ${notBuilt}`);

        if (!has("urpf"))
            for (const { where, settings } of Derive.holders(device)) if (settings.urpf) found.push(`${where}.urpf, ${notBuilt}`);

        return found;
    }

    /** Fields a platform refuses until it has tested them on a device. A platform names the ones it has tested, and the rest are refused. */
    static untested(device: Device, tested: readonly TestedFeature[] = []): string[] {
        const found: string[] = [];
        const routing = device.routing;
        const untested = "not tested on a device yet";
        const has = (feature: TestedFeature) => tested.includes(feature);

        if (routing?.bfd && !has("bfd-timers")) found.push(`routing.bfd, BFD timers are ${untested}`);
        if (device.system?.vdoms && !has("management-vdom")) found.push(`system.vdoms, a management VDOM is ${untested}`);

        for (const route of routing?.static_routes ?? []) {
            if (route.bfd && !has("static-route-bfd"))
                found.push(`routing.static_routes ${route.prefix} bfd, BFD on a static route is ${untested}`);
            if (Utils.otherTable(route.routing_table) && !has("routing-tables"))
                found.push(`routing.static_routes ${route.prefix} routing_table, a routing table beside the main one is ${untested}`);
        }

        if (!has("routing-tables")) {
            if (routing?.tables) found.push(`routing.tables, a routing table beside the main one is ${untested}`);
            if (routing?.policy_routing) found.push(`routing.policy_routing, policy routing is ${untested}`);
        }

        const bgp = routing?.bgp;

        for (const [name, group] of Object.entries(bgp?.neighbor_groups ?? {})) {
            if (Utils.otherTable(group?.routing_table) && !has("routing-tables"))
                found.push(`routing.bgp.neighbor_groups.${name}.routing_table, a routing table beside the main one is ${untested}`);
        }

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            if (!neighbor) continue;
            if (Utils.otherTable(neighbor.routing_table) && !has("routing-tables"))
                found.push(`routing.bgp.neighbors.${name}.routing_table, a routing table beside the main one is ${untested}`);

            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const bfd = neighbor.bfd ?? group?.bfd;
            const multihop = neighbor.multihop ?? group?.multihop;

            if (bfd && multihop && !has("multihop-bfd"))
                found.push(`routing.bgp.neighbors.${name}.bfd, BFD on a multihop session is ${untested}`);
        }

        if (!has("alarm-severity")) {
            for (const name of Object.keys(device.system?.alarms ?? {})) {
                found.push(`system.alarms.${name}, an alarm's severity is ${untested}`);
            }
        }

        const holders: { where: string; settings: Pick<Port, (typeof Derive.UNTESTED_PORT_FIELDS)[number][0]> | undefined }[] = [
            ...Derive.ports(device).map(([name, settings]) => ({ where: `interfaces.ethernet.${name}`, settings })),
            ...Object.entries(device.interfaces?.lag ?? {}).map(([name, settings]) => ({ where: `interfaces.lag.${name}`, settings })),
        ];

        for (const { where, settings } of holders) {
            for (const [field, feature] of Derive.UNTESTED_PORT_FIELDS) {
                if (settings?.[field] !== undefined && !has(feature)) found.push(`${where}.${field}, ${untested}`);
            }
        }

        return found;
    }

    /**
     * Fields neither switch platform, VRP nor Raisecom ROS, expresses. They are a service's own sources or port, a user's description or keys, the IP stack's host settings, a point-to-point address, and offload per interface. `ownSources` names the services a platform gives their own sources.
     */
    static switchUnsupported(device: Device, ownSources: readonly ("ssh" | "telnet" | "snmp")[] = [], takesKeys = false): string[] {
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
            if (user?.ssh_keys?.length && !takesKeys) found.push(`system.users.${name}.ssh_keys`);
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
