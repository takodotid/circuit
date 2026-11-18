import { Utils } from "../../core/utils";
import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Family, Neighbor, NeighborSettings, PolicyRule, RouteRule } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** Routing tables and rules, static routes, RPKI, BGP with its policies' filter chains, OSPF, and BFD, added to one device's render. */
export class RouterOsRouting {
    /** The validator group every RPKI server joins. */
    private static readonly RPKI_GROUP = "rpki";

    /** The chain a session without a policy uses, so that it learns or announces nothing. */
    private static readonly REJECT_ALL = "REJECT-ALL";

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
        }

        routing.ospf();
        routing.bfd();
    }

    /** A route policy rule on routes: not a call, and not a `{ communities }` rule, which `unsupported()` refuses. */
    static onRoutes(rule: PolicyRule): rule is RouteRule {
        return rule.call === undefined && rule.communities === undefined;
    }

    private static familySuffix(family: Family): string {
        return family === "ipv4" ? "V4" : "V6";
    }

    /** A community pattern with `*` as a regular expression the platform matches on: `64500:*:*` becomes `^64500:[0-9]+:[0-9]+$`. */
    private static communityPattern(pattern: string): string {
        const fields = pattern.split(":").map((field) => (field === "*" ? "[0-9]+" : field));
        return `^${fields.join(":")}$`;
    }

    /** The chain a policy is rendered as for one family. A policy can test prefix lengths that mean different things per family, so each family gets its own. */
    private static chainName(policy: string, family: Family): string {
        return `${policy}-${RouterOsRouting.familySuffix(family)}`;
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
        if (match.as_path_contains !== undefined) tests.push(`bgp-as-path ${match.as_path_contains}`);
        if (match.rpki) tests.push(`rpki ${match.rpki}`);
        if (match.standard_community) tests.push(`bgp-communities includes ${match.standard_community}`);
        if (match.large_community) tests.push(`bgp-large-communities includes ${match.large_community}`);
        return tests;
    }

    /** What a rule does to a matching route, then its decision. */
    private static actions(rule: RouteRule, family: Family): string[] {
        const set = rule.set ?? {};
        const steps: string[] = [];
        if (set.local_pref !== undefined) steps.push(`set bgp-local-pref ${set.local_pref}`);
        if (set.med !== undefined) steps.push(`set bgp-med ${set.med}`);
        if (set.prepend !== undefined) steps.push(`set bgp-path-prepend ${set.prepend}`);
        for (const pattern of set.remove_standard_communities ?? []) {
            steps.push(`delete bgp-communities regexp "${RouterOsRouting.communityPattern(pattern)}"`);
        }
        if (set.standard_communities) steps.push(`set bgp-communities ${set.standard_communities.join(",")}`);
        if (set.add_standard_communities) steps.push(`append bgp-communities ${set.add_standard_communities.join(",")}`);

        for (const pattern of set.remove_large_communities ?? []) {
            steps.push(`delete bgp-large-communities regexp "${RouterOsRouting.communityPattern(pattern)}"`);
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
            const gateway = nextHop && out ? `${nextHop}%${out}` : (nextHop ?? out);
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
        this.render.add("/routing bgp instance", "add", { as: bgp.asn, name: "default", "router-id": this.device.routing?.router_id });
    }

    /** A neighbor's settings with its group's beneath them. */
    private settingsOf(neighbor: Neighbor): NeighborSettings {
        const group = neighbor.neighbor_group ? this.device.routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
        return { ...group, ...neighbor };
    }

    /** The families a neighbor exchanges: the ones it states, or its address's. */
    private familiesOf(neighbor: Neighbor): readonly Family[] {
        return this.settingsOf(neighbor).address_families ?? [Address.family(neighbor.address)];
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

        for (const neighbor of Object.values(bgp.neighbors ?? {})) {
            const settings = this.settingsOf(neighbor);

            for (const family of this.familiesOf(neighbor)) {
                for (const policy of [settings.import_policy, settings.export_policy]) {
                    if (policy) want(policy, family);
                    else rejectAllNeeded = true;
                }
            }
        }

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
    }

    /** One connection per neighbor. The platform carries one family per connection. */
    private bgpConnections(): void {
        const bgp = this.device.routing!.bgp!;

        for (const [name, neighbor] of Object.entries(bgp.neighbors ?? {})) {
            const settings = this.settingsOf(neighbor);
            const [family] = this.familiesOf(neighbor) as [Family];
            const addressFamily = Address.family(neighbor.address);
            const internal = settings.remote_as === bgp.asn;
            const originates = bgp.originated_prefixes?.some((prefix) => Address.family(Address.host(prefix)) === family);
            const role = settings.role ? RouterOsRouting.ROLES[settings.role] : internal ? "ibgp" : "ebgp";

            this.render.add("/routing bgp connection", "add", {
                // Only stated when the routes differ in family from the address they are carried over.
                afi: addressFamily === family ? undefined : family === "ipv6" ? "ipv6" : "ip",
                as: bgp.asn,
                connect: settings.passive ? "no" : undefined,
                "hold-time": settings.hold_time ? RouterOsSyntax.duration(settings.hold_time) : undefined,
                "input.filter": RouterOsRouting.chainName(settings.import_policy ?? RouterOsRouting.REJECT_ALL, family),
                // The one instance bgpInstance adds. 7.23 refuses a new connection without it.
                instance: "default",
                [`input.limit-process-routes-${family}`]: settings.max_prefixes,
                "keepalive-time": settings.keepalive ? RouterOsSyntax.duration(settings.keepalive) : undefined,
                listen: settings.passive ? "yes" : undefined,
                "local.address": settings.local_address && Address.host(settings.local_address),
                "local.role": role,
                "local.ttl": settings.ttl_security ? RouterOsRouting.GTSM_TTL : undefined,
                multihop: settings.multihop ? "yes" : undefined,
                name,
                "output.filter-chain": RouterOsRouting.chainName(settings.export_policy ?? RouterOsRouting.REJECT_ALL, family),
                "output.network": originates ? RouterOsSyntax.NETWORKS[family] : undefined,
                "remote.address": `${neighbor.address}/${addressFamily === "ipv4" ? 32 : 128}`,
                "remote.as": settings.remote_as,
                // The lowest TTL accepted on arrival.
                "remote.ttl": settings.ttl_security ? RouterOsRouting.GTSM_TTL : undefined,
                "routing-table": Utils.otherTable(settings.routing_table),
                "tcp-md5-key": settings.password && Secrets.marker(settings.password),
                "use-bfd": settings.bfd ? "yes" : undefined,
            });
        }
    }

    /** One instance per OSPF version, an area per area and instance, and a template per interface. */
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
            });

            for (const [areaId, area] of Object.entries(ospf.areas)) {
                const areaName = `${instance}-${areaId}`;
                this.render.add("/routing ospf area", "add", { "area-id": areaId, instance, name: areaName });

                for (const [iface, settings] of Object.entries(area.interfaces)) {
                    // `passive` is a flag, written without a value.
                    const verb = settings?.passive ? "add passive" : "add";
                    this.render.add("/routing ospf interface-template", verb, {
                        area: areaName,
                        cost: settings?.cost,
                        interfaces: this.render.name(iface),
                        type: settings?.network === "point-to-point" ? "ptp" : undefined,
                        "use-bfd": settings?.bfd ? "yes" : undefined,
                    });
                }
            }
        }
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
