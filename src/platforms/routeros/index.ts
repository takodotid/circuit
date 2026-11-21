import { setTimeout as sleep } from "node:timers/promises";
import type { Client } from "ssh2";
import { Utils } from "../../core/utils";
import { Address } from "../../core/address";
import type { Neighbor } from "../../core/cabling";
import type { Neighbor as BgpNeighbor, Device, Finding } from "../../model";
import { Secrets } from "../../core/secrets";
import { SerialConsole, ConsoleShell } from "../../transport/console";
import type { ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Platform } from "../platform";
import type {
    ApplyOptions,
    BgpLogLine,
    BgpSession,
    HealthCheck,
    HealthOptions,
    OsSupport,
    Plan,
    ReadOptions,
    ReadSession,
    SwitchRules,
} from "../platform";
import { BgpHealth } from "../bgp-health";
import { BgpWait } from "../bgp-wait";
import type { WaitLimits } from "../bgp-wait";
import { RouterOsDhcp } from "./dhcp";
import { RouterOsExport } from "./export";
import { RouterOsPlan } from "./plan";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { RouterOsFirewall } from "./firewall";
import { RouterOsMonitoring } from "./monitoring";
import { RouterOsPppoe } from "./pppoe";
import { RouterOsPseudowire } from "./pseudowire";
import { RouterOsQueues } from "./queues";
import { RouterOsSchedulers } from "./schedulers";
import { RouterOsRender } from "./render";
import { RouterOsRouting } from "./routing";
import { RouterOsSyntax } from "./syntax";
import { RouterOsVlanTags } from "./vlan-tags";

/** An SSH session or the console. Commands run one at a time, and each returns what it printed. */
type Session = {
    run(command: string, timeout?: number): Promise<string>;
    /** Only SSH can write or read a file. */
    upload?(path: string, content: string): Promise<void>;
    download?(path: string): Promise<Buffer>;
    /** A fresh login, which tests that access survived. */
    fresh(): Promise<Session>;
    end(): void;
};

