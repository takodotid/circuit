import { presets } from "../../config/presets";
import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { AsNumbers, Device, Family, Neighbor, NeighborSettings, PolicyRule, Prefix, PrefixSet, RouteRule } from "../../model";
import { JunosStatements } from "./statements";

/** BGP sessions, the policies they use, prefix sets, and RPKI servers. */
export class JunosBgp {
    /** The policy of a session that states none, so it learns or announces nothing. */
    private static readonly REJECT_ALL = "circuit-reject-all";

    /** The policy every export starts with. BGP's own routes, the prefixes the device originates, and its aggregates go on to the session's policy. The device's other routes never reach it. */
    private static readonly ORIGIN = "circuit-bgp-origin";

    /** The routes an aggregate stands for: BGP's own routes and the prefixes the device originates, as on platforms whose aggregates count only BGP's routes. */
    private static readonly CONTRIBUTORS = "circuit-aggregate-contributors";

    /** The policy that announces a default route to a session with `send_default_route`, before its own policy. */
    private static readonly DEFAULT_ROUTE = "circuit-default-route";

    /** The highest preference there is: every other default route wins over the one made for `send_default_route`, so forwarding never changes. */
    private static readonly LAST_RESORT = 4294967295;

    private static readonly RPKI_GROUP = "circuit";

    /** A comment in the render naming a path whose statements `refresh` fills, so the plan keeps what the device holds there. */
    static readonly GENERATED = "# generated ";

    private static readonly FAMILY = { ipv4: "inet", ipv6: "inet6" } as const;

    private static readonly VALIDATION = { valid: "valid", invalid: "invalid", "not-found": "unknown" } as const;

    /** The route match fields that hold AS numbers. */
    static readonly AS_FIELDS = ["as_path_contains", "first_as", "origin_as"] as const;

    /** Where in the path each AS field looks, as an AS list matcher: any AS, the first, the last. Junos 21.3 has them. */
    private static readonly AS_LIST_MATCH = {
        as_path_contains: "as-path-transits",
        first_as: "as-path-neighbors",
        origin_as: "as-path-origins",
    } as const;

    /** The same as a regular expression around the ASes, and the name it goes by. */
    private static readonly AS_REGEX = {
        as_path_contains: { name: "through", before: ".* ", after: " .*" },
        first_as: { name: "first", before: "", after: " .*" },
        origin_as: { name: "origin", before: ".* ", after: "" },
    } as const;

    /** The highest AS number, which an AS list refuses, as it does AS 0 (TRAPS.md). */
    private static readonly MAX_ASN = 4294967295;

    /** The device waits whole minutes before it opens a session closed on its prefix limit. */
    static readonly SECONDS_PER_MINUTE = 60;
    /** The longest it waits, in minutes. */
    static readonly MAX_IDLE_MINUTES = 2400;

    private constructor(
        private readonly out: JunosStatements,
        private readonly device: Device
    ) {}

    static render(out: JunosStatements, device: Device): void {
        const bgp = new JunosBgp(out, device);

        bgp.prefixSets();
        bgp.rpki();
        bgp.sessions();
    }

    /** A neighbor's settings with its group's beneath them. */
    static settingsOf(device: Device, neighbor: Neighbor): NeighborSettings {
        const group = neighbor.neighbor_group ? device.routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
        return { ...group, ...neighbor };
    }

    /** Written as a list or as a map of named prefixes. A set that `refresh` fetches has none here. */
    static prefixesOf(set: PrefixSet): Prefix[] {
        if (!("prefixes" in set)) return [];

        return Array.isArray(set.prefixes) ? [...(set.prefixes as readonly Prefix[])] : Object.values(set.prefixes);
    }

    /** A rule on routes: neither a call nor a communities rule. */
    static isRouteRule(rule: PolicyRule): rule is RouteRule {
        return !("call" in rule && rule.call !== undefined) && !("communities" in rule && rule.communities !== undefined);
    }

    /** A name made of a value's words, for a community or a path-length list: `64500:*` becomes `64500-any`. */
    private static slug(value: string): string {
        return value.replace(/\*/g, "any").replace(/[^A-Za-z0-9]+/g, "-");
    }

