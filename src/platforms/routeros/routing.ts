import { presets } from "../../config/presets";
import { Utils } from "../../core/utils";
import { Address } from "../../core/address";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type {
    AsNumbers,
    BgpFamily,
    Device,
    Family,
    Finding,
    Neighbor,
    NeighborSettings,
    OspfAuthentication,
    OspfInterface,
    PolicyRule,
    RouteRule,
} from "../../model";
import { RouterOsEvpn } from "./evpn";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** Routing tables and rules, static routes, RPKI, BGP with its policies' filter chains, OSPF, and BFD, added to one device's render. */
export class RouterOsRouting {
    /** `bgp-path-prepend` takes 16 at most, and counts the AS a session always sends (TRAPS.md). */
    private static readonly MOST_PREPENDS = 15;

    /** The validator group every RPKI server joins. */
    private static readonly RPKI_GROUP = "rpki";

    /** The chain a session without a policy uses, so that it learns or announces nothing. */
    private static readonly REJECT_ALL = "REJECT-ALL";

    /** Names the output chain of a session with `send_default_route`, which accepts the default route and hands every other route to its export's chain. */
    private static readonly WITH_DEFAULT = "DEFAULT";

    /** Names the chain of a policy for the routes a table hands to the BGP VPN table, from `routing.vrf_imports` or a VRF's `export_policy`. It hands each route to the policy's chain for its family. */
    private static readonly IMPORTED = "VRF";

    /** Names the chain of a VRF's `import_policy`, for the VPN routes it takes. It hands each to the policy's chain for its family, which matches the route's prefix without its route distinguisher (TRAPS.md). */
    private static readonly FROM_VPN = "FROM-VPN";

    /** What a table hands to the BGP VPN table for another to take: every route but those of the VPN table itself. */
    private static readonly EXPORTED = "connected,static,ospf,bgp";

    /** The prefix every IPv4 prefix is inside, so a label filter for it matches every label. */
    private static readonly EVERY_IPV4 = presets.default_routes.ipv4;

    /** The chain of a session that carries VPN routes only. It takes them, which their route targets pick, and rejects the rest (TRAPS.md). */
    private static readonly VPN = "VPN";

    /** A connection's `afi` for each family, in the order the device prints them. */
    private static readonly AFI = {
        ipv4: "ip",
        ipv6: "ipv6",
        vpnv4: "vpnv4",
        vpnv6: "vpnv6",
        "l2vpn-evpn": "evpn",
    } as const satisfies Record<BgpFamily, string>;

    /** The TTL a session with GTSM sends with and requires on arrival, the highest there is (RFC 5082). */
    private static readonly GTSM_TTL = 255;

    /** RouterOS takes our own role, and the config states the neighbor's, so each becomes its opposite. A neighbor that is our provider makes us its customer. */
    private static readonly ROLES = {
        provider: "ebgp-customer",
        customer: "ebgp-provider",
        peer: "ebgp-peer",
        rs: "ebgp-rs-client",
        "rs-client": "ebgp-rs",
    } as const;

    /** An interface template's `auth` for each algorithm. */
    private static readonly OSPF_AUTH = {
        md5: "md5",
        "hmac-sha-1": "sha1",
        "hmac-sha-256": "sha256",
        "hmac-sha-384": "sha384",
        "hmac-sha-512": "sha512",
    } as const satisfies Record<OspfAuthentication["algorithm"], string>;

    /** An interface template's `type` for each network type. A broadcast link is the template's own type on Ethernet, so it writes none. */
    private static readonly OSPF_NETWORK = {
        broadcast: undefined,
        "point-to-point": "ptp",
        "point-to-multipoint": "ptmp",
        "non-broadcast": "nbma",
    } as const satisfies Record<NonNullable<OspfInterface["network"]>, string | undefined>;

    /** The one IS-IS instance. */
    private static readonly ISIS_INSTANCE = "isis";

    /** An interface template's `levels` for each level capability. */
    private static readonly ISIS_LEVELS = { "level-1": ["l1"], "level-2": ["l2"], "level-1-2": ["l1", "l2"] } as const;

    private constructor(
        private readonly render: RouterOsRender,
        private readonly device: Device
    ) {}

    static render(render: RouterOsRender, device: Device): void {
        const routing = new RouterOsRouting(render, device);

        routing.tables();
        routing.rules();
        routing.staticRoutes();
        routing.rpki();
        if (device.routing?.bgp) {
            routing.bgpInstance();
            routing.policies();
            routing.bgpConnections();
            routing.vrfImports();
            routing.vpns();
            RouterOsEvpn.instances(render, device);
        }

        routing.ospf();
        routing.isis();
        routing.mpls();
        routing.bfd();
    }

    /** A policy rule's `communities`, which `Project.read` writes out before a platform sees it, and a prepend above what `bgp-path-prepend` takes. */
    static policyGaps(device: Device): string[] {
        const found: string[] = [];
        for (const [name, rules] of Object.entries(device.routing?.policies ?? {})) {
            (rules ?? []).forEach((rule, index) => {
                if (rule.communities !== undefined) found.push(`routing.policies.${name}[${index}].communities ${rule.communities}`);
                const prepend = "set" in rule ? rule.set?.prepend : undefined;
                if (prepend !== undefined && prepend > RouterOsRouting.MOST_PREPENDS)
                    found.push(
                        `routing.policies.${name}[${index}].set.prepend ${prepend}, RouterOS sends its AS at most 16 times, the one it always sends included: write ${RouterOsRouting.MOST_PREPENDS} at most`
                    );
            });
        }
        return found;
    }

    /** What `validate` reports about the device's routing that it may not report on other platforms. */
    static findings(device: Device): Finding[] {
        return [...RouterOsRouting.passiveWithoutAddress(device), ...RouterOsRouting.isisLeaks(device)];
    }

