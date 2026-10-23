// BGP, route policies, prefix sets and route origin validation, as Junos `set` statements.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Family, Neighbor, NeighborSettings, PolicyRule } from "../../schema";
import { JunosRender, type JunosStatements } from "./render";

type AnyRule = PolicyRule<string, string>;
type AnyNeighbor = Neighbor<string, string>;

/** BGP sessions, the policies they use, prefix sets and RPKI servers, added to one device's statements. */
export class JunosBgp {
    /** The policy a session uses when it states none, so that it learns or announces nothing. */
    private static readonly REJECT_ALL = "circuit-reject-all";

    /** The policy every export starts with. BGP's own routes and the prefixes the device originates go on to the session's policy; the device's other routes never reach it. */
    private static readonly ORIGIN = "circuit-bgp-origin";

    /** The validator group every RPKI server joins. */
    private static readonly RPKI_GROUP = "circuit";

    /** A comment in the render naming a path whose statements `refresh` fills, so the plan keeps what the device holds there. */
    static readonly GENERATED = "# generated ";

    private static readonly FAMILY = { ipv4: "inet", ipv6: "inet6" } as const;

    private static readonly VALIDATION = { valid: "valid", invalid: "invalid", "not-found": "unknown" } as const;

    private constructor(
        private readonly out: JunosStatements,
        private readonly device: Device
    ) {}

    /** Add the device's prefix sets, RPKI servers, BGP sessions and the policies they use. */
    static render(out: JunosStatements, device: Device): void {
        const bgp = new JunosBgp(out, device);

        bgp.prefixSets();
        bgp.rpki();
        bgp.sessions();
    }

    /** A neighbor's settings with its group's beneath them. */
    static settingsOf(device: Device, neighbor: AnyNeighbor): NeighborSettings<string> {
        const group = neighbor.group ? device.routing?.bgp?.groups?.[neighbor.group] : undefined;
        return { ...group, ...neighbor };
    }

    /** A name made of a value's words, for a community or a path-length list: `64500:*` becomes `64500-any`. */
    private static slug(value: string): string {
        return value.replace(/\*/g, "any").replace(/[^A-Za-z0-9]+/g, "-");
    }

    /** A community as the platform writes a member: a large community carries the `large:` prefix. */
    private static member(community: string, large: boolean): string {
        return large ? `large:${community}` : community;
    }

    /** A term's name: its place, then the rule's description so a reader sees it on the device. */
    private static termName(label: string, rule: AnyRule): string {
        return JunosRender.quote(rule.description ? `${label} ${rule.description}` : label);
    }

    private sessions(): void {
        const bgp = this.device.routing?.bgp;
        if (!bgp) return;

        this.out.set("routing-options autonomous-system", bgp.asn);

        const used = new Set<string>();
        let rejectAll = false;
        let exports = false;

        // One group per session: a group holds one type, internal or external, and the config's groups are only shared settings.
        for (const [name, neighbor] of Object.entries(bgp.neighbors ?? {})) {
            const settings = JunosBgp.settingsOf(this.device, neighbor);
            const group = `protocols bgp group ${name}`;

            this.out.set(group, "type", settings.remote_as === bgp.asn ? "internal" : "external");
            this.out.set(group, "peer-as", settings.remote_as!);
            if (settings.description) this.out.set(group, "description", JunosRender.quote(settings.description));
            if (settings.local_address) this.out.set(group, "local-address", settings.local_address);
            if (settings.multihop) this.out.set(group, "multihop");
            if (settings.passive) this.out.set(group, "passive");
            if (settings.hold_time !== undefined) this.out.set(group, "hold-time", settings.hold_time);
            if (settings.password) this.out.set(group, "authentication-key", Secrets.marker(settings.password));
            if (settings.bfd) JunosRender.bfd(this.out, group, this.device);

            this.out.set(group, "import", settings.import ?? JunosBgp.REJECT_ALL);

            if (settings.export) {
                exports = true;
                this.out.set(group, "export", JunosBgp.ORIGIN);
                this.out.set(group, "export", settings.export);
            } else this.out.set(group, "export", JunosBgp.REJECT_ALL);

            for (const policy of [settings.import, settings.export]) {
                if (policy) used.add(policy);
                else rejectAll = true;
            }

            for (const family of settings.families ?? [Address.family(neighbor.address)]) {
                const nlri = `${group} family ${JunosBgp.FAMILY[family]} unicast`;
                this.out.set(nlri);

                // A session over its limit stays down until it is cleared by hand.
                if (settings.max_prefixes !== undefined) {
                    this.out.set(nlri, "prefix-limit maximum", settings.max_prefixes);
                    this.out.set(nlri, "prefix-limit teardown idle-timeout forever");
                }
            }

            this.out.set(group, "neighbor", neighbor.address);
        }

        if (rejectAll) this.out.set(`policy-options policy-statement ${JunosBgp.REJECT_ALL} then reject`);

        if (exports) this.origin();

        for (const policy of [...used].sort()) this.policyStatement(policy);
    }

    /** BGP's routes and the originated prefixes go on to the session's policy; anything else is rejected. */
    private origin(): void {
        const statement = `policy-options policy-statement ${JunosBgp.ORIGIN}`;
        this.out.set(statement, "term bgp from protocol bgp");
        this.out.set(statement, "term bgp then next policy");

        const networks = this.device.routing?.bgp?.networks ?? [];
        for (const prefix of networks) this.out.set(statement, "term networks from route-filter", prefix, "exact");
        if (networks.length) this.out.set(statement, "term networks then next policy");

        this.out.set(statement, "term others then reject");
    }

