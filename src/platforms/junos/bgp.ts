// BGP, route policies, prefix sets and route origin validation, as Junos `set` statements.

import { familyOf, host } from "../../../core/addr";
import { marker } from "../../../core/secrets";
import type { Device, Family, Neighbor, NeighborSettings, PolicyRule } from "../../../schema";
import { BFD_INTERVAL, quote, type Statements } from "./render";

type AnyRule = PolicyRule<string, string>;
type AnyNeighbor = Neighbor<string, string>;

/** The policy a session uses when it states none, so that it learns or announces nothing. */
export const REJECT_ALL = "circuit-reject-all";

/** The policy every export starts with. BGP's own routes and the prefixes the device originates go on to the session's policy; the device's other routes never reach it. */
const ORIGIN = "circuit-bgp-origin";

/** The validator group every RPKI server joins. */
const RPKI_GROUP = "circuit";

/** A comment in the render naming a path whose statements `refresh` fills, so the plan keeps what the device holds there. */
export const GENERATED = "# generated ";

const FAMILY = { ipv4: "inet", ipv6: "inet6" } as const;

const VALIDATION = { valid: "valid", invalid: "invalid", "not-found": "unknown" } as const;

/** A neighbor's settings with its group's beneath them. */
export function settingsOf(device: Device, neighbor: AnyNeighbor): NeighborSettings<string> {
    const group = neighbor.group ? device.routing?.bgp?.groups?.[neighbor.group] : undefined;
    return { ...group, ...neighbor };
}

/** A name made of a value's words, for a community or a path-length list: `64500:*` becomes `64500-any`. */
const slug = (value: string) => value.replace(/\*/g, "any").replace(/[^A-Za-z0-9]+/g, "-");

/** A community as the platform writes a member: a large community carries the `large:` prefix. */
const member = (community: string, large: boolean) => (large ? `large:${community}` : community);

export function renderBgp(out: Statements, device: Device): void {
    prefixSets(out, device);
    rpki(out, device);

    const bgp = device.routing?.bgp;
    if (!bgp) return;

    out.set("routing-options autonomous-system", bgp.asn);

    const used = new Set<string>();
    let rejectAll = false;
    let exports = false;

    // One group per session: a group holds one type, internal or external, and the config's groups are only shared settings.
    for (const [name, neighbor] of Object.entries(bgp.neighbors ?? {})) {
        const settings = settingsOf(device, neighbor);
        const group = `protocols bgp group ${name}`;

        out.set(group, "type", settings.remote_as === bgp.asn ? "internal" : "external");
        out.set(group, "peer-as", settings.remote_as!);
        if (settings.description) out.set(group, "description", quote(settings.description));
        if (settings.local_address) out.set(group, "local-address", settings.local_address);
        if (settings.multihop) out.set(group, "multihop");
        if (settings.passive) out.set(group, "passive");
        if (settings.hold_time !== undefined) out.set(group, "hold-time", settings.hold_time);
        if (settings.password) out.set(group, "authentication-key", marker(settings.password));
        if (settings.bfd) out.set(group, "bfd-liveness-detection minimum-interval", BFD_INTERVAL);

        out.set(group, "import", settings.import ?? REJECT_ALL);

        if (settings.export) {
            exports = true;
            out.set(group, "export", ORIGIN);
            out.set(group, "export", settings.export);
        } else out.set(group, "export", REJECT_ALL);

        for (const policy of [settings.import, settings.export]) {
            if (policy) used.add(policy);
            else rejectAll = true;
        }

        for (const family of settings.families ?? [familyOf(neighbor.address)]) {
            const nlri = `${group} family ${FAMILY[family]} unicast`;
            out.set(nlri);

            // A session over its limit stays down until it is cleared by hand.
            if (settings.max_prefixes !== undefined) {
                out.set(nlri, "prefix-limit maximum", settings.max_prefixes);
                out.set(nlri, "prefix-limit teardown idle-timeout forever");
            }
        }

        out.set(group, "neighbor", neighbor.address);
    }

    if (rejectAll) out.set(`policy-options policy-statement ${REJECT_ALL} then reject`);

    if (exports) origin(out, device);

    for (const policy of [...used].sort()) policyStatement(out, device, policy);
}

/** BGP's routes and the originated prefixes go on to the session's policy; anything else is rejected. */
function origin(out: Statements, device: Device): void {
    const statement = `policy-options policy-statement ${ORIGIN}`;
    out.set(statement, "term bgp from protocol bgp");
    out.set(statement, "term bgp then next policy");

    const networks = device.routing?.bgp?.networks ?? [];
    for (const prefix of networks) out.set(statement, "term networks from route-filter", prefix, "exact");
    if (networks.length) out.set(statement, "term networks then next policy");

    out.set(statement, "term others then reject");
}

function prefixSets(out: Statements, device: Device): void {
    for (const [name, set] of Object.entries(device.prefix_sets ?? {})) {
        const list = `policy-options prefix-list ${name}`;

        if ("prefixes" in set && set.prefixes.length) for (const prefix of set.prefixes) out.set(list, prefix);
        else out.set(list);

        if ("source" in set) out.note(`${GENERATED}${list}`);
    }
}

function rpki(out: Statements, device: Device): void {
    for (const server of device.routing?.rpki ?? []) {
        out.set(`routing-options validation group ${RPKI_GROUP} session`, server.address, "port", server.port);
    }
}

