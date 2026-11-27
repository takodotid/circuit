// Values derived from a device the same way everywhere: in checks, adapters, and integrations.

import { presets } from "../config/presets";
import { Address } from "./address";
import { Utils } from "./utils";
import type {
    AdvertisedPrefix,
    AsNumbers,
    AsRange,
    BgpFamily,
    BoundHost,
    DeterministicPoolNatRule,
    Device,
    Dhcpv6Server,
    Dscp,
    EvpnVxlan,
    Family,
    FilterRule,
    Interface,
    InterfaceKind,
    Isis,
    IsisAuthentication,
    Lag,
    Limit,
    NatRule,
    NeighborSettings,
    Port,
    PortRange,
    Prefix,
    QosTrust,
    Rate,
    RateLimit,
    Routed,
    RouteMatch,
    RouteRule,
    RouterAdvertisement,
    TwoRateLimit,
} from "../model";

/** A BGP neighbor's `max_prefixes` in its long form. Without `restart_after` or `warn_only`, the session stays closed. */
type PrefixLimit = { limit: number; restart_after?: number; warn_only?: boolean };

/** A route the device makes itself: a prefix of `originated_prefixes`, or an aggregate. */
type OwnRoute = "originated" | "aggregate";

/** What a route policy does with a route, `unknown` when the config can't tell. */
type PolicyOutcome = "accept" | "reject" | "unknown";

/** A route the config has a BGP neighbor sent, its prefix in one spelling (`Address.canonical`). */
type Announcement = { neighbor: string; prefix: string };

/** A port, a LAG, or a VLAN interface with a rate limit, with its path, such as `interfaces.ethernet.10g-1`. */
export type RateLimited = { where: string; name: string; kind: "ethernet" | "lag" | "vlan_interface"; rateLimit: RateLimit };

/** A port, a LAG, or a VLAN interface with a scheduler, by its name in `qos.schedulers`, with its path. */
export type Scheduled = { where: string; name: string; kind: "ethernet" | "lag" | "vlan_interface"; scheduler: string };

/** A port, a LAG, or a VLAN interface that trusts what a packet arrives with, with its path. */
export type Trusting = { where: string; name: string; kind: "ethernet" | "lag" | "vlan_interface"; trust: readonly QosTrust[] };

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

/** One address of a NAT pool: the subscribers that leave as it, a prefix, and each one's block of ports. */
export type PoolAddress = { address: string; subscribers: Prefix; blocks: { subscriber: string; ports: PortRange }[] };

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
    | "urpf"
    | "vrf-imports"
    | "rate-limit"
    | "rate-limit-per-prefix"
    | "marking"
    | "marking-class"
    | "queues"
    | "qos-trust"
    | "ospf-ranges"
    | "ospf-priority"
    | "ospf-unicast-links"
    | "ospf-range-cost"
    | "ospf-virtual-links"
    | "ospf-traffic-engineering";

export class Derive {
    /** The ports a NAT pool hands out: the system ports below them stay out (RFC 7422, section 2; RFC 6335). */
    static readonly POOL_PORTS: PortRange = { min: 1024, max: 65535 };

    /** The groups of `interfaces` besides `ethernet`, in the order Circuit reads them. */
    private static readonly KINDS: readonly InterfaceKind[] = [
        "lag",
        "vlan_interface",
        "bridge",
        "loopback",
        "gre",
        "vxlan",
        "ipsec",
        "wireguard",
        "eoip",
        "pseudowire",
        "pppoe_client",
    ];

    /** Fields a platform renders only once they are tested on one of its devices. */
    private static readonly UNTESTED_PORT_FIELDS = [
        ["mac_limit", "mac-limit"],
        ["ethertypes", "ethertype-filter"],
        ["bound_to", "port-binding"],
    ] as const;

    /** The sources every host on a bound port sends from (`boundSources`). */
    private static readonly BOUND_ALWAYS: Readonly<Record<Family, readonly string[]>> = {
        ipv4: ["0.0.0.0/32"],
        ipv6: ["fe80::/10", "::/128"],
    };

    /** The kinds of interface without `urpf`: no packet arrives on a loopback, and a bridge or a pseudowire doesn't route. */
    private static readonly UNCHECKED_KINDS: readonly Holder["kind"][] = ["loopback", "bridge", "pseudowire"];

    /** Bits per second in each unit a `Rate` takes. */
    static readonly RATE_UNITS = { k: 1e3, M: 1e6, G: 1e9 } as const;