    private prefixSets(): void {
        for (const [name, set] of Object.entries(this.device.prefix_sets ?? {})) {
            const list = `policy-options prefix-list ${name}`;

            if ("prefixes" in set && set.prefixes.length) for (const prefix of set.prefixes) this.out.set(list, prefix);
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
    private familyOfRule(rule: AnyRule): Family | undefined {
        const match = rule.match;
        if (match?.family) return match.family;

        if (match?.prefix) return Address.family(Address.host(match.prefix));

        const set = match?.prefix_set ? this.device.prefix_sets?.[match.prefix_set] : undefined;
        if (set && "source" in set) return set.source.family;

        if (set?.prefixes[0]) return Address.family(Address.host(set.prefixes[0]));

        return undefined;
    }

    /** A policy's rules with each call replaced by the rules it calls, in order. A called policy that decides nothing hands back to the caller, as it does on every platform. */
    private flatten(policy: string, label: string, seen: string[]): { label: string; rule: AnyRule }[] {
        const rules = this.device.policies?.[policy] ?? [];
        const flat: { label: string; rule: AnyRule }[] = [];

        rules.forEach((rule, index) => {
            const here = label ? `${label}.${index + 1}` : `${index + 1}`;

            if (rule.call && !seen.includes(rule.call)) flat.push(...this.flatten(rule.call, here, [...seen, rule.call]));

            if (rule.match || rule.set || rule.action) flat.push({ label: here, rule });
        });

        return flat;
    }

    /** One policy as a policy statement: a term per rule, then a reject when the last rule does not decide on every route. */
    private policyStatement(policy: string): void {
        const statement = `policy-options policy-statement ${policy}`;
        const flat = this.flatten(policy, "", [policy]);

        for (const { label, rule } of flat) {
            const family = this.familyOfRule(rule);
            // A next hop only means something to routes of its own family, and one term cannot filter prefixes of both, so a rule for both families splits into a term for each.
            const split = !family && (rule.set?.next_hop || rule.match?.prefix_length) ? (["ipv4", "ipv6"] as const) : [family];

            for (const part of split) {
                const name =
                    split.length > 1
                        ? JunosBgp.termName(`${label}-${part === "ipv4" ? "v4" : "v6"}`, rule)
                        : JunosBgp.termName(label, rule);
                this.term(`${statement} term ${name}`, rule, part, split.length > 1);
            }
        }

        const last = flat.at(-1)?.rule;
        const decides = last !== undefined && !last.match && last.action !== undefined;
        if (!decides) this.out.set(statement, "term circuit-default then reject");
    }

    private term(term: string, rule: AnyRule, family: Family | undefined, splitFamily: boolean): void {
        const match = rule.match ?? {};
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
            this.out.set(`policy-options as-path ${name}`, JunosRender.quote(`.{${min},${max ?? ""}}`));
            from.push(["as-path", name]);
        }

        if (match.through_as !== undefined) {
            const name = `circuit-through-${match.through_as}`;
            this.out.set(`policy-options as-path ${name}`, JunosRender.quote(`.* ${match.through_as} .*`));
            from.push(["as-path", name]);
        }

        if (match.rpki) from.push(["validation-database", JunosBgp.VALIDATION[match.rpki]]);

        // Members of one named community must all be present, so a rule matching both kinds names them together.
        const wanted = [
            ...(match.community ? [JunosBgp.member(match.community, false)] : []),
            ...(match.large_community ? [JunosBgp.member(match.large_community, true)] : []),
        ];

        if (wanted.length) from.push(["community", this.community("match", wanted)]);

        if (set.local_pref !== undefined) then.push(["local-preference", set.local_pref]);
        if (set.med !== undefined) then.push(["metric", set.med]);

        if (set.prepend !== undefined) {
            const asn = this.device.routing!.bgp!.asn;
            then.push(["as-path-prepend", JunosRender.quote(Array(set.prepend).fill(asn).join(" "))]);
        }

        // Replacing communities of one kind is removing every one of that kind, then adding the new ones.
        const removed = [
            ...(set.communities ? ["*:*"] : (set.remove_communities ?? [])).map((pattern) => JunosBgp.member(pattern, false)),
            ...(set.large_communities ? ["*:*:*"] : (set.remove_large_communities ?? [])).map((pattern) => JunosBgp.member(pattern, true)),
        ];

        const added = [
            ...(set.communities ?? set.add_communities ?? []).map((value) => JunosBgp.member(value, false)),
            ...(set.large_communities ?? set.add_large_communities ?? []).map((value) => JunosBgp.member(value, true)),
        ];

        if (set.communities && set.add_communities) added.push(...set.add_communities.map((value) => JunosBgp.member(value, false)));
        if (set.large_communities && set.add_large_communities)
            added.push(...set.add_large_communities.map((value) => JunosBgp.member(value, true)));

        for (const pattern of removed) then.push(["community delete", this.community("remove", [pattern])]);
        if (added.length) then.push(["community add", this.community("add", added)]);

        if (set.next_hop && (!family || Address.family(set.next_hop) === family)) then.push(["next-hop", set.next_hop]);
        if (set.blackhole) then.push(["next-hop discard"]);
        if (rule.action) then.push([rule.action]);

        for (const words of from) this.out.set(term, "from", ...words);
        for (const words of then) this.out.set(term, "then", ...words);

        if (!from.length && !then.length) this.out.set(term);
    }

    /** A named community holding these members, named after them. */
    private community(purpose: string, members: string[]): string {
        const name = `circuit-${purpose}-${JunosBgp.slug(members.join(" "))}`;
        for (const value of members) this.out.set(`policy-options community ${name} members`, JunosRender.quote(value));
        return name;
    }
}