    /** A passive multihop neighbor without `local_address`: the router listens for it only on one address it picks itself, which may not be the one the neighbor connects to (TRAPS.md). */
    private static passiveWithoutAddress(device: Device): Finding[] {
        const bgp = device.routing?.bgp;

        return Object.entries(bgp?.neighbors ?? {}).flatMap(([name, neighbor]): Finding[] => {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const settings = { ...group, ...neighbor };
            if (!settings.passive || !settings.multihop || settings.local_address) return [];

            return [
                {
                    level: "error",
                    device: device.name,
                    message: `routing.bgp.neighbors.${name} is passive and multihop without local_address: RouterOS then listens only on one address it picks, and refuses ${neighbor.address} if it connects to another. Write local_address, the address ${neighbor.address} connects to`,
                },
            ];
        });
    }

    /** A VRF with the name of an interface, which the router refuses, since a VRF is an interface too (TRAPS.md). Imports without the BGP they go through, or with the main table, which that way takes and gives nothing. */
    static vrfGaps(device: Device): string[] {
        const found: string[] = [];
        const vrfs = Object.keys(device.routing?.vrfs ?? {});
        // Port names are spelled only when a VRF could clash with one.
        const interfaceNames = new Set(
            vrfs.length
                ? [
                      ...Derive.interfaces(device).map(({ name }) => name),
                      ...Derive.ports(device).map(([name]) => Catalog.spell(device.platform, device.model, name)),
                  ]
                : []
        );
        for (const name of vrfs)
            if (interfaceNames.has(name))
                found.push(`routing.vrfs.${name}, the name of an interface: RouterOS makes an interface named after each VRF`);
        // `/ip vrf` refuses `interfaces=""`: "interfaces must be specified" (CHR, 7.24.6).
        const members = new Set(
            [...Derive.ports(device), ...Derive.interfaces(device).map(({ name, settings }) => [name, settings] as const)].map(
                ([, settings]) => settings.vrf
            )
        );
        for (const name of vrfs.filter((vrf) => !members.has(vrf)))
            found.push(
                `routing.vrfs.${name}, a VRF with no interface: RouterOS needs one in each. Give it its interfaces with vrf, or leave the VRF out`
            );

        if (device.routing?.vrf_imports && !device.routing.bgp)
            found.push(
                "routing.vrf_imports without routing.bgp: RouterOS takes routes between tables through BGP. Write bgp: {} in routing"
            );
        // The imports' route targets are the router's AS and a number, which a VPN session would carry to the other PEs.
        if (device.routing?.vrf_imports && Derive.l3vpn(device).length)
            found.push(
                "routing.vrf_imports beside an L3VPN: RouterOS takes routes between VRFs by route targets of its own, which its VPN sessions would carry to the other PEs. Not built yet"
            );
        (device.routing?.vrf_imports ?? []).forEach(({ from, to }, index) => {
            if (from === "main" || to === "main")
                found.push(
                    `routing.vrf_imports[${index}], with main: BGP's VPN table takes routes between VRFs only on RouterOS 7.24, and routes neither left main nor arrived there`
                );
        });
        return found;
    }

    /** A router on both IS-IS levels leaks every level 2 route into level 1, holds none back, and sends no default route into level 1 (TRAPS.md). With `level2_to_level1`, `isisGaps` refuses it instead. */
    private static isisLeaks(device: Device): Finding[] {
        const isis = device.routing?.isis;
        if (isis?.level_capability !== "level-1-2" || isis.level2_to_level1) return [];

        return [
            {
                level: "warning",
                device: device.name,
                message:
                    "routing.isis.level_capability is level-1-2: on RouterOS 7.24, a router on both levels leaks every level 2 route into level 1, and nothing holds one back. The level 1 routers of its area learn every route of level 2, and no default route from it",
            },
        ];
    }

    /** What RouterOS 7.24's IS-IS has no setting for (TRAPS.md), and a metric on a passive interface, which it refuses. */
    static isisGaps(device: Device): string[] {
        const isis = device.routing?.isis;
        if (!isis) return [];

        const found: string[] = [];
        const noAuthentication = "RouterOS 7.24 has no IS-IS authentication";
        if (isis.authentication) found.push(`routing.isis.authentication, ${noAuthentication}`);
        for (const [level, settings] of Object.entries(isis.levels ?? {}))
            if (settings?.authentication) found.push(`routing.isis.levels.${level}.authentication, ${noAuthentication}`);
        if (isis.overload_bit) found.push("routing.isis.overload_bit, RouterOS 7.24 has no IS-IS overload bit");
        if (isis.multi_topology) found.push("routing.isis.multi_topology, RouterOS 7.24 routes IPv6 in IPv4's topology only");
        if (isis.level2_to_level1)
            found.push(
                "routing.isis.level2_to_level1, RouterOS 7.24 leaks every level 2 route into level 1, and l1.out-filter-chain holds none back (TRAPS.md)"
            );

        for (const [name, settings] of Object.entries(isis.interfaces)) {
            const where = `routing.isis.interfaces.${name}`;
            if (settings?.bfd) found.push(`${where}.bfd, RouterOS 7.24 has no BFD for IS-IS`);
            if (settings?.passive && settings.metric !== undefined)
                found.push(`${where}.metric with passive, RouterOS refuses a metric on a passive interface`);
        }
        return found;
    }

    /** Virtual links for both OSPF versions: RouterOS 7.24 takes the two to one router as duplicates, and runs neither (TRAPS.md). */
    static ospfGaps(device: Device): string[] {
        const ospf = device.routing?.ospf;
        const families = ospf?.address_families ?? ["ipv4"];
        if (!ospf?.areas["0.0.0.0"]?.virtual_links?.length || families.length < 2) return [];
        return [
            "routing.ospf.areas.0.0.0.0.virtual_links with OSPF for IPv4 and IPv6, RouterOS 7.24 runs neither the OSPFv2 nor the OSPFv3 virtual link when it has both. Run OSPF for one family on this router",
        ];
    }