    /** A community as the platform writes a member: a large community carries the `large:` prefix. */
    private static member(community: string, large: boolean): string {
        return large ? `large:${community}` : community;
    }

    /** Its place, then the rule's description so a reader sees it on the device. */
    private static termName(label: string, rule: RouteRule): string {
        return JunosStatements.quote(rule.description ? `${label} ${rule.description}` : label);
    }

    private sessions(): void {
        const bgp = this.device.routing?.bgp;
        // Without our AS there is no BGP to write. `unsupported()` names it.
        if (!bgp || bgp.asn === undefined) return;

        this.out.set("routing-options autonomous-system", bgp.asn);

        const used = new Set<string>();
        const defaults = new Set<Family>();
        let rejectAll = false;
        let exports = false;

        // One group per session: a group holds one type, internal or external, and the config's neighbor groups are only shared settings.
        for (const [name, neighbor] of Object.entries(bgp.neighbors ?? {})) {
            if (!neighbor) continue;

            const settings = JunosBgp.settingsOf(this.device, neighbor);
            const group = `protocols bgp group ${name}`;

            this.out.set(group, "type", settings.remote_as === bgp.asn ? "internal" : "external");
            this.out.set(group, "peer-as", settings.remote_as!);
            if (settings.description) this.out.set(group, "description", JunosStatements.quote(settings.description));
            if (settings.local_address) this.out.set(group, "local-address", Address.host(settings.local_address));
            if (settings.multihop) this.out.set(group, "multihop");
            // A neighbor in a group with a cluster ID is a client. `unsupported()` names a client without one.
            if (settings.route_reflector_client && bgp.cluster_id) this.out.set(group, "cluster", bgp.cluster_id);
            if (settings.passive) this.out.set(group, "passive");
            if (settings.hold_time !== undefined) this.out.set(group, "hold-time", settings.hold_time);
            if (settings.password) this.out.set(group, "authentication-key", Secrets.marker(settings.password));
            if (settings.bfd) this.out.bfd(group, this.device.routing?.bfd);
            // Only the router-wide statement turns it on: a group's own `graceful-restart` alone does nothing (TRAPS.md). `unsupported()` refuses it on only some neighbors.
            if (settings.graceful_restart) this.out.set("routing-options graceful-restart");

            this.out.set(group, "import", settings.import_policy ?? JunosBgp.REJECT_ALL);

            const families = settings.address_families ?? [Address.family(neighbor.address)];
            if (settings.send_default_route) {
                this.out.set(group, "export", JunosBgp.DEFAULT_ROUTE);
                for (const family of families) defaults.add(family);
            }

            if (settings.export_policy) {
                exports = true;
                this.out.set(group, "export", JunosBgp.ORIGIN);
                this.out.set(group, "export", settings.export_policy);
            } else this.out.set(group, "export", JunosBgp.REJECT_ALL);

            for (const policy of [settings.import_policy, settings.export_policy]) {
                if (policy) used.add(policy);
                else rejectAll = true;
            }

            const limit = Derive.prefixLimit(settings);

            for (const family of families) {
                const nlri = `${group} family ${JunosBgp.FAMILY[family]} unicast`;
                this.out.set(nlri);
                if (!limit) continue;

                // Without `teardown`, the device only logs a message.
                this.out.set(nlri, "prefix-limit maximum", limit.limit);
                if (limit.warn_only) continue;

                const idle = limit.restart_after === undefined ? "forever" : limit.restart_after / JunosBgp.SECONDS_PER_MINUTE;
                this.out.set(nlri, "prefix-limit teardown idle-timeout", idle);
            }

            this.out.set(group, "neighbor", neighbor.address);
        }

        if (rejectAll) this.out.set(`policy-options policy-statement ${JunosBgp.REJECT_ALL} then reject`);

        if (exports) this.origin();

        this.aggregates();
        for (const family of defaults) this.defaultRoute(family);

        for (const policy of [...used].sort()) this.policyStatement(policy);
    }