/** The family a rule is limited to, by its match: a family, a prefix, or a prefix set of one family. */
function familyOfRule(device: Device, rule: AnyRule): Family | undefined {
    const match = rule.match;
    if (match?.family) return match.family;

    if (match?.prefix) return familyOf(host(match.prefix));

    const set = match?.prefix_set ? device.prefix_sets?.[match.prefix_set] : undefined;
    if (set && "source" in set) return set.source.family;

    if (set?.prefixes[0]) return familyOf(host(set.prefixes[0]));

    return undefined;
}

/** A policy's rules with each call replaced by the rules it calls, in order. A called policy that decides nothing hands back to the caller, as it does on every platform. */
function flatten(device: Device, policy: string, label: string, seen: string[]): { label: string; rule: AnyRule }[] {
    const rules = device.policies?.[policy] ?? [];
    const flat: { label: string; rule: AnyRule }[] = [];

    rules.forEach((rule, index) => {
        const here = label ? `${label}.${index + 1}` : `${index + 1}`;

        if (rule.call && !seen.includes(rule.call)) flat.push(...flatten(device, rule.call, here, [...seen, rule.call]));

        if (rule.match || rule.set || rule.action) flat.push({ label: here, rule });
    });

    return flat;
}

/** A term's name: its place, then the rule's description so a reader sees it on the device. */
const termName = (label: string, rule: AnyRule) => quote(rule.description ? `${label} ${rule.description}` : label);

/** One policy as a policy statement: a term per rule, then a reject when the last rule does not decide on every route. */
function policyStatement(out: Statements, device: Device, policy: string): void {
    const statement = `policy-options policy-statement ${policy}`;
    const flat = flatten(device, policy, "", [policy]);

    for (const { label, rule } of flat) {
        const family = familyOfRule(device, rule);
        // A next hop only means something to routes of its own family, and one term cannot filter prefixes of both, so a rule for both families splits into a term for each.
        const split = !family && (rule.set?.next_hop || rule.match?.prefix_length) ? (["ipv4", "ipv6"] as const) : [family];

        for (const part of split) {
            const name = split.length > 1 ? termName(`${label}-${part === "ipv4" ? "v4" : "v6"}`, rule) : termName(label, rule);
            term(out, device, `${statement} term ${name}`, rule, part, split.length > 1);
        }
    }

    const last = flat.at(-1)?.rule;
    const decides = last !== undefined && !last.match && last.action !== undefined;
    if (!decides) out.set(statement, "term circuit-default then reject");
}

function term(out: Statements, device: Device, term: string, rule: AnyRule, family: Family | undefined, splitFamily: boolean): void {
    const match = rule.match ?? {};
    const set = rule.set ?? {};
    const from: (string | number)[][] = [];
    const then: (string | number)[][] = [];

    if (match.family || splitFamily) from.push(["family", FAMILY[(match.family ?? family)!]]);
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
        out.set(`policy-options as-path ${name}`, quote(`.{${min},${max ?? ""}}`));
        from.push(["as-path", name]);
    }

    if (match.through_as !== undefined) {
        const name = `circuit-through-${match.through_as}`;
        out.set(`policy-options as-path ${name}`, quote(`.* ${match.through_as} .*`));
        from.push(["as-path", name]);
    }

    if (match.rpki) from.push(["validation-database", VALIDATION[match.rpki]]);

    // Members of one named community must all be present, so a rule matching both kinds names them together.
    const wanted = [
        ...(match.community ? [member(match.community, false)] : []),
        ...(match.large_community ? [member(match.large_community, true)] : []),
    ];

    if (wanted.length) from.push(["community", community(out, "match", wanted)]);

    if (set.local_pref !== undefined) then.push(["local-preference", set.local_pref]);
    if (set.med !== undefined) then.push(["metric", set.med]);

    if (set.prepend !== undefined) {
        const asn = device.routing!.bgp!.asn;
        then.push(["as-path-prepend", quote(Array(set.prepend).fill(asn).join(" "))]);
    }

    // Replacing communities of one kind is removing every one of that kind, then adding the new ones.
    const removed = [
        ...(set.communities ? ["*:*"] : (set.remove_communities ?? [])).map((pattern) => member(pattern, false)),
        ...(set.large_communities ? ["*:*:*"] : (set.remove_large_communities ?? [])).map((pattern) => member(pattern, true)),
    ];

    const added = [
        ...(set.communities ?? set.add_communities ?? []).map((value) => member(value, false)),
        ...(set.large_communities ?? set.add_large_communities ?? []).map((value) => member(value, true)),
    ];

    if (set.communities && set.add_communities) added.push(...set.add_communities.map((value) => member(value, false)));
    if (set.large_communities && set.add_large_communities) added.push(...set.add_large_communities.map((value) => member(value, true)));

    for (const pattern of removed) then.push(["community delete", community(out, "remove", [pattern])]);
    if (added.length) then.push(["community add", community(out, "add", added)]);

    if (set.next_hop && (!family || familyOf(set.next_hop) === family)) then.push(["next-hop", set.next_hop]);
    if (set.blackhole) then.push(["next-hop discard"]);
    if (rule.action) then.push([rule.action]);

    for (const words of from) out.set(term, "from", ...words);
    for (const words of then) out.set(term, "then", ...words);

    if (!from.length && !then.length) out.set(term);
}

/** A named community holding these members, named after them. */
function community(out: Statements, purpose: string, members: string[]): string {
    const name = `circuit-${purpose}-${slug(members.join(" "))}`;
    for (const value of members) out.set(`policy-options community ${name} members`, quote(value));
    return name;
}