    /** What a label filter can't match: a prefix but not those inside it, a length, or a prefix and a prefix set at once. A set from a registry, whose prefixes `validate` never fetches, would be a filter for each. */
    static ldpGaps(device: Device): string[] {
        const ldp = device.routing?.mpls?.ldp;
        const policies = device.routing?.policies ?? {};
        const named = [ldp, ...Object.values(ldp?.neighbors ?? {})].flatMap((holder) => [holder?.import_policy, holder?.export_policy]);
        const pending = [...new Set(named.filter((policy) => policy !== undefined))];
        const found: string[] = [];

        // A policy called on the way is looked at once, after those LDP names.
        for (const policy of pending) {
            (policies[policy] ?? []).forEach((rule, index) => {
                if (rule.call !== undefined && !pending.includes(rule.call)) pending.push(rule.call);
                const match = RouterOsRouting.onRoutes(rule) ? rule.if : undefined;
                const where = `routing.policies.${policy}[${index}].if`;
                const prefix = match?.prefix;
                if (prefix && Address.family(Address.host(prefix)) === "ipv4" && !prefix.endsWith("/32"))
                    found.push(
                        `${where}.prefix ${prefix} in an LDP policy: a RouterOS label filter matches the prefixes inside it too. Write a prefix set, which matches so`
                    );
                if (prefix && match.prefix_set)
                    found.push(`${where}, prefix and prefix_set at once in an LDP policy: a RouterOS label filter matches one prefix`);
                if (match?.prefix_length)
                    found.push(`${where}.prefix_length in an LDP policy: a RouterOS label filter matches a prefix only`);
                const set = match?.prefix_set ? device.routing?.prefix_sets?.[match.prefix_set] : undefined;
                if (set && "source" in set)
                    found.push(
                        `${where}.prefix_set ${match!.prefix_set}, from a registry, in an LDP policy: RouterOS writes a label filter for each prefix. Write the prefixes`
                    );
            });
        }
        return found;
    }

    /** A route policy rule on routes: not a call, and not a `{ communities }` rule, which `unsupported()` refuses. */
    static onRoutes(rule: PolicyRule): rule is RouteRule {
        return rule.call === undefined && rule.communities === undefined;
    }

    private static familySuffix(family: Family): string {
        return family === "ipv4" ? "V4" : "V6";
    }

    /** Community patterns with `*` as one regular expression the platform matches on: `64500:*:*` becomes `^64500:[0-9]+:[0-9]+$`, and several become `^(a|b)$`. */
    private static communityPattern(patterns: readonly string[]): string {
        const each = patterns.map((pattern) => pattern.replace(/\*/g, "[0-9]+"));
        return `^${each.length === 1 ? each[0] : `(${each.join("|")})`}$`;
    }

    /** The chain a policy is rendered as for one family. A policy can test prefix lengths that mean different things per family, so each family gets its own. */
    private static chainName(policy: string, family: Family): string {
        return `${policy}-${RouterOsRouting.familySuffix(family)}`;
    }

    /** A session's output chain. RouterOS sends its `default-originate` route through it (TRAPS.md), so a session with `send_default_route` gets a chain of its own that accepts the default route first. */
    private static exportChain(settings: NeighborSettings, family: Family): string {
        const policy = settings.export_policy ?? RouterOsRouting.REJECT_ALL;
        return RouterOsRouting.chainName(settings.send_default_route ? `${policy}-${RouterOsRouting.WITH_DEFAULT}` : policy, family);
    }

    /** The conditions of a rule, as the platform's filter language writes them. */
    private static conditions(rule: RouteRule): string[] {
        const match = rule.if ?? {};
        const tests: string[] = [];
        if (match.prefix) tests.push(`dst==${match.prefix}`);
        if (match.prefix_set) tests.push(`dst in ${match.prefix_set}`);
        if (match.prefix_length?.min !== undefined) tests.push(`dst-len>${match.prefix_length.min - 1}`);
        if (match.prefix_length?.max !== undefined) tests.push(`dst-len<${match.prefix_length.max + 1}`);
        if (match.as_path_length?.min !== undefined) tests.push(`bgp-path-len>${match.as_path_length.min - 1}`);
        if (match.as_path_length?.max !== undefined) tests.push(`bgp-path-len<${match.as_path_length.max + 1}`);
        // The platform's AS path regexp matches each AS as a whole number, so a bare number is that AS anywhere in the path.
        if (match.as_path_contains !== undefined) tests.push(RouterOsRouting.asPath(match.as_path_contains));
        if (match.first_as !== undefined) tests.push(RouterOsRouting.asPath(match.first_as, "^"));
        if (match.origin_as !== undefined) tests.push(RouterOsRouting.asPath(match.origin_as, "", "$"));
        if (match.rpki) tests.push(`rpki ${match.rpki}`);
        if (match.standard_community) tests.push(RouterOsRouting.communities("bgp-communities", match.standard_community));
        if (match.large_community) tests.push(RouterOsRouting.communities("bgp-large-communities", match.large_community));
        return tests;
    }

    /** An AS path test: one AS, `64501`, or a set, `[64501 64512-65534]`, between the anchors given, such as `^` for the first AS. */
    private static asPath(numbers: AsNumbers, before = "", after = ""): string {
        const ranges = Derive.asRanges(numbers);
        const single = ranges.length === 1 && ranges[0]!.min === ranges[0]!.max;
        const set = ranges.map(({ min, max }) => (min === max ? `${min}` : `${min}-${max}`)).join(" ");
        const regexp = `${before}${single ? set : `[${set}]`}${after}`;
        // The device refuses a set with spaces unless it is quoted (TRAPS.md).
        return `bgp-as-path ${regexp.includes(" ") ? `"${regexp}"` : regexp}`;
    }

    /** A test that the route has any of these communities. One with a `*` part is matched by regular expression. */
    private static communities(property: string, values: string | readonly string[]): string {
        const list = [values].flat();
        if (list.some((value) => value.includes("*"))) return `${property} any-regexp "${RouterOsRouting.communityPattern(list)}"`;

        return list.length === 1 ? `${property} includes ${list[0]}` : `${property} any ${list.join(",")}`;
    }