    private origin(): void {
        const statement = `policy-options policy-statement ${JunosBgp.ORIGIN}`;
        const aggregates = this.device.routing?.bgp?.aggregates ?? [];

        // The routes inside an aggregate with `summary_only` stay with the device. Junos has no setting for it, so the export rejects them.
        const summaries = aggregates.filter((aggregate) => aggregate.summary_only).map(({ prefix }) => prefix);
        this.termsByFamily(statement, "summary-only", summaries, "longer", "reject");

        this.out.set(statement, "term bgp from protocol bgp");
        this.out.set(statement, "term bgp then next policy");

        // `networks` is 0.x's name for the term, kept so a device that holds it is not rewritten.
        this.termsByFamily(statement, "networks", this.device.routing?.bgp?.originated_prefixes ?? [], "exact", "next policy");

        const prefixes = aggregates.map(({ prefix }) => prefix);
        this.termsByFamily(statement, "aggregates", prefixes, "exact", "next policy", ["protocol aggregate"]);

        this.out.set(statement, "term others then reject");
    }

    /** A term that matches `prefixes` for each family they are in: `name` for IPv4, `name-v6` for IPv6. One term cannot filter both (TRAPS.md). */
    private termsByFamily(
        statement: string,
        name: string,
        prefixes: readonly Prefix[],
        match: "exact" | "longer",
        then: string,
        from: string[] = []
    ): void {
        for (const family of ["ipv4", "ipv6"] as const) {
            const own = prefixes.filter((prefix) => Address.family(Address.host(prefix)) === family);
            if (!own.length) continue;

            const term = `${statement} term ${family === "ipv4" ? name : `${name}-v6`}`;
            for (const condition of from) this.out.set(term, "from", condition);
            for (const prefix of own) this.out.set(term, "from route-filter", prefix, match);
            this.out.set(term, "then", then);
        }
    }

    /** Each aggregate stands for BGP's routes and the originated prefixes inside it, as `CONTRIBUTORS` says. */
    private aggregates(): void {
        const bgp = this.device.routing!.bgp!;
        if (!bgp.aggregates?.length) return;

        for (const { prefix } of bgp.aggregates) {
            const options = Address.family(Address.host(prefix)) === "ipv6" ? "routing-options rib inet6.0" : "routing-options";
            this.out.set(`${options} aggregate route ${prefix} policy ${JunosBgp.CONTRIBUTORS}`);
        }

        const statement = `policy-options policy-statement ${JunosBgp.CONTRIBUTORS}`;
        this.out.set(statement, "term bgp from protocol bgp");
        this.out.set(statement, "term bgp then accept");

        this.termsByFamily(statement, "networks", bgp.originated_prefixes ?? [], "exact", "accept");

        this.out.set(statement, "term others then reject");
    }

    /** Junos has no setting that sends a neighbor a default route, so an aggregate makes one that is always there, `passive` even without a route under it. Its preference is the highest, so any other default route wins, and that one is announced instead. */
    private defaultRoute(family: Family): void {
        const options = family === "ipv6" ? "routing-options rib inet6.0" : "routing-options";
        const route = `${options} aggregate route ${presets.default_routes[family]}`;
        this.out.set(route, "passive");
        this.out.set(route, "preference", JunosBgp.LAST_RESORT);

        // Another default route keeps its next hop, which can be the neighbor's own address (TRAPS.md).
        const term = `policy-options policy-statement ${JunosBgp.DEFAULT_ROUTE} term ${family}`;
        this.out.set(term, "from route-filter", presets.default_routes[family], "exact");
        this.out.set(term, "then next-hop self");
        this.out.set(term, "then accept");
    }

    private prefixSets(): void {
        for (const [name, set] of Object.entries(this.device.routing?.prefix_sets ?? {})) {
            if (!set) continue;

            const list = `policy-options prefix-list ${name}`;
            const prefixes = JunosBgp.prefixesOf(set);

            if (prefixes.length) for (const prefix of prefixes) this.out.set(list, prefix);
            else this.out.set(list);

            if ("source" in set) this.out.note(`${JunosBgp.GENERATED}${list}`);
        }
    }

    private rpki(): void {
        for (const server of this.device.routing?.rpki ?? []) {
            this.out.set(`routing-options validation group ${JunosBgp.RPKI_GROUP} session`, server.address, "port", server.port);
        }
    }