    static readonly BITS_PER_BYTE = 8;

    /** Each DSCP's value, from the IANA DSCP registry. */
    static readonly DSCP: Readonly<Record<Dscp, number>> = {
        cs0: 0,
        cs1: 8,
        cs2: 16,
        cs3: 24,
        cs4: 32,
        cs5: 40,
        cs6: 48,
        cs7: 56,
        af11: 10,
        af12: 12,
        af13: 14,
        af21: 18,
        af22: 20,
        af23: 22,
        af31: 26,
        af32: 28,
        af33: 30,
        af41: 34,
        af42: 36,
        af43: 38,
        ef: 46,
        "voice-admit": 44,
        le: 1,
        nqb: 45,
    };

    /** The ways into the device in `management`. */
    private static readonly MANAGEMENT_SERVICES = ["ssh", "telnet", "http", "https", "api", "api_tls", "ftp", "native_protocol"] as const;

    /** Each takes its sources from `management.allow`, on the protocol's own port. */
    private static readonly SWITCH_SERVICES = ["ssh", "telnet", "snmp"] as const;

    /** IPv6 link-local addresses (RFC 4291). */
    private static readonly LINK_LOCAL = "fe80::/10";

    /** The family that carries VPLS routes between PEs (RFC 4761, RFC 6074). */
    static readonly VPLS_FAMILY = "l2vpn-vpls";

    /** The fewest seconds between two router advertisements (RFC 4861, MinRtrAdvInterval). */
    private static readonly MIN_RA_INTERVAL = 3;
    /** The least interval between router advertisements is the most divided by this (RFC 4861). */
    private static readonly RA_INTERVAL_SHARE = 3;

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

    /**
     * What a host on a bound port may send IP packets from, in each family, each with its length. These are its own addresses, then those every host sends from. That is `0.0.0.0` while it asks DHCP for an address, and IPv6's link-local addresses and `::` while it checks that an address is free.
     */
    static boundSources(host: BoundHost): Record<Family, string[]> {
        const own = (family: Family) =>
            host.addresses.filter((address) => Address.family(address.split("/")[0]!) === family).map(Address.withLength);
        return { ipv4: [...own("ipv4"), ...Derive.BOUND_ALWAYS.ipv4], ipv6: [...own("ipv6"), ...Derive.BOUND_ALWAYS.ipv6] };
    }

    /** Ports, then LAGs: what can switch, with where each is written. */
    static switchedHolders(device: Device): { where: string; settings: Port | Lag }[] {
        const lags = Object.entries(device.interfaces?.lag ?? {}).flatMap(([name, lag]) =>
            lag ? [{ where: `interfaces.lag.${name}`, settings: lag }] : []
        );
        return [...Derive.ports(device).map(([name, settings]) => ({ where: `interfaces.ethernet.${name}`, settings })), ...lags];
    }

    /** Where IEEE 802.1ad's TPID is set on a port or LAG, and where a VLAN interface ends an inner VLAN (QinQ): `interfaces.lag.uplink.tpid`. */
    static stackedTags(device: Device): { tpid: string[]; innerVlans: string[] } {
        const vlanInterfaces = Object.entries(device.interfaces?.vlan_interface ?? {});
        return {
            tpid: Derive.switchedHolders(device).flatMap(({ where, settings }) => (settings.tpid === "0x88a8" ? [`${where}.tpid`] : [])),
            innerVlans: vlanInterfaces.flatMap(([name, iface]) =>
                iface?.inner_vlan_id === undefined ? [] : [`interfaces.vlan_interface.${name}.inner_vlan_id`]
            ),
        };
    }

    /** Each port, LAG, and VLAN interface with a rate limit. */
    static rateLimited(device: Device): RateLimited[] {
        const kinds = ["ethernet", "lag", "vlan_interface"] as const;
        return kinds.flatMap((kind) =>
            Object.entries<{ rate_limit?: RateLimit } | undefined>(device.interfaces?.[kind] ?? {}).flatMap(([name, settings]) =>
                settings?.rate_limit ? [{ where: `interfaces.${kind}.${name}`, name, kind, rateLimit: settings.rate_limit }] : []
            )
        );
    }

    /** Each port, LAG, and VLAN interface with a scheduler. */
    static scheduled(device: Device): Scheduled[] {
        const kinds = ["ethernet", "lag", "vlan_interface"] as const;
        return kinds.flatMap((kind) =>
            Object.entries<{ scheduler?: string } | undefined>(device.interfaces?.[kind] ?? {}).flatMap(([name, settings]) =>
                settings?.scheduler ? [{ where: `interfaces.${kind}.${name}`, name, kind, scheduler: settings.scheduler }] : []
            )
        );
    }