    /** What a rule does to a matching route, then its decision. */
    private static actions(rule: RouteRule, family: Family): string[] {
        const set = rule.set ?? {};
        const steps: string[] = [];
        if (set.local_pref !== undefined) steps.push(`set bgp-local-pref ${set.local_pref}`);
        if (set.med !== undefined) steps.push(`set bgp-med ${set.med}`);
        // `bgp-path-prepend` is how many times the AS goes out in all, the one it always sends included (TRAPS.md).
        if (set.prepend !== undefined) steps.push(`set bgp-path-prepend ${set.prepend + 1}`);
        for (const pattern of set.remove_standard_communities ?? []) {
            steps.push(`delete bgp-communities regexp "${RouterOsRouting.communityPattern([pattern])}"`);
        }
        if (set.standard_communities) steps.push(`set bgp-communities ${set.standard_communities.join(",")}`);
        if (set.add_standard_communities) steps.push(`append bgp-communities ${set.add_standard_communities.join(",")}`);

        for (const pattern of set.remove_large_communities ?? []) {
            steps.push(`delete bgp-large-communities regexp "${RouterOsRouting.communityPattern([pattern])}"`);
        }

        if (set.large_communities) steps.push(`set bgp-large-communities ${set.large_communities.join(",")}`);
        if (set.add_large_communities) steps.push(`append bgp-large-communities ${set.add_large_communities.join(",")}`);
        // An address only means something to routes of its own family.
        if (set.next_hop && Address.family(set.next_hop) === family) steps.push(`set gw ${set.next_hop}`);
        const preferredSource = set.preferred_source && Address.host(set.preferred_source);
        if (preferredSource && Address.family(preferredSource) === family) steps.push(`set pref-src ${preferredSource}`);
        if (set.blackhole) steps.push("set blackhole yes");
        if (rule.then) steps.push(rule.then);
        return steps;
    }

    /** One rule as the platform writes it: hand off, ask the validator, test, change, decide. */
    private static ruleText(rule: PolicyRule, family: Family): string {
        if (rule.call) return `jump ${RouterOsRouting.chainName(rule.call, family)}`;
        if (!RouterOsRouting.onRoutes(rule)) return "";

        const parts: string[] = [];
        // An RPKI state is only known once the validator has been asked, per route, so the question goes on the same rule.
        if (rule.if?.rpki) parts.push(`rpki-verify ${RouterOsRouting.RPKI_GROUP}`);

        const tests = RouterOsRouting.conditions(rule);
        const steps = RouterOsRouting.actions(rule, family);
        if (tests.length) parts.push(`if (${tests.join(" && ")})${steps.length ? ` { ${steps.join("; ")} }` : ""}`);
        else parts.push(...steps);
        return parts.join("; ");
    }

    /** A table beside the main one. `fib` puts its routes in the forwarding table, so traffic can be routed by them. */
    private tables(): void {
        for (const [name, table] of RouterOsSyntax.entries(this.device.routing?.tables)) {
            this.render.add("/routing table", "add fib", { comment: table.description, name });
        }
    }

    /** Rules in the order written. `lookup-only-in-table` drops what the table has no route for, and `lookup` falls back to the main table. */
    private rules(): void {
        for (const rule of this.device.routing?.policy_routing ?? []) {
            const onlyInTable = rule.routing_table !== "main" && (rule.fallback ?? "none") === "none";
            this.render.add("/routing rule", "add", {
                action: onlyInTable ? "lookup-only-in-table" : "lookup",
                comment: rule.description,
                "dst-address": rule.match?.dst,
                interface: rule.match?.in_interface && this.render.name(rule.match.in_interface),
                "src-address": rule.match?.src,
                table: rule.routing_table,
            });
        }
    }

    private staticRoutes(): void {
        for (const route of this.device.routing?.static_routes ?? []) {
            const menu = Address.family(Address.host(route.prefix)) === "ipv4" ? "/ip route" : "/ipv6 route";
            const verb = route.blackhole ? "add blackhole" : "add";
            const nextHop = route.next_hop && Address.host(route.next_hop);
            const out = route.interface && this.render.name(route.interface);
            // A next hop with its interface is written `fe80::1%ether1`, the form a link-local next hop needs (TRAPS.md).
            const through = nextHop && out ? `${nextHop}%${out}` : (nextHop ?? out);
            // RouterOS looks a gateway up in main unless the gateway ends in its VRF, so a route in a VRF without it stays inactive: `192.0.2.2@wan`, `ether1@wan` (TRAPS.md).
            const gateway = through && route.vrf ? `${through}@${route.vrf}` : through;
            this.render.add(menu, verb, {
                comment: route.description,
                distance: route.distance,
                "dst-address": route.prefix,
                gateway,
                "routing-table": route.vrf ?? Utils.otherTable(route.routing_table),
            });
        }
    }

    private rpki(): void {
        for (const server of this.device.routing?.rpki ?? []) {
            this.render.add("/routing rpki", "add", {
                address: server.address,
                comment: server.description,
                group: RouterOsRouting.RPKI_GROUP,
                port: server.port,
            });
        }
    }

    /** The default instance exists on every device; it is stated in the form the export prints it. */
    private bgpInstance(): void {
        const bgp = this.device.routing!.bgp!;
        this.render.add("/routing bgp instance", "add", {
            as: bgp.asn,
            "cluster-id": bgp.cluster_id,
            name: "default",
            "router-id": this.device.routing?.router_id,
        });
    }

    /** `local.role` holds both a route reflector's client and an RFC 9234 role. The device checks refuse a client with a role, or in another AS. */
    private static roleOf(settings: NeighborSettings, internal: boolean): string {
        if (settings.route_reflector_client) return "ibgp-rr";
        if (settings.role) return RouterOsRouting.ROLES[settings.role];
        return internal ? "ibgp" : "ebgp";
    }