export class RouterOs extends Platform {
    /** `+cwt` after the user turns off colors and terminal detection. Without it, the console redraws every line (TRAPS.md). */
    static readonly CONSOLE: ConsoleDialect = {
        login: /Login: $/,
        password: /Password: $/,
        prompt: /\] > $/,
        logout: "/quit",
        others: [
            [/-- \[Q quit\|D dump\|(?:C-z pause\|)?down\]$/, "D"],
            [/\[Y\/n\]:? ?$/, "n"],
        ],
        user: (user) => `${user}+cwt`,
    };

    private static readonly NO_MAC_LIMIT = "the platform has no MAC learning limit on a bridge port or a switch port on 7.23";

    /** A far PE took no IPv6 route of a VRF into its own (TRAPS.md). */
    private static readonly NO_VPNV6 =
        "RouterOS 7.24 keeps the IPv6 VPN routes it learns unreachable, since it does not resolve their IPv4-mapped next hop (RFC 4659)";

    /** RouterOS 7 has a loopback interface of its own by this name, and refuses another interface by it (TRAPS.md). */
    private static readonly OWN_LOOPBACK = "lo";

    /** Version 6 has another BGP and filter language. */
    private static readonly SUPPORTED_MAJOR = 7;

    /** The export stamps the time it was taken. Without the stamp, an unchanged device reads the same twice. */
    private static readonly EXPORT_TIMESTAMP = /^# \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} by RouterOS/m;

    /** A backup's name holds the time it was taken, to the minute: `pre-apply-202610240312`. */
    private static readonly BACKUP_STAMP_CHARS = 12;

    /** A command that changes the device: the backup, and each command of a plan. */
    private static readonly CHANGE_TIMEOUT_MS = 120_000;

    private static readonly RESTORE_TIMEOUT_MS = 30_000;

    /** A script that lists BGP sessions, advertisements, LLDP neighbors, or the log. */
    private static readonly LIST_TIMEOUT_MS = 60_000;
    /** How long after an apply the router may still list an announcement a filter change stops (TRAPS.md), read before the first check of what is announced. */
    private static readonly ANNOUNCE_SETTLE_MS = 5000;

    private static readonly MINUTE_MS = 60_000;

    /** How much of the device's answer, or of a command, an error quotes. */
    private static readonly QUOTE_CHARS = 200;

    /** How much an error quotes of output it could not read: the certificate list, or the clock. */
    private static readonly QUOTE_UNEXPECTED_CHARS = 120;

    /** How much of a refused command, and of the device's answer, an apply's error quotes. */
    private static readonly QUOTE_REFUSED_COMMAND_CHARS = 160;

    private static readonly QUOTE_REFUSED_ANSWER_CHARS = 300;

    // Each script below is one line, because SSH exec runs a script as one line (TRAPS.md).

    /** Each user's SSH keys, by fingerprint: the device never prints a key, and `/user export` leaves them out. */
    private static readonly LIST_SSH_KEYS = [
        ":foreach k in=[/user ssh-keys find] do={",
        ':put ("add fingerprint=" . [/user ssh-keys get $k fingerprint] . " user=" . [/user ssh-keys get $k user])',
        "}",
    ].join(" ");

    /** A virtual router's ports, `# port ether4`: the machine's adapters, which the plan disables when the render does not state them. */
    private static readonly LIST_PORTS =
        ':foreach p in=[/interface ethernet find] do={ :put ("# port " . [/interface ethernet get $p default-name]) }';

    /** Certificates in the form the render writes them, since an export leaves them out. */
    private static readonly LIST_CERTIFICATES = [
        ":foreach c in=[/certificate find] do={",
        ':local key "no";',
        ':if ([/certificate get $c private-key]) do={ :set key "yes" };',
        ':put ("add fingerprint=" . [/certificate get $c fingerprint] . " name=" . [/certificate get $c name] . " private-key=" . $key)',
        "}",
    ].join(" ");

    /** A line for each BGP session, its fields split by `|`. Then a line for each disabled connection: `disabled|<name>|<address>`. */
    private static readonly LIST_BGP_SESSIONS = [
        ":foreach s in=[/routing bgp session find] do={",
        ":local g [/routing bgp session get $s];",
        ':put (($g->"name") . "|" . ($g->"remote.address") . "|" . ($g->"established") . "|" . ($g->"prefix-count") . "|" . ($g->"uptime") . "|" . ($g->"limit-exceeded") . "|" . ($g->"input.limit-process-routes") . "|" . ($g->"last-stopped"))',
        "};",
        ":foreach c in=[/routing bgp connection find disabled] do={",
        ':put ("disabled|" . [/routing bgp connection get $c name] . "|" . [/routing bgp connection get $c remote.address])',
        "}",
    ].join(" ");

    /**
     * A line for each LLDP neighbor: `<our interfaces>|<far system>|<far port>`. Our interfaces are the port, then its LAG and bridge. `:tostr` keeps them one value, since a list joined to a string repeats the line for each item.
     */
    private static readonly LIST_NEIGHBORS = [
        ':foreach n in=[/ip neighbor find where discovered-by~"lldp"] do={',
        ":local g [/ip neighbor get $n];",
        ':put ([:tostr ($g->"interface")] . "|" . ($g->"identity") . "|" . ($g->"interface-name"))',
        "}",
    ].join(" ");

    /** BGP log lines, without the `connection ...` lines a session that cannot connect repeats. */
    private static readonly BGP_LOG = '/log print where topics~"bgp" and !(message~"^connection ")';

    /** The device's date and time, in the form its log prints: `2026-10-24 03:12:44`. */
    private static readonly CLOCK = ':put ([/system clock get date] . " " . [/system clock get time])';

    private static readonly SWITCH_RULES = "/interface ethernet switch rule";

    /** A rule the switch chip cannot hold is invalid, and so is every rule after it, with no log line (TRAPS.md). */
    private static readonly COUNT_INVALID_SWITCH_RULES = `${RouterOs.SWITCH_RULES} print count-only where invalid`;

    private static readonly ROLLBACK_SCHEDULER = "apply-rollback";

    private static readonly READS =
        /\b(print|monitor|monitor-traffic|ping|traceroute|torch|profile|test-as-path-regexp|export|get|find)\b|\bsniffer quick\b|^:(put|foreach|delay)\b/;

    /** Words that change something, or print secrets. A command with any of them is refused, whatever else it holds. */
    private static readonly WRITES =
        /\b(set|add|remove|reset|reset-counters|enable|disable|unset|move|edit|import|reboot|shutdown|clear|run|upgrade|fetch|save|show-sensitive)\b|\bfile=/;

    /** Flags after the user over SSH: no colors, no terminal detection, 300 columns, so output is plain and lines are not cut. */
    private static readonly PLAIN_OUTPUT = "+ct300w";

    override readonly name = "routeros";

    override readonly os: OsSupport = {
        name: "MikroTik RouterOS",
        versions: "7",
        testedOn: "CCR2216-1G-12XS-2XQ, RouterOS 7.23; RB5009UG+S+, RouterOS 7.24; CHR, RouterOS 7.24",
        checked: true,
    };

    override readonly extension = ".rsc";

    override readonly console = RouterOs.CONSOLE;

    /**
     * A BGP session with a `routing_table` announces only what that table has a route for (TRAPS.md). A session left with nothing to announce is an error. A prefix missing from its table is a warning, since its export may not announce it anyway. A passive multihop session needs `local_address`. A NAT pool larger than the largest proven is a warning.
     */
    override checks(device: Device): Finding[] {
        const bgp = device.routing?.bgp;
        const statics = device.routing?.static_routes ?? [];
        const findings: Finding[] = [...RouterOsRouting.passiveWithoutAddress(device), ...RouterOsFirewall.largePools(device)];

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const table = Utils.otherTable(neighbor.routing_table ?? group?.routing_table);
            if (!table) continue;

            const families = neighbor.address_families ?? group?.address_families ?? [Address.family(neighbor.address)];
            const originated = (bgp?.originated_prefixes ?? []).filter((prefix) => families.includes(Address.family(Address.host(prefix))));
            const inTable = (prefix: string) =>
                statics.some((route) => route.routing_table === table && Address.canonical(route.prefix) === Address.canonical(prefix));
            // A prefix its export rejects needs no route in the table. An export without a prefix rule accepts every prefix.
            const exportPolicy = neighbor.export_policy ?? group?.export_policy;
            const accepted = (exportPolicy ? (device.routing?.policies?.[exportPolicy] ?? []) : [])
                .flatMap((rule) => (RouterOsRouting.onRoutes(rule) && rule.then === "accept" && rule.if?.prefix ? [rule.if.prefix] : []))
                .map((prefix) => Address.canonical(prefix));
            const announced = accepted.length ? originated.filter((prefix) => accepted.includes(Address.canonical(prefix))) : originated;

            const missing = announced.filter((prefix) => !inTable(prefix));
            if (!missing.length) continue;

            const where = `routing.bgp.neighbors.${name}`;
            const route = (prefix: string) => `{ prefix: "${prefix}", blackhole: true, routing_table: "${table}" }`;
            const fix = `On RouterOS a session announces from its own table, ${table}`;

            if (missing.length === announced.length) {
                findings.push({
                    level: "error",
                    device: device.name,
                    message: `${where} would announce nothing: ${fix}, which has no route for any of originated_prefixes. Add the routes it announces to ${table} too, such as ${route(missing[0]!)} in routing.static_routes`,
                });
                continue;
            }

            for (const prefix of missing) {
                findings.push({
                    level: "warning",
                    device: device.name,
                    message: `${where} does not announce ${prefix}: ${fix}, which has no route for it. If its export should announce it, add ${route(prefix)} to routing.static_routes`,
                });
            }
        }

        return findings;
    }

    /** Strict `rp-filter` beside VRFs or routing tables: MikroTik once warned that strict mode does not work with routing tables, and no test has shown it does. A LAG's rate limit: no simple queue on a bonding interface was tried. */
    override experimental(device: Device): string[] {
        const urpf = Derive.sharedUrpf(Derive.holders(device), "ipv4");
        const tables = Object.keys(device.routing?.vrfs ?? {}).length + Object.keys(device.routing?.tables ?? {}).length;
        const strict =
            urpf.mode === "strict" && tables > 0
                ? urpf.setting.map(({ where }) => `${where}.urpf.ipv4 strict, beside VRFs or routing tables`)
                : [];
        const lags = Derive.rateLimited(device).filter(({ kind }) => kind === "lag");
        return [...strict, ...lags.map(({ where }) => `${where}.rate_limit`)];
    }

    override unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const [name] of RouterOsSyntax.entries(device.interfaces?.bridge)) {
            found.push(`interfaces.bridge.${name}, a bridge, which only FortiOS builds for now`);
        }
        for (const { name, kind } of Derive.interfaces(device))
            if (name === RouterOs.OWN_LOOPBACK)
                found.push(
                    `interfaces.${kind}.${name}, the name of RouterOS's own loopback interface: write another name${kind === "loopback" ? ", such as loopback" : ""}`
                );
        // MikroTik's changelog adds it in 7.25, which no device here runs yet.
        if (device.switching?.arp_inspection) found.push("switching.arp_inspection, which RouterOS has only from 7.25, not tested yet");
        found.push(...RouterOsPseudowire.unsupported(device));
        for (const [name] of RouterOsSyntax.entries(device.interfaces?.ipsec))
            found.push(`interfaces.ipsec.${name}, which RouterOS has only from 7.25, where it cut a router off in a test (TRAPS.md)`);
        (device.firewall?.nat?.source ?? []).forEach((rule, index) => {
            if (!("to_pool" in rule)) return;
            if (rule.port_allocation === "dynamic")
                found.push(
                    `firewall.nat.source[${index}].port_allocation dynamic, RouterOS has no port block allocation: write deterministic`
                );
            if (rule.port_sets_per_subscriber !== undefined)
                found.push(`firewall.nat.source[${index}].port_sets_per_subscriber, as a RouterOS pool gives each subscriber one block`);
        });
        found.push(...RouterOsVlanTags.unsupported(device));
        for (const [name, vlan] of RouterOsSyntax.entries(device.switching?.vlans))
            if (vlan.private_vlan?.type === "community")
                found.push(
                    `switching.vlans.${name}.private_vlan, a community: the platform keeps isolated ports apart, but has no communities`
                );

        for (const [name, port] of Derive.ports(device)) {
            if (port.speed && !RouterOsRender.medium(Catalog.spell(device.platform, device.model, name), port.speed)) {
                found.push(`interfaces.ethernet.${name}.speed ${port.speed}, the port has no fixed speed by that name`);
            }

            const thresholds = Object.values(port.storm_control ?? {}).filter((threshold) => threshold !== undefined);
            const percents = new Set(thresholds.map((threshold) => ("percent" in threshold ? threshold.percent : undefined)));

            if (port.mac_limit !== undefined) found.push(`interfaces.ethernet.${name}.mac_limit, ${RouterOs.NO_MAC_LIMIT}`);

            if (thresholds.some((threshold) => "pps" in threshold)) {
                found.push(`interfaces.ethernet.${name}.storm_control in pps, the platform takes percent`);
            } else if (percents.size > 1) {
                found.push(`interfaces.ethernet.${name}.storm_control with a different percent per kind, the platform takes one`);
            }
        }

        for (const [name, port] of Derive.ports(device))
            if (port.hardware_offload !== undefined) found.push(`interfaces.ethernet.${name}.hardware_offload, set on a VLAN interface`);
        for (const { name, kind, settings } of Derive.interfaces(device)) {
            if (settings.hardware_offload === undefined) continue;
            if (kind !== "vlan_interface") found.push(`interfaces.${kind}.${name}.hardware_offload, set on a VLAN interface`);
            else if (settings.hardware_offload && !device.system?.hardware_offload)
                found.push(`interfaces.vlan_interface.${name}.hardware_offload true while system.hardware_offload is off`);
        }

        const holders = Derive.holders(device);
        for (const { where, settings } of holders) {
            if (settings.urpf?.ipv6) found.push(`${where}.urpf.ipv6, RouterOS checks IPv4 sources only`);
            if (Derive.routerAdvertisement(settings)?.dns_search_list)
                found.push(`${where}.ipv6_ra.dns_search_list, RouterOS announces no search domains (DNSSL)`);
        }

        // `/ip settings rp-filter` is one mode for every interface.
        const urpf = Derive.sharedUrpf(holders, "ipv4");
        if (urpf.setting.length && !urpf.mode) {
            const missing = urpf.missing.length ? ` (missing on ${urpf.missing.join(", ")})` : "";
            for (const { where } of urpf.setting)
                found.push(
                    `${where}.urpf.ipv4, RouterOS has one mode for the whole router: write the same on every interface with an IPv4 address${missing}`
                );
        }

        for (const [name, lag] of RouterOsSyntax.entries(device.interfaces?.lag)) {
            if (lag.mac_limit !== undefined) found.push(`interfaces.lag.${name}.mac_limit, ${RouterOs.NO_MAC_LIMIT}`);
            if (lag.ethertypes !== undefined)
                found.push(`interfaces.lag.${name}.ethertypes, on a LAG, which is not tested on a device yet`);

            for (const field of ["storm_control", "stp"] as const) {
                if (lag[field] !== undefined) found.push(`interfaces.lag.${name}.${field}, on a LAG`);
            }
        }

        found.push(...RouterOsRouting.vrfGaps(device));
        found.push(...RouterOsRouting.isisGaps(device), ...RouterOsRouting.ldpGaps(device));

        const bgp = device.routing?.bgp;

        if (bgp?.aggregates) found.push("routing.bgp.aggregates, RouterOS 7 BGP has no aggregate routes");
        if (bgp?.confederation)
            found.push(
                "routing.bgp.confederation, RouterOS 7.24 shows the identifier, not the member AS, to neighbors inside the confederation, which RFC 5065 forbids"
            );

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const settings = { ...group, ...neighbor };
            if (Derive.unicastFamilies(settings, neighbor.address).length > 1)
                found.push(`routing.bgp.neighbors.${name}.address_families, one of ipv4 and ipv6 per session`);
            const vpn = Derive.vpnFamilies(settings);
            if (vpn.includes("vpnv6")) found.push(`routing.bgp.neighbors.${name}.address_families vpnv6, ${RouterOs.NO_VPNV6}`);
            if (vpn.length && settings.max_prefixes !== undefined)
                found.push(`routing.bgp.neighbors.${name}.max_prefixes, with VPN routes: RouterOS limits only ipv4 and ipv6 routes`);

            // MikroTik's reference: `remote.ttl` "only affects EBGP peers".
            const internal = (neighbor.remote_as ?? group?.remote_as) === bgp?.asn;
            if ((neighbor.ttl_security ?? group?.ttl_security) && internal)
                found.push(`routing.bgp.neighbors.${name}.ttl_security on an iBGP session, RouterOS checks the TTL of eBGP sessions only`);

            const limit = Derive.prefixLimit({ ...group, ...neighbor });
            if (limit?.restart_after !== undefined)
                found.push(
                    `routing.bgp.neighbors.${name}.max_prefixes.restart_after, RouterOS keeps the session closed until it is cleared by hand`
                );
            if (limit?.warn_only)
                found.push(`routing.bgp.neighbors.${name}.max_prefixes.warn_only, RouterOS always closes the session at its limit`);
            if (neighbor.graceful_restart ?? group?.graceful_restart)
                found.push(`routing.bgp.neighbors.${name}.graceful_restart, RouterOS 7 has no setting for it`);
        }

        for (const [name, server] of Object.entries(device.services?.dhcpv6_server ?? {})) {
            const [first, last] = (server.pool ?? []).map((address) => Address.toNumber(address));
            if (first === null || last === null || first === undefined || last === undefined || first > last) continue;
            if (RouterOsDhcp.poolPrefix(server.pool!)) continue;

            const [largest] = Address.prefixesBetween(first, last, "ipv6").sort((a, b) => Address.split(a).len - Address.split(b).len);
            const { first: low, last: high } = Address.range(largest!);
            found.push(
                `services.dhcpv6_server.${name}.pool, RouterOS gives addresses from one whole prefix: write the first and last address of one, such as ${Address.fromNumber(low, "ipv6")} and ${Address.fromNumber(high, "ipv6")} (${largest})`
            );
        }

        found.push(...RouterOsPppoe.unsupported(device));
        found.push(...RouterOsDhcp.unsupported(device));

        const management = device.management;

        if (management?.console) found.push("management.console, the console uses the device's users");
        if (device.connection.console && !Catalog.serialConsole(device.platform, device.model))
            found.push(`connection.console, the ${device.model} has no serial console`);
        if (management?.interfaces) found.push("management.interfaces, which only FortiOS builds for now");
        if (management?.privilege_password) found.push("management.privilege_password, the platform has no privileged mode");
        if (management?.ftp?.vrf) found.push("management.ftp.vrf, the platform answers FTP in the main table only");

        if (management?.ssh?.auth_timeout || management?.ssh?.auth_retries) {
            found.push("management.ssh.auth_timeout and auth_retries");
        }

        const aaa = device.system?.aaa;
        if (aaa?.tacacs) found.push("system.aaa.tacacs, the platform logs in with RADIUS only");
        if (aaa?.accounting_events?.includes("command"))
            found.push("system.aaa.accounting_events command, the platform sends a server its logins only");

        found.push(...RouterOsMonitoring.unsupported(device));

        for (const route of device.routing?.static_routes ?? []) {
            if (route.bfd)
                found.push(`routing.static_routes ${route.prefix} bfd, a static route's check-gateway takes arp, none or ping on 7.23`);
        }

        // The plan knows a route by its prefix, table, and gateway, as the render writes them. Two routes alike in all three can't be told apart.
        const routes = new Map<string, number>();
        (device.routing?.static_routes ?? []).forEach((route, index) => {
            // With both, the render writes `fe80::1%ether1`.
            const nextHop = route.next_hop && Address.canonical(Address.host(route.next_hop));
            const gateway = [nextHop, route.interface].filter(Boolean).join("%");
            const key = [Address.canonical(route.prefix), route.vrf ?? route.routing_table ?? "main", gateway].join(" ");
            const first = routes.get(key);
            if (first === undefined) {
                routes.set(key, index);
                return;
            }

            found.push(
                `routing.static_routes[${index}] ${route.prefix}, with the table and gateway of routing.static_routes[${first}]: RouterOS tells routes to one prefix apart by their gateway. Remove one, or give it its own next_hop`
            );
        });

        found.push(...RouterOs.unsupportedShapes(device));
        found.push(...RouterOsQueues.unsupported(device));
        found.push(...RouterOsSchedulers.unsupported(device));
        found.push(...RouterOsFirewall.markingGaps(device));
        found.push(
            ...Derive.unbuilt(device, [
                "eoip",
                "round-robin-lag",
                "link-check",
                "shaping",
                "port-shaping",
                "tcp-mss",
                "dhcp-client",
                "lag-mac",
                "wireguard-table",
                "upnp",
                "nat-state",
                "urpf",
                "vrf-imports",
                "rate-limit",
                "marking",
                "queues",
                "ospf-ranges",
                "ospf-priority",
                "ospf-unicast-links",
            ])
        );

        // BFD on a static route and a MAC limit are refused above, for the reason the device gave, and an ethertype filter on a LAG as untested.
        found.push(
            ...Derive.untested(device, [
                "bfd-timers",
                "multihop-bfd",
                "static-route-bfd",
                "mac-limit",
                "ethertype-filter",
                "routing-tables",
            ])
        );

        return found;
    }

    /** What the model allows and the render does not write. */
    private static unsupportedShapes(device: Device): string[] {
        const found: string[] = [];
        const firewall = device.firewall;
        const list = (value: unknown) => Array.isArray(value) && value.length > 1;

        const taken = Object.keys(firewall?.interface_sets ?? {}).filter((set) => RouterOsRender.TAKEN_LISTS.includes(set));
        for (const set of taken) found.push(`firewall.interface_sets.${set}, an interface list RouterOS has: give the set another name`);

        const chains = (["input", "forward", "output"] as const).map(
            (chain) => [`firewall.filter.${chain}.rules`, firewall?.filter?.[chain]?.rules] as const
        );
        const others = [
            ["firewall.nat.source", firewall?.nat?.source],
            ["firewall.nat.destination", firewall?.nat?.destination],
            ["qos.marking", device.qos?.marking],
        ] as const;

        for (const [where, rules] of [...chains, ...others]) {
            (rules ?? []).forEach((rule, index) => {
                for (const field of ["src", "dst", "in_interface", "out_interface"] as const) {
                    if (list(rule.if?.[field])) found.push(`${where}[${index}].if.${field}, a list: write one rule for each`);
                }
            });
        }

        for (const [name, rules] of RouterOsSyntax.entries(device.switching?.acls)) {
            rules.forEach((rule, index) => {
                for (const field of ["src", "dst", "vlan"] as const) {
                    if (list(rule.if?.[field])) found.push(`switching.acls.${name}[${index}].if.${field}, a list: write one rule for each`);
                }
            });
        }

        const allow = device.management?.allow;
        if (typeof allow === "string") found.push(`management.allow ${allow}, an address set by name: write its prefixes`);

        found.push(...RouterOsRouting.policyGaps(device));

        return found;
    }

    override render(device: Device): string {
        return RouterOsRender.of(device);
    }

    override switchRules(device: Device): SwitchRules {
        const rules = RouterOsFirewall.switchRules(device);
        const ranges = new Set(rules.flatMap(({ srcPort, dstPort }) => [srcPort, dstPort]).filter((port) => port?.includes("-")));
        const filters = RouterOsFirewall.ethertypeFilters(device).reduce((count, { ethertypes }) => count + ethertypes.length + 1, 0);

        return { count: rules.length + filters, ranges: ranges.size };
    }

    /** The export, then what it leaves out: the users, their SSH keys, and the certificates. */
    override async read(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<string> {
        const session = await RouterOs.open(device, options);

        try {
            await RouterOs.checkVersion(session, device);

            const config = await RouterOsExport.read(session, device);
            const users = await session.run("/user export");
            const certificates = (await session.run(RouterOs.LIST_CERTIFICATES)).trim();
            const keys = (await session.run(RouterOs.LIST_SSH_KEYS)).trim();

            const listed = certificates.split("\n").every((line) => line.trim().startsWith("add fingerprint="));
            if (certificates && !listed) {
                throw new Error(
                    `${device.name}: certificates could not be listed: ${certificates.slice(0, RouterOs.QUOTE_UNEXPECTED_CHARS)}`
                );
            }

            // The user dump repeats the export's header; only its menu is kept.
            const userMenu = users.slice(users.indexOf("\n/")).trim();
            const certificateMenu = certificates ? `/certificate\n${certificates}` : "";
            const keyLines = keys.split("\n").filter((line) => line.trim().startsWith("add fingerprint="));
            const keyMenu = keyLines.length ? `/user ssh-keys\n${keyLines.join("\n")}` : "";
            const ports = Catalog.virtual(device.platform, device.model) ? await RouterOs.ports(session) : "";
            const text = [config.trim(), userMenu, keyMenu, certificateMenu, ports].filter(Boolean).join("\n");
            return `${RouterOs.withoutTimestamp(text)}\n`;
        } finally {
            session.end();
        }
    }

    override plan(desired: string, current: string, options: ApplyOptions): Plan {
        return RouterOsPlan.of(desired, current, options);
    }

    /**
     * RouterOS applies each command as it arrives, with no candidate configuration, so an apply is guarded three ways. Each command is first compiled on the device without running. A backup is saved, with a scheduler armed to restore it, which only a fresh login removes. A refused command restores the backup at once.
     */
    override async apply(device: Device, _network: readonly Device[], changes: Plan, options: ApplyOptions): Promise<void> {
        const session = await RouterOs.open(device, options);
        await RouterOs.checkVersion(session, device);

        const commands = changes.steps.flatMap((step) => step.send.map((command) => ({ title: step.title, command })));

        for (const { title, command } of commands) {
            if (command.startsWith(RouterOsPlan.INSTALL_CERTIFICATE)) continue;

            const reason = await RouterOs.refusal(session, Secrets.substitute(command));
            if (reason) {
                session.end();
                throw new Error(`${title}: the device will not parse ${command.slice(0, RouterOs.QUOTE_CHARS)}\n    ${reason}`);
            }
        }

        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, RouterOs.BACKUP_STAMP_CHARS);
        const backup = `pre-apply-${stamp}`;

        // `interval` counts from now; `start-time=startup` would count from boot.
        const armRollback = [
            `/system scheduler add name="${RouterOs.ROLLBACK_SCHEDULER}"`,
            `interval=${options.rollback}m`,
            `on-event="/system backup load name=${backup} password=\\"\\""`,
            "policy=read,write,policy,test,reboot,ftp",
        ].join(" ");

        try {
            console.log(`  saving ${backup}, arming a ${options.rollback} minute rollback`);

            await session.run(`/system backup save name=${backup} dont-encrypt=yes`, RouterOs.CHANGE_TIMEOUT_MS);
            await session.run(`/system scheduler remove [find name="${RouterOs.ROLLBACK_SCHEDULER}"]`);
            await session.run(armRollback);

            for (const { title, command } of commands) {
                if (command.startsWith(RouterOsPlan.INSTALL_CERTIFICATE)) {
                    const certificateName = command.slice(RouterOsPlan.INSTALL_CERTIFICATE.length).trim();
                    await RouterOs.installCertificate(session, device, certificateName);
                    continue;
                }

                const answer = (await session.run(Secrets.substitute(command), RouterOs.CHANGE_TIMEOUT_MS)).trim();
                if (answer) {
                    const quoted = command.slice(0, RouterOs.QUOTE_REFUSED_COMMAND_CHARS);
                    throw new Error(`${title}: ${quoted}\n    device said: ${answer.slice(0, RouterOs.QUOTE_REFUSED_ANSWER_CHARS)}`);
                }
            }
        } catch (error) {
            console.log(`  FAILED: ${(error as Error).message}`);
            console.log(`  restoring ${backup} now; the rollback stays armed in case this does not get through`);

            await session.run(`/system backup load name=${backup} password=""`, RouterOs.RESTORE_TIMEOUT_MS).catch(() => undefined);
            session.end();

            throw new Error("apply failed and the backup is being restored", { cause: error });
        }

        // Only a fresh login removes the rollback. It also removes the backup, which holds every credential, and any backup a failed apply left.
        const proof = await session.fresh().catch(() => undefined);
        if (!proof) throw new Error(`could not log in again; the device restores ${backup} within ${options.rollback} minutes`);

        await proof.run(`/system scheduler remove [find name="${RouterOs.ROLLBACK_SCHEDULER}"]`);
        await proof.run(`/file remove [find name~"^pre-apply-[0-9]+.backup"]`);
        proof.end();
        console.log("  logged in again, rollback disarmed");
    }

    override readOnly(command: string): boolean {
        return RouterOs.READS.test(command) && !RouterOs.WRITES.test(command);
    }

    /** Over SSH, each command runs on its own. */
    override async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        const session = options.console
            ? await RouterOs.consoleSession(device, ConsoleShell.SETTLE)
            : RouterOs.sshSession(await RouterOs.login(device, RouterOs.PLAIN_OUTPUT), device);

        return { run: (command, timeout) => session.run(command, timeout), close: () => session.end() };
    }

    /**
     * A session is named `<connection>-<n>`, and a renamed connection keeps its session's old name until the session restarts (TRAPS.md). So a neighbor is matched by its address first, then by name. A session that is down says why: closed on its limit, or still connecting. A neighbor with no session and a disabled connection is admin down.
     */
    override async bgpSessions(device: Device, session: ReadSession): Promise<BgpSession[]> {
        const output = await session.run(RouterOs.LIST_BGP_SESSIONS, RouterOs.LIST_TIMEOUT_MS);
        const lines = output
            .split(/\r?\n/)
            .filter((line) => line.includes("|"))
            .map((line) => line.trim().split("|"));
        const live = lines.filter(([first]) => first !== "disabled");
        // A connection's address carries its length, `10.0.0.1/32`.
        const disabled = lines
            .filter(([first]) => first === "disabled")
            .map(([, name, address]) => ({ name, address: address?.split("/")[0] }));

        return Object.entries(device.routing?.bgp?.neighbors ?? {}).map(([name, neighbor]): BgpSession => {
            const found =
                live.find(([, remote]) => remote === RouterOs.sessionAddress(device, neighbor)) ??
                live.find(([sessionName]) => sessionName === name || sessionName?.replace(/-\d+$/, "") === name);

            if (!found) {
                const off = disabled.some((connection) => connection.address === neighbor.address || connection.name === name);
                return {
                    neighbor: name,
                    remote: "-",
                    established: false,
                    prefixes: "-",
                    uptime: "no session",
                    ...(off ? { reason: "admin down" } : {}),
                };
            }

            const [, remote, established, prefixes, uptime, limitExceeded, max, stopped] = found;
            const up = established === "true";
            const limited = limitExceeded === "true";

            return {
                neighbor: name,
                remote: remote || "-",
                established: up,
                prefixes: prefixes || "-",
                uptime: uptime || "-",
                ...(up ? {} : { reason: limited ? "limit exceeded" : "connecting" }),
                ...(limited
                    ? {
                          limit: {
                              ...(max && /^\d+$/.test(max) ? { max: Number(max) } : {}),
                              ...(stopped ? { stopped, stoppedAt: RouterOs.logTime(stopped) } : {}),
                          },
                      }
                    : {}),
            };
        });
    }

    /** A session's remote address as the device prints it: in a VRF, `192.0.2.1@<vrf>`. */
    private static sessionAddress(device: Device, neighbor: BgpNeighbor): string {
        const group = neighbor.neighbor_group ? device.routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
        const vrf = neighbor.vrf ?? group?.vrf;
        return vrf ? `${neighbor.address}@${vrf}` : neighbor.address;
    }

    override async bgpClearLimit(session: ReadSession, sessions: readonly BgpSession[]): Promise<void> {
        for (const bgp of sessions) {
            const answer = (await session.run(RouterOs.clearLimit(bgp.remote))).trim();
            if (answer) throw new Error(`could not clear ${bgp.neighbor}: ${answer.slice(0, RouterOs.QUOTE_CHARS)}`);
        }
    }

    /** Opens the session from one address again, only while it is closed on its limit. */
    private static clearLimit(address: string): string {
        return `/routing bgp session clear [find remote.address=${address} and limit-exceeded] flag=limit-exceeded`;
    }

    /** `time>` in `/log print` does not filter (TRAPS.md), so each line's time is compared with the device's clock here. */
    override async bgpLog(session: ReadSession, minutes: number): Promise<BgpLogLine[]> {
        const now = (await session.run(RouterOs.CLOCK)).trim();
        const nowTime = RouterOs.logTime(now);
        if (Number.isNaN(nowTime)) throw new Error(`could not read the device's clock: ${now.slice(0, RouterOs.QUOTE_UNEXPECTED_CHARS)}`);

        const since = nowTime - minutes * RouterOs.MINUTE_MS;
        const log = await session.run(RouterOs.BGP_LOG, RouterOs.LIST_TIMEOUT_MS);

        return log
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .flatMap((line) => {
                const [date, time, ...rest] = line.split(" ");
                const at = `${date} ${time}`;
                return RouterOs.logTime(at) >= since ? [{ at, message: rest.join(" ") }] : [];
            });
    }

    /**
     * Three checks after an apply. When the plan touched switch rules, none may be invalid. Each BGP session established before must be established again. It must announce again what it announced before, unless the config stops it (`Derive.announcements`): a session can stay up and stop announcing (TRAPS.md).
     */
    override async health(device: Device, plan: Plan, options: HealthOptions = {}): Promise<HealthCheck> {
        const switchRules = plan.steps.some((step) => step.send.some((command) => command.startsWith(RouterOs.SWITCH_RULES)));
        const limits = options.bgp ?? BgpWait.AFTER_APPLY;

        const establishedBefore = await BgpHealth.established(this, device, options);
        const announcedBefore = establishedBefore.length ? await this.announcedNow(device, options) : [];

        return {
            run: async () => {
                if (!switchRules && !establishedBefore.length) {
                    console.log("  nothing to check: the plan changed no switch rule, and no BGP session was established before");
                    return [];
                }

                const session = await this.session(device, options);

                try {
                    const switchProblems = switchRules ? await RouterOs.invalidSwitchRules(session, device) : [];
                    const bgpProblems = await BgpHealth.back(this, device, session, establishedBefore, limits);
                    const announceProblems = await RouterOs.announcedBack(device, session, announcedBefore, limits);
                    return [...switchProblems, ...bgpProblems, ...announceProblems];
                } finally {
                    session.close();
                }
            },
        };
    }

    /** The LLDP neighbors the device sees, by Circuit's port names. */
    override async neighbors(device: Device, network: readonly Device[], options: ReadOptions = {}): Promise<Neighbor[]> {
        const session = await this.session(device, options);

        try {
            const output = await session.run(RouterOs.LIST_NEIGHBORS, RouterOs.LIST_TIMEOUT_MS);

            return output
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.includes("|"))
                .map((line) => RouterOs.neighbor(device, network, line));
        } finally {
            session.close();
        }
    }

    /** One line of `LIST_NEIGHBORS` as a neighbor. Our port is the first interface, by Circuit's name when it is a port. */
    private static neighbor(device: Device, network: readonly Device[], line: string): Neighbor {
        const [interfaces = "", system = "", ...rest] = line.split("|");
        const reported = rest.join("|");
        const own = interfaces.split(";")[0] ?? "";
        const port = Catalog.devicePorts(device).find((name) => Catalog.spell(device.platform, device.model, name) === own);

        return { port: port ?? own, system, remote_port: RouterOs.farPort(network, system, reported) };
    }

    /** RouterOS reports the far port's description, where it has one, not its name (TRAPS.md). When exactly one port of the far device has that description, it is the far port. */
    private static farPort(network: readonly Device[], system: string, reported: string): string {
        const far = network.find((candidate) => system === candidate.name || system.startsWith(`${candidate.name}.`));
        const described = (far ? Derive.ports(far) : []).filter(([, port]) => port.description === reported).map(([name]) => name);

        return described.length === 1 ? described[0]! : reported;
    }

    /** `announced`, over a session of its own. None, without logging in, when the config has no session announce a route the device makes. */
    private async announcedNow(device: Device, options: ReadOptions): Promise<string[]> {
        if (!Derive.announcements(device).length) return [];

        const session = await this.session(device, options);

        try {
            return await RouterOs.announced(device, session);
        } finally {
            session.close();
        }
    }

    /** What each session announces of what the config has it announce, as `neighbor prefix`, sorted. An advertisement names its session, which is matched to its neighbor by address first, as in `bgpSessions`. */
    private static async announced(device: Device, session: ReadSession): Promise<string[]> {
        const bgp = device.routing?.bgp;
        const announcements = Derive.announcements(device);
        if (!announcements.length) return [];
        const wanted = announcements.map(({ neighbor, prefix }) => `${neighbor} ${prefix}`);

        const sessions = (await session.run(RouterOs.LIST_BGP_SESSIONS, RouterOs.LIST_TIMEOUT_MS))
            .split(/\r?\n/)
            .map((line) => line.trim().split("|"))
            .filter((fields) => fields.length > 1 && fields[0] !== "disabled");
        const neighbors = Object.entries(bgp?.neighbors ?? {});
        const neighborOf = (sessionName: string) => {
            const remote = sessions.find(([name]) => name === sessionName)?.[1];
            const byAddress = neighbors.find(([, neighbor]) => RouterOs.sessionAddress(device, neighbor) === remote);
            const byName = neighbors.find(([name]) => name === sessionName.replace(/-\d+$/, ""));
            return (byAddress ?? byName)?.[0];
        };

        const prefixes = [...new Set(announcements.map(({ prefix }) => prefix))];
        const output = await session.run(RouterOs.listAdvertisements(prefixes), RouterOs.LIST_TIMEOUT_MS);
        return output
            .split(/\r?\n/)
            .map((line) => line.trim().split("|"))
            .flatMap(([marker, peer, prefix]) => {
                const neighbor = marker === "ADV" && peer ? neighborOf(peer) : undefined;
                const pair = neighbor && prefix ? `${neighbor} ${Address.canonical(prefix)}` : undefined;
                return pair && wanted.includes(pair) ? [pair] : [];
            })
            .sort();
    }

    /** A line for each advertisement of these prefixes: `ADV|<session>|<prefix>`. */
    private static listAdvertisements(prefixes: readonly string[]): string {
        const where = prefixes.map((prefix) => `dst=${prefix}`).join(" or ");
        return `:foreach a in=[/routing bgp advertisements print as-value where ${where}] do={ :put ("ADV|" . ($a->"peer") . "|" . ($a->"dst")) }`;
    }

    /** Wait until each session announces again what it announced before. When time runs out, each prefix a session no longer announces is a problem. `before` holds only what the config still has it announce. */
    private static async announcedBack(
        device: Device,
        session: ReadSession,
        before: readonly string[],
        limits: WaitLimits
    ): Promise<string[]> {
        if (!before.length) return [];

        // A read at once could still see what a broken filter has stopped. A short limit, as in a test, waits less.
        await sleep(Math.min(RouterOs.ANNOUNCE_SETTLE_MS, limits.every * BgpWait.SECOND_MS));
        const missing = (now: string[]) => before.filter((pair) => !now.includes(pair));
        const after = await BgpWait.until(
            () => RouterOs.announced(device, session),
            (now) => !missing(now).length,
            limits,
            (now) => console.log(`  BGP: ${missing(now).length} announcement(s) not back yet, checking again in ${limits.every} s`)
        );

        const gone = missing(after);
        if (!gone.length) {
            console.log("  BGP: no session lost an announcement the config still makes");
            return [];
        }

        return gone.map((pair) => {
            const [neighbor, prefix] = pair.split(" ");
            return `BGP session ${neighbor} announced ${prefix} before the apply and does not ${limits.seconds} s after it, though the config says it should. A RouterOS session announces from its routing table: that table needs a route for ${prefix}, and a session whose table changed must restart. Look with: circuit exec ${device.name} '/routing bgp advertisements print'`;
        });
    }

    /** A problem when any switch rule is invalid, saying what to do. */
    private static async invalidSwitchRules(session: ReadSession, device: Device): Promise<string[]> {
        const answer = (await session.run(RouterOs.COUNT_INVALID_SWITCH_RULES)).trim();
        if (!/^\d+$/.test(answer)) return [`could not count invalid switch rules: ${answer.slice(0, RouterOs.QUOTE_CHARS)}`];

        const invalid = Number(answer);
        if (!invalid) {
            console.log("  switch rules: none invalid");
            return [];
        }

        return [
            `${invalid} switch rule(s) are invalid: the switch chip cannot hold them, and every rule after the first invalid one is invalid too, so those rules do nothing. Use fewer distinct port ranges in this device's ACLs, then apply again. See them with: circuit exec ${device.name} '${RouterOs.SWITCH_RULES} print where invalid'`,
        ];
    }

    /** Log in over SSH. `flags` go after the user, as RouterOS reads them: `+ct300w`. */
    private static async login(device: Device, flags = ""): Promise<Client> {
        const { port, user, password, keys } = Secrets.loginOf(device);

        return Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user: `${user}${flags}`,
            password,
            keys,
        });
    }

    private static sshSession(client: Client, device: Device): Session {
        return {
            run: (command, timeout) => Ssh.exec(client, command, timeout),
            upload: (path, content) => Ssh.upload(client, path, content),
            download: (path) => Ssh.download(client, path),
            fresh: async () => {
                client.end();
                return RouterOs.sshSession(await Ssh.retrying(() => RouterOs.login(device)), device);
            },
            end: () => client.end(),
        };
    }

    /** Log in on the console. `settle` is the quiet after the prompt a command waits for, as `ConsoleShell` takes it. */
    private static async consoleSession(device: Device, settle = 0): Promise<Session> {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);

        try {
            await SerialConsole.login(opened.channel, RouterOs.CONSOLE, user, password, console.password_only);
        } catch (error) {
            void opened.close();
            throw error;
        }

        const shell = new ConsoleShell(opened.channel, RouterOs.CONSOLE, settle);

        const session: Session = {
            run: (command, timeout) => shell.run(command, timeout),
            fresh: async () => {
                await SerialConsole.login(opened.channel, RouterOs.CONSOLE, user, password, console.password_only);
                return session;
            },
            end: () => {
                shell.logout();
                void opened.close();
            },
        };

        return session;
    }

    private static async open(device: Device, options: ReadOptions = {}): Promise<Session> {
        return options.console ? RouterOs.consoleSession(device) : RouterOs.sshSession(await RouterOs.login(device), device);
    }

    /** The `# port` lines of `LIST_PORTS`, one for each of the device's ports. */
    private static async ports(session: Session): Promise<string> {
        const listed = await session.run(RouterOs.LIST_PORTS, RouterOs.LIST_TIMEOUT_MS);
        return listed
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("# port "))
            .join("\n");
    }

    private static async checkVersion(session: Session, device: Device): Promise<void> {
        const version = (await session.run(":put [/system resource get version]")).trim();
        const major = Number(version.split(".")[0]);

        if (major !== RouterOs.SUPPORTED_MAJOR) {
            throw new Error(`${device.name} runs RouterOS ${version}; this adapter renders for version ${RouterOs.SUPPORTED_MAJOR}`);
        }
    }

    /** A time as the clock and the log print it, `2026-10-24 03:12:44`, in milliseconds. Both are read the same way, so the computer's time zone does not matter. Not a number when the text is not such a time. */
    private static logTime(stamp: string): number {
        return Date.parse(stamp.replace(" ", "T"));
    }

    private static withoutTimestamp(text: string): string {
        return text.replace(/\r/g, "").replace(RouterOs.EXPORT_TIMESTAMP, "# by RouterOS");
    }

    /** Escape a command so it can sit inside a quoted string on the device. */
    private static escapeForString(text: string): string {
        return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
    }

    /** Why the device refuses a command, which it compiles without running, or undefined. */
    private static async refusal(session: Session, command: string): Promise<string | undefined> {
        const compiled = (await session.run(`:put [:parse "${RouterOs.escapeForString(command)}"]`)).trim();
        const refused = !compiled.startsWith("(") || /syntax error|bad parameter|no such|expected/.test(compiled);
        return refused ? compiled.slice(0, RouterOs.QUOTE_CHARS) : undefined;
    }

    /** Upload a certificate and its key, and import both under one name. */
    private static async installCertificate(session: Session, device: Device, name: string): Promise<void> {
        const certificate = device.system?.certificates?.[name];
        if (!certificate) throw new Error(`certificate ${name} is not declared in system.certificates`);
        if (!session.upload)
            throw new Error(`certificate ${name} is installed from a file, which only SSH can write; apply it without --console`);

        await session.upload(`${name}.crt`, Utils.projectFile(certificate.certificate_file));
        await session.run(`/certificate import file-name=${name}.crt name=${name} passphrase=""`);

        if (certificate.private_key) {
            // A key from a file is PEM as it is; one from a variable is PEM encoded as one line of base64.
            const value = Secrets.reveal(certificate.private_key);
            const privateKey = value.includes("-----BEGIN") ? `${value}\n` : Buffer.from(value, "base64").toString("utf8");

            await session.upload(`${name}.key`, privateKey);
            await session.run(`/certificate import file-name=${name}.key name=${name} passphrase=""`);
        }

        await session.run(`/file remove [find name="${name}.crt" or name="${name}.key"]`);
    }
}