    /** Each port, LAG, and VLAN interface whose `qos_trust` lists something. */
    static trusting(device: Device): Trusting[] {
        const kinds = ["ethernet", "lag", "vlan_interface"] as const;
        return kinds.flatMap((kind) =>
            Object.entries<{ qos_trust?: readonly QosTrust[] } | undefined>(device.interfaces?.[kind] ?? {}).flatMap(([name, settings]) =>
                settings?.qos_trust?.length ? [{ where: `interfaces.${kind}.${name}`, name, kind, trust: settings.qos_trust }] : []
            )
        );
    }

    /** Whether a rate limit's direction has two rates (RFC 2698). */
    static isTwoRate(limit: Limit | TwoRateLimit): limit is TwoRateLimit {
        return typeof limit === "object" && limit.pir !== undefined;
    }

    /** A rate limit's direction with one rate. Undefined for two rates, which a platform that builds none refuses in `unsupported()`. */
    static oneRate(limit: Limit | TwoRateLimit | undefined): Limit | undefined {
        return limit === undefined || Derive.isTwoRate(limit) ? undefined : limit;
    }

    /** Each direction of a rate limit with two rates, with its path, such as `interfaces.ethernet.10g-1.rate_limit.input`. */
    static twoRates(device: Device): { where: string; limit: TwoRateLimit }[] {
        return Derive.rateLimited(device).flatMap(({ where, rateLimit }) =>
            (["input", "output"] as const).flatMap((direction) => {
                const limit = rateLimit[direction];
                return limit && Derive.isTwoRate(limit) ? [{ where: `${where}.rate_limit.${direction}`, limit }] : [];
            })
        );
    }

    /** Where a rate limit limits what leaves: its `output`, else its `per_prefix.output`. */
    static limitsOutput(rateLimit: RateLimit): "output" | "per_prefix.output" | undefined {
        if (rateLimit.output) return "output";
        if (rateLimit.per_prefix?.output) return "per_prefix.output";
        return undefined;
    }

    /** A rate limit's rate, and its burst in bytes when it sets one. */
    static limit(limit: Limit): { rate: Rate; burst?: number } {
        return typeof limit === "string" ? { rate: limit } : { rate: limit.cir, burst: limit.bc };
    }