    /** A neighbor's settings with its group's beneath them. */
    private settingsOf(neighbor: Neighbor): NeighborSettings {
        const group = neighbor.neighbor_group ? this.device.routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
        return { ...group, ...neighbor };
    }

    /** The `ipv4` and `ipv6` routes a neighbor exchanges: the families it states, or its address's. Its VPN routes are not among them. */
    private familiesOf(neighbor: Neighbor): readonly Family[] {
        return Derive.unicastFamilies(this.settingsOf(neighbor), neighbor.address);
    }

    /**
     * A session's input or output chain. One that carries VPN routes takes them first, since route targets pick them, and `afi ipv4` doesn't match them (TRAPS.md). Its other routes go on to its policy's chain for its family. One that carries VPN routes only uses `VPN`.
     */
    private static sessionChain(chain: string | undefined, vpn: boolean): string | undefined {
        if (!vpn) return chain;
        return chain ? `${chain}-${RouterOsRouting.VPN}` : RouterOsRouting.VPN;
    }

    /** Whether a rule belongs on a family's chain. A rule naming another family, or a prefix or prefix set of another family, does not. A set of both families belongs on both. */
    private appliesTo(rule: PolicyRule, family: Family): boolean {
        const match = RouterOsRouting.onRoutes(rule) ? rule.if : undefined;
        if (match?.family && match.family !== family) return false;

        if (match?.prefix && Address.family(Address.host(match.prefix)) !== family) return false;

        if (match?.prefix_set) {
            const set = this.device.routing?.prefix_sets?.[match.prefix_set];
            if (!set) return false;

            const prefixes = RouterOsSyntax.prefixesOf(this.device, match.prefix_set) ?? [];
            const families = "source" in set ? [set.source.family] : prefixes.map((prefix) => Address.family(Address.host(prefix)));
            if (!families.includes(family)) return false;
        }

        return true;
    }

    /**
     * Policies become filter chains, one per family a session uses, plus every chain those call. A chain a session uses ends in a reject when its last rule does not decide, whatever the platform's default. A chain only called returns to its caller instead.
     */
    private policies(): void {
        const bgp = this.device.routing!.bgp!;
        const policies = this.device.routing?.policies ?? {};

        const wanted = new Map<string, Set<Family>>();
        const want = (policy: string, family: Family) => {
            const families = wanted.get(policy) ?? new Set();
            if (families.has(family)) return;

            families.add(family);
            wanted.set(policy, families);
            for (const rule of policies[policy] ?? []) if (rule.call && this.appliesTo(rule, family)) want(rule.call, family);
        };

        let rejectAllNeeded = false;
        const withDefault = new Map<string, Set<Family>>();

        for (const neighbor of Object.values(bgp.neighbors ?? {})) {
            const settings = this.settingsOf(neighbor);

            for (const family of this.familiesOf(neighbor)) {
                for (const policy of [settings.import_policy, settings.export_policy]) {
                    if (policy) want(policy, family);
                    else rejectAllNeeded = true;
                }

                if (settings.send_default_route) {
                    const policy = settings.export_policy ?? RouterOsRouting.REJECT_ALL;
                    withDefault.set(policy, (withDefault.get(policy) ?? new Set()).add(family));
                }
            }
        }

        // A table hands routes of both families to the VPN table, and takes both from it.
        const vrfs = Object.values(this.device.routing?.vrfs ?? {});
        const unique = (names: (string | undefined)[]) => [...new Set(names.filter((name) => name !== undefined))].sort();
        const imported = unique([
            ...(this.device.routing?.vrf_imports ?? []).map(({ policy }) => policy),
            ...vrfs.map((vrf) => vrf?.export_policy),
        ]);
        const fromVpn = unique(vrfs.map((vrf) => vrf?.import_policy));
        for (const policy of [...imported, ...fromVpn]) for (const family of ["ipv4", "ipv6"] as const) want(policy, family);

        const called = new Set(Object.values(policies).flatMap((rules) => (rules ?? []).flatMap((rule) => (rule.call ? [rule.call] : []))));

        for (const policy of [...wanted.keys()].sort()) {
            for (const family of ["ipv4", "ipv6"] as const) {
                if (!wanted.get(policy)!.has(family)) continue;

                const chain = RouterOsRouting.chainName(policy, family);
                const rules = (policies[policy] ?? []).filter((rule) => this.appliesTo(rule, family));

                for (const rule of rules) {
                    const text = RouterOsRouting.ruleText(rule, family);
                    const comment = RouterOsRouting.onRoutes(rule) ? rule.description : undefined;
                    if (text) this.render.add("/routing filter rule", "add", { chain, comment, rule: text });
                }

                const last = rules.at(-1);
                const decides = last !== undefined && RouterOsRouting.onRoutes(last) && !last.if && last.then !== undefined;
                if (!called.has(policy) && !decides) this.render.add("/routing filter rule", "add", { chain, rule: "reject" });
            }
        }

        if (rejectAllNeeded) {
            for (const family of ["ipv4", "ipv6"] as const)
                this.render.add("/routing filter rule", "add", {
                    chain: RouterOsRouting.chainName(RouterOsRouting.REJECT_ALL, family),
                    rule: "reject",
                });
        }

        for (const policy of [...withDefault.keys()].sort()) {
            for (const family of ["ipv4", "ipv6"] as const) {
                if (!withDefault.get(policy)!.has(family)) continue;

                const chain = RouterOsRouting.chainName(`${policy}-${RouterOsRouting.WITH_DEFAULT}`, family);
                this.render.add("/routing filter rule", "add", { chain, rule: `if (dst==${presets.default_routes[family]}) { accept }` });
                this.render.add("/routing filter rule", "add", { chain, rule: `jump ${RouterOsRouting.chainName(policy, family)}` });
            }
        }

        this.vpnChains();

        // The VPN table takes both families through one chain. A VRF takes both from it through another, where each route is of a VPN family (TRAPS.md).
        const chains = [
            ...imported.map((policy) => ({ chain: `${policy}-${RouterOsRouting.IMPORTED}`, policy, afi: { ipv4: "ipv4", ipv6: "ipv6" } })),
            ...fromVpn.map((policy) => ({ chain: `${policy}-${RouterOsRouting.FROM_VPN}`, policy, afi: { ipv4: "vpnv4", ipv6: "vpnv6" } })),
        ];
        for (const { chain, policy, afi } of chains) {
            for (const family of ["ipv4", "ipv6"] as const)
                this.render.add("/routing filter rule", "add", {
                    chain,
                    rule: `if (afi ${afi[family]}) { jump ${RouterOsRouting.chainName(policy, family)} }`,
                });
            this.render.add("/routing filter rule", "add", { chain, rule: "reject" });
        }
    }