    /** The family a rule is limited to, by its match: a family, a prefix, or a prefix set of one family. */
    private familyOfRule(rule: RouteRule): Family | undefined {
        const match = rule.if;
        if (match?.family) return match.family;

        if (match?.prefix) return Address.family(Address.host(match.prefix));

        const set = match?.prefix_set ? this.device.routing?.prefix_sets?.[match.prefix_set] : undefined;
        if (set && "source" in set) return set.source.family;

        const first = set && JunosBgp.prefixesOf(set)[0];
        if (first) return Address.family(Address.host(first));

        return undefined;
    }

    /** A policy's rules with each call replaced by the rules it calls, in order. A called policy that decides nothing hands back to the caller, as it does on every platform. */
    private flatten(policy: string, label: string, seen: string[]): { label: string; rule: RouteRule }[] {
        const rules = this.device.routing?.policies?.[policy] ?? [];
        const flat: { label: string; rule: RouteRule }[] = [];

        rules.forEach((rule, index) => {
            const here = label ? `${label}.${index + 1}` : `${index + 1}`;

            if ("call" in rule && rule.call && !seen.includes(rule.call)) flat.push(...this.flatten(rule.call, here, [...seen, rule.call]));

            // A communities rule is not written here. `unsupported()` names it.
            if (JunosBgp.isRouteRule(rule) && (rule.if || rule.set || rule.then)) flat.push({ label: here, rule });
        });

        return flat;
    }

    /** One policy as a policy statement: a term per rule, then a reject when the last rule does not decide on every route. */
    private policyStatement(policy: string): void {
        const statement = `policy-options policy-statement ${policy}`;
        const flat = this.flatten(policy, "", [policy]);

        for (const { label, rule } of flat) {
            const family = this.familyOfRule(rule);
            // A next hop fits routes of its own family only, and one term cannot filter prefixes of both. So a rule for both families splits into a term for each.
            const split = !family && (rule.set?.next_hop || rule.if?.prefix_length) ? (["ipv4", "ipv6"] as const) : [family];

            for (const part of split) {
                const name =
                    split.length > 1
                        ? JunosBgp.termName(`${label}-${part === "ipv4" ? "v4" : "v6"}`, rule)
                        : JunosBgp.termName(label, rule);
                this.term(`${statement} term ${name}`, rule, part, split.length > 1);
            }
        }

        const last = flat.at(-1)?.rule;
        const decides = last !== undefined && !last.if && last.then !== undefined;
        if (!decides) this.out.set(statement, "term circuit-default then reject");
    }