    /** A rate in bits per second: `200M` is 200000000. */
    static bitsPerSecond(rate: Rate): number {
        return Number(rate.slice(0, -1)) * Derive.RATE_UNITS[rate.slice(-1) as keyof typeof Derive.RATE_UNITS];
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

    /** What the interface's router advertisements say, `{}` for `ipv6_ra: true`. Undefined when it sends none. */
    static routerAdvertisement(settings: Pick<Routed, "ipv6_ra">): RouterAdvertisement | undefined {
        const ra = settings.ipv6_ra;
        if (!ra) return undefined;
        return ra === true ? {} : ra;
    }

    /** The prefixes the interface's router advertisements announce: those written, or else each IPv6 network of the interface. None when it sends none. */
    static advertisedPrefixes(
        settings: Pick<Routed, "ipv6_ra"> & { addresses?: readonly (string | { address: string })[] }
    ): AdvertisedPrefix[] {
        const ra = Derive.routerAdvertisement(settings);
        if (!ra) return [];
        if (ra.prefixes) return [...ra.prefixes];

        return Derive.ipv6Networks(settings).map((prefix) => ({ prefix }));
    }

    /** Each IPv6 network the port or interface has an address in, once, in the order of its addresses. */
    static ipv6Networks(settings: { addresses?: readonly (string | { address: string })[] }): Prefix[] {
        const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
        const networks = addresses.filter((address) => Address.family(address) === "ipv6").map((address) => Address.prefixOf(address));
        return [...new Set(networks)];
    }

    /** The IPv6 network a DHCPv6 server serves: the network of its interface that holds its pool, or else the interface's first. Undefined when the interface has no IPv6 address. */
    static dhcpv6Network(device: Device, server: Dhcpv6Server): Prefix | undefined {
        const networks = Derive.ipv6Networks(Derive.settings(device, server.interface) ?? {});
        const pool = server.pool;
        if (!pool) return networks[0];
        return networks.find((network) => pool.every((address) => Address.isValid(address) && Address.contains(network, address)));
    }

    /** The least seconds between two router advertisements for the most, `interval`: a third of it and no less than 3, as RFC 4861 sets MinRtrAdvInterval. */
    static minAdvertisementInterval(interval: number): number {
        return Math.max(Derive.MIN_RA_INTERVAL, Math.floor(interval / Derive.RA_INTERVAL_SHARE));
    }

    /** Whether a port or an interface has an address of `family`. A DHCP client gives a port IPv4. */
    static hasFamily(settings: Routed | Port, family: Family): boolean {
        const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
        const dhcp = family === "ipv4" && "dhcp_client" in settings && Boolean(settings.dhcp_client);
        return dhcp || addresses.some((address) => Address.family(address) === family);
    }

    /**
     * Whether `address` is on a network of the device in `vrf`, or in the main table without one. A network is the prefix of an address of a port or an interface there, or its `peer_address`. A link-local address is on a link of its own. Undefined when a DHCP client there leaves the IPv4 networks unknown.
     */
    static sharesNetwork(device: Device, address: string, vrf: string | undefined): boolean | undefined {
        // `fe80::1%ether1`, as some devices write a link-local address.
        const host = address.split("%")[0]!;
        const family = Address.family(host);
        if (family === "ipv6" && Address.contains(Derive.LINK_LOCAL, host)) return true;

        const holders = Derive.holders(device).filter(({ settings }) => settings.vrf === vrf);
        const onNetwork = (entry: NonNullable<Routed["addresses"]>[number]) =>
            typeof entry === "string"
                ? Address.contains(entry, host)
                : entry.peer_address === host || Address.contains(entry.address, host);
        if (holders.some(({ settings }) => (settings.addresses ?? []).some(onNetwork))) return true;

        const dhcp = holders.some(({ settings }) => "dhcp_client" in settings && Boolean(settings.dhcp_client));
        return family === "ipv4" && dhcp ? undefined : false;
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

    /** The `ipv4` and `ipv6` routes a BGP session carries: the families it states, or its address's when it states none. A VPN family is left out. */
    static unicastFamilies(settings: Pick<NeighborSettings, "address_families">, address: string): Family[] {
        const families = settings.address_families ?? [Address.family(address)];
        return families.filter((family): family is Family => family === "ipv4" || family === "ipv6");
    }

    /** The VPN families a BGP session carries between PEs: `vpnv4`, `vpnv6`, and `l2vpn-vpls`. */
    static vpnFamilies(settings: Pick<NeighborSettings, "address_families">): BgpFamily[] {
        return (settings.address_families ?? []).filter(
            (family) => family === "vpnv4" || family === "vpnv6" || family === Derive.VPLS_FAMILY
        );
    }

    /** Where the device writes an L3VPN: each VRF's route distinguisher, route targets, and policies, and each neighbor or group that carries `vpnv4` or `vpnv6`. */
    static l3vpn(device: Device): string[] {
        const found: string[] = [];
        for (const [name, vrf] of Object.entries(device.routing?.vrfs ?? {})) {
            if (vrf?.route_distinguisher !== undefined) found.push(`routing.vrfs.${name}.route_distinguisher`);
            if (vrf?.route_targets) found.push(`routing.vrfs.${name}.route_targets`);
            for (const way of ["import_policy", "export_policy"] as const) if (vrf?.[way]) found.push(`routing.vrfs.${name}.${way}`);
        }

        for (const { where, settings } of Derive.bgpSessions(device)) {
            const families = Derive.vpnFamilies(settings).filter((family) => family !== Derive.VPLS_FAMILY);
            if (families.length) found.push(`${where}.address_families ${families.join(" and ")}`);
        }
        return found;
    }

    /** Whether a BGP session carries EVPN routes, `l2vpn-evpn`. */
    static carriesEvpn(settings: Pick<NeighborSettings, "address_families">): boolean {
        return (settings.address_families ?? []).includes("l2vpn-evpn");
    }

    /** Each VXLAN segment in EVPN, by its name. */
    static evpnVxlans(device: Device): [string, EvpnVxlan][] {
        return Object.entries(device.interfaces?.vxlan ?? {}).flatMap(([name, vxlan]) =>
            vxlan?.evpn ? [[name, vxlan as EvpnVxlan] as [string, EvpnVxlan]] : []
        );
    }

    /** Where the device writes EVPN: each VXLAN segment in it, and each neighbor or group that carries `l2vpn-evpn`. */
    static evpn(device: Device): string[] {
        const bgp = device.routing?.bgp;
        const sessions = [
            ...Object.entries(bgp?.neighbor_groups ?? {}).map(([name, settings]) => ({ where: `neighbor_groups.${name}`, settings })),
            ...Object.entries(bgp?.neighbors ?? {}).map(([name, settings]) => ({ where: `neighbors.${name}`, settings })),
        ];
        return [
            ...Derive.evpnVxlans(device).map(([name]) => `interfaces.vxlan.${name}`),
            ...sessions
                .filter(({ settings }) => Derive.carriesEvpn(settings ?? {}))
                .map(({ where }) => `routing.bgp.${where}.address_families l2vpn-evpn`),
        ];
    }

    /** Where the device writes a VPLS whose PEs BGP finds (RFC 4761, RFC 6074): each VLAN's `vpls`, and each neighbor or group that carries `l2vpn-vpls`. */
    static vpls(device: Device): string[] {
        const vlans = Object.entries(device.switching?.vlans ?? {}).flatMap(([name, vlan]) =>
            vlan?.vpls ? [`switching.vlans.${name}.vpls`] : []
        );
        const sessions = Derive.bgpSessions(device).flatMap(({ where, settings }) =>
            settings.address_families?.includes(Derive.VPLS_FAMILY) ? [`${where}.address_families ${Derive.VPLS_FAMILY}`] : []
        );
        return [...vlans, ...sessions];
    }

    /** Each BGP neighbor group and neighbor, with where it is written: `routing.bgp.neighbors.pe-02`. */
    private static bgpSessions(device: Device): { where: string; settings: NeighborSettings }[] {
        const bgp = device.routing?.bgp;
        return [
            ...Object.entries(bgp?.neighbor_groups ?? {}).map(([name, settings]) => ({
                where: `routing.bgp.neighbor_groups.${name}`,
                settings,
            })),
            ...Object.entries(bgp?.neighbors ?? {}).map(([name, settings]) => ({ where: `routing.bgp.neighbors.${name}`, settings })),
        ].flatMap(({ where, settings }) => (settings ? [{ where, settings }] : []));
    }

    /** A neighbor's prefix limit in its long form, or none. */
    static prefixLimit(settings: NeighborSettings): PrefixLimit | undefined {
        const max = settings.max_prefixes;
        return typeof max === "number" ? { limit: max } : max;
    }

    /**
     * What the config has each BGP neighbor sent of the routes the device makes, in its session's families. That is a default route with `send_default_route`, and each of `originated_prefixes` and `aggregates` its export accepts, unless a `summary_only` aggregate holds it. A prefix the export decides by what the config can't tell, such as an AS path, is left out: a check neither waits for it nor fails on it.
     */
    static announcements(device: Device): Announcement[] {
        const bgp = device.routing?.bgp;
        const aggregates = bgp?.aggregates ?? [];
        const suppressed = (prefix: string) =>
            aggregates.some(
                (aggregate) =>
                    aggregate.summary_only &&
                    Address.split(aggregate.prefix).len < Address.split(prefix).len &&
                    Address.contains(aggregate.prefix, prefix)
            );
        const own: { prefix: string; route: OwnRoute }[] = [
            ...(bgp?.originated_prefixes ?? [])
                .filter((prefix) => !suppressed(prefix))
                .map((prefix) => ({ prefix, route: "originated" as const })),
            ...aggregates.map(({ prefix }) => ({ prefix, route: "aggregate" as const })),
        ];

        return Object.entries(bgp?.neighbors ?? {}).flatMap(([neighbor, written]) => {
            const group = written.neighbor_group ? bgp?.neighbor_groups?.[written.neighbor_group] : undefined;
            const settings = { ...group, ...written };
            const families = Derive.unicastFamilies(settings, written.address);
            const policy = settings.export_policy;

            const defaults = settings.send_default_route ? families.map((family) => presets.default_routes[family]) : [];
            const exported = own.filter(
                ({ prefix, route }) =>
                    families.includes(Address.split(prefix).family) &&
                    policy !== undefined &&
                    Derive.exportOf(device, policy, prefix, route) === "accept"
            );
            const prefixes = new Set([...defaults, ...exported.map(({ prefix }) => prefix)].map((prefix) => Address.canonical(prefix)));

            return [...prefixes].map((prefix) => ({ neighbor, prefix }));
        });
    }

    /**
     * What an export policy does with a route the device makes itself, whose AS path and RPKI state the config can't tell. An originated route carries no community until a rule adds one. An aggregate may carry those of the routes inside it (RFC 1997), so a match on a community is `unknown` for it. Nothing when no rule decides.
     */
    static exportOf(device: Device, policy: string, prefix: string, route: OwnRoute): PolicyOutcome | undefined {
        return Derive.ownRouteThrough(device, policy, prefix, { tagged: route === "aggregate" }, []);
    }

    /** `exportOf` from one policy on. `carried.tagged` turns true once the route may carry a community. A policy that calls itself is `unknown`. */
    private static ownRouteThrough(
        device: Device,
        policy: string,
        prefix: string,
        carried: { tagged: boolean },
        running: readonly string[]
    ): PolicyOutcome | undefined {
        if (running.includes(policy)) return "unknown";

        for (const rule of device.routing?.policies?.[policy] ?? []) {
            if ("call" in rule && rule.call) {
                const called = Derive.ownRouteThrough(device, rule.call, prefix, carried, [...running, policy]);
                if (called) return called;
                continue;
            }

            if ("communities" in rule && rule.communities) return "unknown";

            const { if: match, set, then } = rule as RouteRule;
            const matched = Derive.matchesOwn(device, match ?? {}, prefix, carried.tagged);
            if (!matched) continue;

            const added = [set?.standard_communities, set?.add_standard_communities, set?.large_communities, set?.add_large_communities];
            if (added.some((communities) => communities?.length)) carried.tagged = true;
            if (!then) continue;

            return matched === "unknown" ? "unknown" : then;
        }

        return undefined;
    }

    /** Whether a route the device makes itself matches: `unknown` for a condition the config can't answer, such as a registry's prefix set or the RPKI state. A route that carries no community matches no community. */
    private static matchesOwn(device: Device, match: RouteMatch, prefix: string, tagged: boolean): boolean | "unknown" {
        const { len, family } = Address.split(prefix);
        const set = match.prefix_set ? device.routing?.prefix_sets?.[match.prefix_set] : undefined;
        const listed = set && "prefixes" in set ? (Array.isArray(set.prefixes) ? set.prefixes : Object.values(set.prefixes)) : undefined;
        const community = match.standard_community !== undefined || match.large_community !== undefined;

        if (match.family && match.family !== family) return false;
        if (match.prefix && Address.canonical(Address.prefixOf(match.prefix)) !== Address.canonical(Address.prefixOf(prefix))) return false;
        if (listed && !listed.some((outer) => Address.contains(outer, prefix))) return false;
        if (match.prefix_length && (len < (match.prefix_length.min ?? 0) || len > (match.prefix_length.max ?? Address.bits(family))))
            return false;
        if (community && !tagged) return false;

        const unknown =
            (match.prefix_set !== undefined && !listed) ||
            community ||
            [match.as_path_length, match.as_path_contains, match.first_as, match.origin_as, match.rpki].some(
                (condition) => condition !== undefined
            );
        return unknown ? "unknown" : true;
    }

    /** How many subscribers of the prefix `src` share each address of the prefix `pool`, a power of two. 0 when the pool has more addresses than `src`. */
    static subscribersPerAddress(src: Prefix, pool: Prefix): number {
        const shift = Address.split(pool).len - Address.split(src).len;
        return shift < 0 ? 0 : 2 ** shift;
    }

    /**
     * Where each subscriber leaves, RFC 7422's sequential mapping. Each pool address takes the same number of subscribers, in address order. Each one's block of `port_set_size` ports follows the block before it, from port 1024. Nothing when `if.src` is not one prefix that `validate` takes.
     */
    static poolAddresses(rule: DeterministicPoolNatRule): PoolAddress[] {
        const src = [rule.if?.src].flat()[0];
        if (!src || !Address.isCidr(src) || !Address.isCidr(rule.to_pool)) return [];

        const perAddress = Derive.subscribersPerAddress(src, rule.to_pool);
        if (!perAddress) return [];

        const pool = Address.range(rule.to_pool);
        const first = Address.range(src).first;
        const length = Address.bits("ipv4") - Math.log2(perAddress);
        const addresses: PoolAddress[] = [];

        for (let index = 0n; pool.first + index <= pool.last; index++) {
            const start = first + index * BigInt(perAddress);
            const blocks = Array.from({ length: perAddress }, (_, offset) => {
                const min = Derive.POOL_PORTS.min + offset * rule.port_set_size;
                return {
                    subscriber: Address.fromNumber(start + BigInt(offset), "ipv4"),
                    ports: { min, max: min + rule.port_set_size - 1 },
                };
            });
            addresses.push({
                address: Address.fromNumber(pool.first + index, "ipv4"),
                subscribers: `${Address.fromNumber(start, "ipv4")}/${length}`,
                blocks,
            });
        }

        return addresses;
    }

    /** The base AS numbers are written in, for `numberPatterns`. */
    private static readonly BASE = 10;

    /** AS numbers as ranges, a single number as a range of one. */
    static asRanges(numbers: AsNumbers): AsRange[] {
        return [numbers].flat().map((each) => (typeof each === "number" ? { min: each, max: each } : each));
    }

    /**
     * Patterns that together match the numbers from `min` to `max`, with no repetition count, as the NLNOG BGP Filter Guide writes them. 65552 to 131071 is `6555[2-9]`, `655[6-9][0-9]`, and on to `13107[0-1]`.
     */
    static numberPatterns(min: number, max: number): string[] {
        const patterns: string[] = [];

        for (let low = min; low <= max;) {
            // One length of number at a time, so no pattern needs a leading zero.
            const length = String(low).length;
            const high = Math.min(max, Derive.BASE ** length - 1);

            // The most trailing digits that can be any digit, then how far the digit before them goes.
            let any = 0;
            while (any < length - 1 && low % Derive.BASE ** (any + 1) === 0 && low + Derive.BASE ** (any + 1) - 1 <= high) any++;
            const block = Derive.BASE ** any;
            const first = Math.floor(low / block) % Derive.BASE;
            let last = first;
            while (last < Derive.BASE - 1 && low + (last - first + 2) * block - 1 <= high) last++;

            const above = Math.floor(low / (block * Derive.BASE));
            const digit = first === last ? `${first}` : `[${first}-${last}]`;
            patterns.push(`${above || ""}${digit}${"[0-9]".repeat(any)}`);
            low += (last - first + 1) * block;
        }

        return patterns;
    }

    /** Each IS-IS authentication the config writes, for every level or for one, with where it is written. */
    static isisAuthentications(device: Device): { where: string; authentication: IsisAuthentication }[] {
        const isis = device.routing?.isis;
        const found = isis?.authentication ? [{ where: "routing.isis.authentication", authentication: isis.authentication }] : [];
        for (const [level, settings] of Object.entries(isis?.levels ?? {}))
            if (settings?.authentication)
                found.push({ where: `routing.isis.levels.${level}.authentication`, authentication: settings.authentication });

        return found;
    }

    /** What signs IS-IS `level`: the level's own authentication, or else the one for every level. */
    static isisAuthentication(isis: Isis, level: 1 | 2): IsisAuthentication | undefined {
        return isis.levels?.[level]?.authentication ?? isis.authentication;
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

        if (device.routing?.vrf_imports && !has("vrf-imports")) found.push(`routing.vrf_imports, ${notBuilt}`);

        for (const { where, rateLimit } of Derive.rateLimited(device)) {
            if (!has("rate-limit")) found.push(`${where}.rate_limit, ${notBuilt}`);
            else if (rateLimit.per_prefix && !has("rate-limit-per-prefix")) found.push(`${where}.rate_limit.per_prefix, ${notBuilt}`);
        }
        if (device.qos?.marking && !has("marking")) found.push(`qos.marking, ${notBuilt}`);
        if (!has("queues")) {
            for (const field of ["classes", "default_class", "schedulers"] as const)
                if (device.qos?.[field] !== undefined) found.push(`qos.${field}, ${notBuilt}`);
            for (const { where } of Derive.scheduled(device)) found.push(`${where}.scheduler, ${notBuilt}`);
        }
        if (!has("qos-trust")) for (const { where } of Derive.trusting(device)) found.push(`${where}.qos_trust, ${notBuilt}`);
        if (has("marking") && !has("marking-class"))
            (device.qos?.marking ?? []).forEach((rule, index) => {
                if (rule.then.class !== undefined) found.push(`qos.marking[${index}].then.class, not built yet`);
            });

        found.push(...Derive.unbuiltOspf(device, has));
        return found;
    }

    /** OSPF's area ranges and their cost, router priority, point-to-multipoint and NBMA links, virtual links, and traffic engineering, which a platform builds once a device of it has run them. */
    private static unbuiltOspf(device: Device, has: (feature: BuiltFeature) => boolean): string[] {
        const found: string[] = [];
        const untried = "not built yet, since no device of the platform has run it";

        for (const [areaId, area] of Object.entries(device.routing?.ospf?.areas ?? {})) {
            const where = `routing.ospf.areas.${areaId}`;
            if (area.ranges && !has("ospf-ranges")) found.push(`${where}.ranges, ${untried}`);
            (area.ranges ?? []).forEach((range, index) => {
                if (range.cost !== undefined && !has("ospf-range-cost")) found.push(`${where}.ranges[${index}].cost, ${untried}`);
            });
            if (area.virtual_links && !has("ospf-virtual-links")) found.push(`${where}.virtual_links, ${untried}`);
            if (area.traffic_engineering && !has("ospf-traffic-engineering")) found.push(`${where}.traffic_engineering, ${untried}`);

            for (const [name, settings] of Object.entries(area.interfaces)) {
                const at = `${where}.interfaces.${name}`;
                if (settings?.priority !== undefined && !has("ospf-priority")) found.push(`${at}.priority, ${untried}`);
                if (has("ospf-unicast-links")) continue;
                if (settings?.network === "point-to-multipoint" || settings?.network === "non-broadcast")
                    found.push(`${at}.network ${settings.network}, ${untried}`);
                if (settings?.neighbors) found.push(`${at}.neighbors, ${untried}`);
            }
        }

        return found;
    }

    /** Where each DHCP and DHCPv6 server asks RADIUS about its leases, `radius` and `acct_interim_interval`, for a platform that doesn't build it. */
    static radiusLeases(device: Device): string[] {
        const servers = [
            ...Object.entries(device.services?.dhcp_server ?? {}).map(([name, server]) => [`dhcp_server.${name}`, server] as const),
            ...Object.entries(device.services?.dhcpv6_server ?? {}).map(([name, server]) => [`dhcpv6_server.${name}`, server] as const),
        ];
        return servers.flatMap(([where, server]) =>
            (["radius", "acct_interim_interval"] as const)
                .filter((key) => server[key] !== undefined)
                .map((key) => `services.${where}.${key}`)
        );
    }

    /** Each VRF a service of the device itself names, with where: a management service, SNMP, NTP, DNS, a syslog collector, or a RADIUS server. */
    static serviceVrfs(device: Device): { where: string; vrf: string }[] {
        const { management, monitoring, system } = device;
        const named: { where: string; vrf: string | undefined }[] = [
            ...Derive.MANAGEMENT_SERVICES.map((name) => ({ where: `management.${name}.vrf`, vrf: management?.[name]?.vrf })),
            { where: "monitoring.snmp.vrf", vrf: monitoring?.snmp?.vrf },
            { where: "system.ntp.vrf", vrf: system?.ntp?.vrf },
            { where: "system.dns.vrf", vrf: system?.dns?.vrf },
            ...(monitoring?.syslog ?? []).map((collector, index) => ({ where: `monitoring.syslog[${index}].vrf`, vrf: collector.vrf })),
            ...(system?.aaa?.radius ?? []).map((server, index) => ({ where: `system.aaa.radius[${index}].vrf`, vrf: server.vrf })),
        ];
        return named.flatMap(({ where, vrf }) => (vrf ? [{ where, vrf }] : []));
    }

    /** SNMP traps, syslog over TLS, and flow timeouts, on a platform that builds none of them. */
    static unbuiltMonitoring(device: Device): string[] {
        const monitoring = device.monitoring;
        const notBuilt = "which the platform does not build";
        const found: string[] = [];

        if (monitoring?.snmp?.traps) found.push(`monitoring.snmp.traps, ${notBuilt}`);
        (monitoring?.syslog ?? []).forEach((collector, index) => {
            if (collector.transport_security) found.push(`monitoring.syslog[${index}].transport_security, ${notBuilt}`);
        });
        for (const key of ["active_timeout", "idle_timeout"] as const)
            if (monitoring?.flow_export?.[key] !== undefined) found.push(`monitoring.flow_export.${key}, ${notBuilt}`);

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

        // A switch's routed port or interface takes an address with its length alone.
        for (const { where, settings } of Derive.holders(device))
            if (settings.addresses?.some((entry) => typeof entry !== "string")) found.push(`${where}.addresses, an address with a peer`);
        for (const { name, kind, settings } of Derive.interfaces(device)) {
            if (settings.hardware_offload !== undefined) found.push(`interfaces.${kind}.${name}.hardware_offload`);
        }

        return found;
    }
}