    /** The chains of sessions that carry VPN routes: each takes them, then hands the rest to the session's own chain, or rejects them. */
    private vpnChains(): void {
        const chains = new Map<string, string | undefined>();
        for (const neighbor of Object.values(this.device.routing!.bgp!.neighbors ?? {})) {
            const settings = this.settingsOf(neighbor);
            if (!Derive.vpnFamilies(settings).length) continue;

            const [family] = this.familiesOf(neighbor);
            const own = family && [
                RouterOsRouting.chainName(settings.import_policy ?? RouterOsRouting.REJECT_ALL, family),
                RouterOsRouting.exportChain(settings, family),
            ];
            for (const chain of own || [undefined]) chains.set(RouterOsRouting.sessionChain(chain, true)!, chain);
        }

        for (const [chain, next] of [...chains].sort(([a], [b]) => a.localeCompare(b))) {
            this.render.add("/routing filter rule", "add", { chain, rule: `if (afi ${RouterOsRouting.AFI.vpnv4}) { accept }` });
            this.render.add("/routing filter rule", "add", { chain, rule: next ? `jump ${next}` : "reject" });
        }
    }

    /**
     * Routes a table takes from another go through the BGP VPN table, as MikroTik's VRF guide has it, with no session. The table they come from hands them over with a route target of the import's own, through the policy's chain, and the table they go to takes that target. The targets are the router's AS and the import's place in the list.
     */
    private vrfImports(): void {
        const imports = this.device.routing?.vrf_imports ?? [];
        const asn = this.device.routing!.bgp!.asn;
        const target = (index: number) => `${asn}:${index + 1}`;

        imports.forEach(({ from, to, policy }, index) => {
            this.render.add("/routing bgp vpn", "add", {
                "export.filter-chain": `${policy}-${RouterOsRouting.IMPORTED}`,
                "export.redistribute": RouterOsRouting.EXPORTED,
                "export.route-targets": target(index),
                instance: "default",
                "label-allocation-policy": "per-vrf",
                name: `${from}-to-${to}`,
                "route-distinguisher": target(index),
                vrf: from,
            });
        });

        // Each table that takes routes, after the entries that hand them over, with a route distinguisher of its own.
        const tables = [...new Set(imports.map(({ to }) => to))];
        tables.forEach((table, index) => {
            this.render.add("/routing bgp vpn", "add", {
                "import.route-targets": imports.flatMap(({ to }, place) => (to === table ? [target(place)] : [])).join(","),
                instance: "default",
                "label-allocation-policy": "per-vrf",
                name: table,
                "route-distinguisher": target(imports.length + index),
                vrf: table,
            });
        });
    }

    /** One connection per neighbor. The platform carries one family of `ipv4` and `ipv6` per connection, and VPN routes beside it. */
    private bgpConnections(): void {
        const bgp = this.device.routing!.bgp!;

        for (const [name, neighbor] of Object.entries(bgp.neighbors ?? {})) {
            const settings = this.settingsOf(neighbor);
            const [family] = this.familiesOf(neighbor);
            const addressFamily = Address.family(neighbor.address);
            const families = settings.address_families ?? [addressFamily];
            const vpn = Derive.vpnFamilies(settings).length > 0;
            const internal = settings.remote_as === bgp.asn;
            const originates = bgp.originated_prefixes?.some((prefix) => Address.family(Address.host(prefix)) === family);
            const role = RouterOsRouting.roleOf(settings, internal);
            const importChain = family && RouterOsRouting.chainName(settings.import_policy ?? RouterOsRouting.REJECT_ALL, family);

            this.render.add("/routing bgp connection", "add", {
                // Only stated when the routes differ in family from the address they are carried over.
                afi:
                    families.length === 1 && families[0] === addressFamily
                        ? undefined
                        : Object.entries(RouterOsRouting.AFI)
                              .filter(([written]) => families.includes(written as BgpFamily))
                              .map(([, afi]) => afi)
                              .join(","),
                as: bgp.asn,
                comment: settings.description,
                connect: settings.passive ? "no" : undefined,
                "hold-time": settings.hold_time ? RouterOsSyntax.duration(settings.hold_time) : undefined,
                "input.filter": RouterOsRouting.sessionChain(importChain, vpn),
                // The one instance bgpInstance adds. 7.23 refuses a new connection without it.
                instance: "default",
                // `unsupported()` refuses a limit on a session with VPN routes, which this would not count.
                [`input.limit-process-routes-${family}`]: family && Derive.prefixLimit(settings)?.limit,
                "keepalive-time": settings.keepalive ? RouterOsSyntax.duration(settings.keepalive) : undefined,
                listen: settings.passive ? "yes" : undefined,
                "local.address": settings.local_address && Address.host(settings.local_address),
                "local.role": role,
                "local.ttl": settings.ttl_security ? RouterOsRouting.GTSM_TTL : undefined,
                multihop: settings.multihop ? "yes" : undefined,
                name,
                "output.default-originate": settings.send_default_route ? "always" : undefined,
                "output.filter-chain": RouterOsRouting.sessionChain(family && RouterOsRouting.exportChain(settings, family), vpn),
                "output.network": family && originates ? RouterOsSyntax.NETWORKS[family] : undefined,
                "remote.address": `${neighbor.address}/${addressFamily === "ipv4" ? 32 : 128}`,
                "remote.as": settings.remote_as,
                // The lowest TTL accepted on arrival.
                "remote.ttl": settings.ttl_security ? RouterOsRouting.GTSM_TTL : undefined,
                // A connection in a VRF names its table too: the VRF's table has the VRF's name.
                "routing-table": settings.vrf ?? Utils.otherTable(settings.routing_table),
                "tcp-md5-key": settings.password && Secrets.marker(settings.password),
                "use-bfd": settings.bfd ? "yes" : undefined,
                vrf: settings.vrf,
            });
        }
    }