    private term(term: string, rule: RouteRule, family: Family | undefined, splitFamily: boolean): void {
        const match = rule.if ?? {};
        const set = rule.set ?? {};
        const from: (string | number)[][] = [];
        const then: (string | number)[][] = [];

        if (match.family || splitFamily) from.push(["family", JunosBgp.FAMILY[(match.family ?? family)!]]);
        if (match.prefix) from.push(["route-filter", match.prefix, "exact"]);
        if (match.prefix_set) from.push(["prefix-list-filter", match.prefix_set, "orlonger"]);

        if (match.prefix_length) {
            const families = family ? [family] : (["ipv4", "ipv6"] as const);

            for (const each of families) {
                const longest = each === "ipv4" ? 32 : 128;
                const range = `/${match.prefix_length.min ?? 0}-/${match.prefix_length.max ?? longest}`;
                from.push(["route-filter", each === "ipv4" ? "0.0.0.0/0" : "::/0", "prefix-length-range", range]);
            }
        }

        if (match.as_path_length) {
            const { min = 0, max } = match.as_path_length;
            const name = `circuit-path-length-${min}-${max ?? "any"}`;
            this.out.set(`policy-options as-path ${name}`, JunosStatements.quote(`.{${min},${max ?? ""}}`));
            from.push(["as-path", name]);
        }

        for (const field of JunosBgp.AS_FIELDS) {
            const numbers = match[field];
            if (numbers !== undefined) from.push(this.asPathMatch(field, numbers));
        }

        if (match.rpki) from.push(["validation-database", JunosBgp.VALIDATION[match.rpki]]);

        // A term matches any of the communities in its list, and a named community needs all of its members. So each value is a community of its own, and a rule matching both kinds lists each pair of a standard and a large value.
        const standard = [match.standard_community ?? []].flat().map((value) => JunosBgp.member(value, false));
        const large = [match.large_community ?? []].flat().map((value) => JunosBgp.member(value, true));
        const wanted =
            standard.length && large.length
                ? standard.flatMap((one) => large.map((other) => [one, other]))
                : [...standard, ...large].map((one) => [one]);

        for (const members of wanted) from.push(["community", this.community("match", members)]);

        if (set.local_pref !== undefined) then.push(["local-preference", set.local_pref]);
        if (set.med !== undefined) then.push(["metric", set.med]);

        if (set.prepend !== undefined) {
            const asn = this.device.routing!.bgp!.asn!;
            then.push(["as-path-prepend", JunosStatements.quote(Array(set.prepend).fill(asn).join(" "))]);
        }

        // Replacing communities of one kind is removing every one of that kind, then adding the new ones.
        const removed = [
            ...(set.standard_communities ? ["*:*"] : (set.remove_standard_communities ?? [])).map((pattern) =>
                JunosBgp.member(pattern, false)
            ),
            ...(set.large_communities ? ["*:*:*"] : (set.remove_large_communities ?? [])).map((pattern) => JunosBgp.member(pattern, true)),
        ];

        const added = [
            ...(set.standard_communities ?? set.add_standard_communities ?? []).map((value) => JunosBgp.member(value, false)),
            ...(set.large_communities ?? set.add_large_communities ?? []).map((value) => JunosBgp.member(value, true)),
        ];

        if (set.standard_communities && set.add_standard_communities)
            added.push(...set.add_standard_communities.map((value) => JunosBgp.member(value, false)));
        if (set.large_communities && set.add_large_communities)
            added.push(...set.add_large_communities.map((value) => JunosBgp.member(value, true)));

        for (const pattern of removed) then.push(["community delete", this.community("remove", [pattern])]);
        if (added.length) then.push(["community add", this.community("add", added)]);

        if (set.next_hop && (!family || Address.family(set.next_hop) === family)) then.push(["next-hop", set.next_hop]);
        if (set.blackhole) then.push(["next-hop discard"]);
        if (rule.then) then.push([rule.then]);

        for (const words of from) this.out.set(term, "from", ...words);
        for (const words of then) this.out.set(term, "then", ...words);

        if (!from.length && !then.length) this.out.set(term);
    }

    /**
     * The match for one AS field: an AS list, `circuit-as-64501-64512to65534`, under the field's matcher. Several matchers in a term must all match. An AS list refuses AS 0 and AS 4294967295, so ASes that hold one are a regular expression instead, which the device anchors at both ends.
     */
    private asPathMatch(field: (typeof JunosBgp.AS_FIELDS)[number], numbers: AsNumbers): (string | number)[] {
        const ranges = Derive.asRanges(numbers);
        const slug = ranges.map(({ min, max }) => (min === max ? `${min}` : `${min}to${max}`)).join("-");
        const each = ranges.map(({ min, max }) => (min === max ? `${min}` : `${min}-${max}`));

        if (JunosBgp.listable(numbers)) {
            const list = `circuit-as-${slug}`;
            for (const member of each) this.out.set(`policy-options as-list ${list} members`, member);
            return [JunosBgp.AS_LIST_MATCH[field], "as-list", list];
        }

        const { name, before, after } = JunosBgp.AS_REGEX[field];
        const regex = `${before}${each.length === 1 ? each[0] : `(${each.join("|")})`}${after}`;
        this.out.set(`policy-options as-path circuit-${name}-${slug}`, JunosStatements.quote(regex));
        return ["as-path", `circuit-${name}-${slug}`];
    }

    /** Whether an AS list can hold these ASes. */
    static listable(numbers: AsNumbers): boolean {
        return Derive.asRanges(numbers).every(({ min, max }) => min > 0 && max < JunosBgp.MAX_ASN);
    }

    /** A named community holding these members, named after them. */
    private community(purpose: string, members: string[]): string {
        const name = `circuit-${purpose}-${JunosBgp.slug(members.join(" "))}`;
        for (const value of members) this.out.set(`policy-options community ${name} members`, JunosStatements.quote(value));
        return name;
    }
}