    /** One instance per OSPF version, and an area per area and instance with its ranges of the version's family. Then a template per interface, the neighbors of a link without multicast, and an interface per virtual link. */
    private ospf(): void {
        const ospf = this.device.routing?.ospf;
        if (!ospf) return;

        for (const family of ospf.address_families ?? ["ipv4"]) {
            const version = family === "ipv4" ? 2 : 3;
            const instance = `ospf-v${version}`;
            this.render.add("/routing ospf instance", "add", {
                name: instance,
                redistribute: ospf.redistribute?.join(","),
                "router-id": this.device.routing?.router_id,
                version,
                vrf: ospf.vrf,
            });

            for (const [areaId, area] of Object.entries(ospf.areas)) {
                // `no-summaries` is a flag, written without a value.
                this.render.add("/routing ospf area", area.no_summaries ? "add no-summaries" : "add", {
                    "area-id": areaId,
                    "default-cost": area.stub_default_cost,
                    instance,
                    name: `${instance}-${areaId}`,
                    type: area.type,
                });
            }

            for (const [areaId, area] of Object.entries(ospf.areas)) {
                for (const range of area.ranges ?? []) {
                    if (Address.family(range.prefix) !== family) continue;
                    this.render.add("/routing ospf area range", "add", {
                        advertise: range.advertise ? "yes" : "no",
                        area: `${instance}-${areaId}`,
                        cost: range.cost,
                        prefix: Address.prefixOf(range.prefix),
                    });
                }
            }

            for (const [areaId, area] of Object.entries(ospf.areas))
                for (const [iface, settings] of Object.entries(area.interfaces))
                    this.ospfTemplate(`${instance}-${areaId}`, iface, settings ?? {});

            // A virtual link is an OSPF interface of its own, not a template, which refuses `type=virtual-link` (TRAPS.md).
            for (const [areaId, area] of Object.entries(ospf.areas))
                for (const link of area.virtual_links ?? [])
                    this.render.add("/routing ospf interface", "add", {
                        area: `${instance}-${areaId}`,
                        type: "virtual-link",
                        "vlink-neighbor-id": link.router_id,
                        "vlink-transit-area": `${instance}-${link.transit_area_id}`,
                    });
        }
    }

    /** One interface's template, then a static neighbor for each neighbor it writes, at its address on the interface. */
    private ospfTemplate(areaName: string, iface: string, settings: OspfInterface): void {
        const name = this.render.name(iface);
        // `passive` is a flag, written without a value.
        const verb = settings.passive ? "add passive" : "add";
        const authentication = settings.authentication;
        this.render.add("/routing ospf interface-template", verb, {
            area: areaName,
            auth: authentication && RouterOsRouting.OSPF_AUTH[authentication.algorithm],
            "auth-id": authentication?.key_id,
            "auth-key": authentication && Secrets.marker(authentication.key),
            cost: settings.cost,
            "dead-interval": settings.dead_interval && RouterOsSyntax.duration(settings.dead_interval),
            "hello-interval": settings.hello_interval && RouterOsSyntax.duration(settings.hello_interval),
            interfaces: name,
            priority: settings.priority,
            type: settings.network && RouterOsRouting.OSPF_NETWORK[settings.network],
            "use-bfd": settings.bfd ? "yes" : undefined,
        });

        for (const neighbor of settings.neighbors ?? [])
            this.render.add("/routing ospf static-neighbor", "add", { address: `${neighbor}%${name}`, area: areaName });
    }

    /** One instance, whose areas and system ID come from the NET, and a template per interface. A template's metric is under `ptp` or `bcast`, by its link type. */
    private isis(): void {
        const isis = this.device.routing?.isis;
        if (!isis) return;

        const groups = isis.net.split(".");
        this.render.add("/routing isis instance", "add", {
            afi: isis.address_families.map((family) => (family === "ipv4" ? "ip" : "ipv6")).join(","),
            areas: groups.slice(0, -4).join("."),
            "metric-type": "wide",
            name: RouterOsRouting.ISIS_INSTANCE,
            "system-id": groups.slice(-4, -1).join("."),
        });

        const levels = RouterOsRouting.ISIS_LEVELS[isis.level_capability];
        for (const [iface, settings] of Object.entries(isis.interfaces)) {
            const ptp = settings?.network === "point-to-point";
            // `passive` and `ptp` are flags, written without a value.
            const verb = ["add", settings?.passive && "passive", ptp && "ptp"].filter(Boolean).join(" ");
            const metrics = levels.map((level) => [`${ptp ? "ptp" : "bcast"}.${level}.metric`, settings?.metric]);
            this.render.add("/routing isis interface-template", verb, {
                instance: RouterOsRouting.ISIS_INSTANCE,
                interfaces: this.render.name(iface),
                levels: levels.join(","),
                ...Object.fromEntries(metrics),
            });
        }
    }

    /**
     * Each VRF in an L3VPN (RFC 4364) hands every route it holds to the BGP VPN table with its export targets, through its export policy's chain. It takes the VPN routes with an import target, through its import policy's chain, as MikroTik's VRF guide sets it up. One label stands for the whole VRF, not one per prefix.
     */
    private vpns(): void {
        for (const [vrf, settings] of RouterOsSyntax.entries(this.device.routing?.vrfs)) {
            const distinguisher = settings.route_distinguisher;
            if (distinguisher === undefined) continue;

            const exported = settings.route_targets?.export ?? [];
            const imported = settings.route_targets?.import ?? [];
            const { export_policy: exportPolicy, import_policy: importPolicy } = settings;
            this.render.add("/routing bgp vpn", "add", {
                "export.filter-chain": exportPolicy && `${exportPolicy}-${RouterOsRouting.IMPORTED}`,
                "export.redistribute": exported.length ? RouterOsRouting.EXPORTED : undefined,
                "export.route-targets": exported.length ? exported.join(",") : undefined,
                "import.filter-chain": importPolicy && `${importPolicy}-${RouterOsRouting.FROM_VPN}`,
                "import.route-targets": imported.length ? imported.join(",") : undefined,
                instance: "default",
                "label-allocation-policy": "per-vrf",
                name: vrf,
                "route-distinguisher": distinguisher,
                vrf,
            });
        }
    }

    /** MPLS on each LDP interface, and one LDP instance in the main table, whose sessions start from the LSR ID, as MikroTik's LDP guide sets it up. */
    private mpls(): void {
        const ldp = this.device.routing?.mpls?.ldp;
        if (!ldp) return;

        const interfaces = ldp.interfaces.map((iface) => this.render.name(iface));
        for (const iface of interfaces) this.render.add("/mpls interface", "add", { interface: iface });
        this.render.add("/mpls ldp", "add", { afi: "ip", "lsr-id": ldp.lsr_id, "transport-addresses": ldp.lsr_id });
        for (const iface of interfaces) this.render.add("/mpls ldp interface", "add", { interface: iface });
        for (const target of ldp.targets ?? []) this.render.add("/mpls ldp neighbor", "add", { "send-targeted": "yes", transport: target });
        // The first filter that holds a label's prefix decides, so a neighbor's own come before the device's (TRAPS.md).
        const neighbors = Object.entries(ldp.neighbors ?? {});
        for (const [lsrId, neighbor] of neighbors) this.ldpFilters("/mpls ldp accept-filter", "accept", neighbor?.import_policy, lsrId);
        this.ldpFilters("/mpls ldp accept-filter", "accept", ldp.import_policy);
        for (const [lsrId, neighbor] of neighbors)
            this.ldpFilters("/mpls ldp advertise-filter", "advertise", neighbor?.export_policy, lsrId);
        this.ldpFilters("/mpls ldp advertise-filter", "advertise", ldp.export_policy);
    }

    /**
     * An LDP policy as label filters, in its order: an entry for each prefix a rule matches, with the rule's decision. A filter matches its prefix and every prefix inside it, as `prefix_set` does. With no entry matching, RouterOS takes the label, so the filters end in one that rejects every prefix, unless the last already decides for all. A neighbor's policy holds each entry to its LSR ID.
     */
    private ldpFilters(menu: string, decision: "accept" | "advertise", policy: string | undefined, neighbor?: string): void {
        if (!policy) return;

        const entries = this.ldpEntries(policy, []);
        if (entries.at(-1)?.prefix !== RouterOsRouting.EVERY_IPV4) entries.push({ prefix: RouterOsRouting.EVERY_IPV4, then: "reject" });
        for (const { prefix, then } of entries)
            this.render.add(menu, "add", { [decision]: RouterOsSyntax.yesNo(then === "accept"), neighbor, prefix });
    }

    /** The prefixes a policy's rules match, each with the rule's decision, and in place of a call, those of the policy it calls. LDP labels IPv4 routes only, so a rule or a prefix of IPv6 has none. */
    private ldpEntries(policy: string, calling: readonly string[]): { prefix: string; then: "accept" | "reject" }[] {
        if (calling.includes(policy)) return [];

        return (this.device.routing?.policies?.[policy] ?? []).flatMap((rule) => {
            if (rule.call !== undefined) return this.ldpEntries(rule.call, [...calling, policy]);
            if (!RouterOsRouting.onRoutes(rule) || !rule.then || !this.appliesTo(rule, "ipv4")) return [];

            const { then } = rule;
            let prefixes: readonly string[] = [RouterOsRouting.EVERY_IPV4];
            if (rule.if?.prefix) prefixes = [rule.if.prefix];
            else if (rule.if?.prefix_set) prefixes = RouterOsSyntax.prefixesOf(this.device, rule.if.prefix_set) ?? [];
            return prefixes.filter((prefix) => Address.family(Address.host(prefix)) === "ipv4").map((prefix) => ({ prefix, then }));
        });
    }

    /**
     * BFD runs where a session or an OSPF interface asks for it, with the device's timers when it states them. One configuration covers every interface. A multihop session has no interface, and BFD for it is forbidden unless a configuration names its address, so each gets one of its own (TRAPS.md).
     */
    private bfd(): void {
        const routing = this.device.routing;
        const bgpBfd = Object.values(routing?.bgp?.neighbors ?? {}).filter((neighbor) => this.settingsOf(neighbor).bfd);
        const multihop = bgpBfd.filter((neighbor) => this.settingsOf(neighbor).multihop);
        const ospfWants = Object.values(routing?.ospf?.areas ?? {}).some((area) =>
            Object.values(area.interfaces).some((iface) => iface?.bfd)
        );
        const timers = routing?.bfd;
        const interval = timers ? `${timers.interval}ms` : undefined;
        const timerProperties = { "min-rx": interval, "min-tx": interval, multiplier: timers?.multiplier };

        const directWants = bgpBfd.length > multihop.length || ospfWants;
        if (directWants || (timers && !multihop.length)) {
            this.render.add("/routing bfd configuration", "add", { interfaces: "all", ...timerProperties });
        }

        for (const neighbor of multihop) {
            const length = Address.family(neighbor.address) === "ipv4" ? 32 : 128;
            this.render.add("/routing bfd configuration", "add", { addresses: `${neighbor.address}/${length}`, ...timerProperties });
        }
    }
}
