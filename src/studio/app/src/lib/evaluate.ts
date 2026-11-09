// Studio's two tests: which firewall rule a packet meets, and what a route policy does to a route. They read each rule as Circuit's docs describe it, in the model Studio receives (a list in a match is one rule per value there). A device can still behave otherwise, so they say what the project means, not what a device did.

import type { Device, Family, FilterMatch, FilterRule, PolicyRule, Ports, Protocol, RouteRule, RouteSet } from "../../../../model";
import type { StudioData } from "../../../types";
import { Net } from "./net";

/** Whether a rule's conditions hold: yes, no, or not known from what was given. */
export type Answer = "yes" | "no" | "unknown";

/** An answer, with why a rule does not match, or what it needs to know. */
export type Check = { answer: Answer; why: string[] };

export type ConnectionState = NonNullable<FilterMatch["connection_state"]>[number];
export type TcpFlag = NonNullable<NonNullable<FilterMatch["tcp_flags"]>["set"]>[number];

/** A packet as a person describes it. A field left out is not known. */
export type Packet = {
    family?: Family;
    protocol?: Protocol;
    src?: string;
    dst?: string;
    srcPort?: number;
    dstPort?: number;
    inInterface?: string;
    outInterface?: string;
    state?: ConnectionState;
    /** How its connection was translated. */
    nat?: "none" | "srcnat" | "dstnat" | "both";
    /** The TCP flags set. None ticked is not known. */
    flags?: TcpFlag[];
};

export type FirewallStep = { rule: number; written: FilterRule; check: Check };

export type FirewallResult = {
    steps: FirewallStep[];
    /** Undefined when a rule needs something not given. */
    verdict?: "accept" | "drop" | "reject";
    /** What decided, or where it stopped. */
    by: string;
    /** What the rule it stopped on needs. */
    needs: string[];
};

/** A route as a person describes it. */
export type Route = {
    prefix: string;
    /** Each AS in its path, prepends included, as the route arrives. Not known when absent. */
    asPath?: number[];
    rpki?: "valid" | "invalid" | "not-found";
    communities: string[];
    largeCommunities: string[];
    /** The prefix sets from a registry the route is in: Studio doesn't fetch them, so the person ticks them. */
    inRegistrySets: string[];
};

/** What the policy changed on the route so far. */
export type Attributes = {
    localPref?: number;
    med?: number;
    prepend: number;
    communities: string[];
    largeCommunities: string[];
    nextHop?: string;
    preferredSource?: string;
    blackhole?: true;
};

export type PolicyStep = {
    policy: string;
    rule: number;
    /** How many calls deep: 0 in the policy tested. */
    depth: number;
    written: PolicyRule;
    /** For a rule on routes; a call has none. */
    check?: Check;
    changed: string[];
    decision?: "accept" | "reject";
    note?: string;
};

export type PolicyResult = {
    steps: PolicyStep[];
    /** Undefined when a rule needs something not given. */
    decision?: "accept" | "reject";
    by: string;
    needs: string[];
    attributes: Attributes;
};

export class Evaluate {
    /** Every condition must hold. One that does not decides; otherwise one not known leaves the whole not known. */
    private static all(checks: Check[]): Check {
        const no = checks.filter((check) => check.answer === "no");
        if (no.length) return { answer: "no", why: no.flatMap((check) => check.why) };

        const unknown = checks.filter((check) => check.answer === "unknown");
        if (unknown.length) return { answer: "unknown", why: unknown.flatMap((check) => check.why) };

        return { answer: "yes", why: [] };
    }

    private static test(holds: boolean, why: string): Check {
        return { answer: holds ? "yes" : "no", why: holds ? [] : [why] };
    }

    private static needs(what: string): Check {
        return { answer: "unknown", why: [what] };
    }

    private static list<T>(value: T | readonly T[] | undefined): T[] {
        return value === undefined ? [] : Array.isArray(value) ? [...(value as readonly T[])] : [value as T];
    }

    private static familyOf(text: string): Family | undefined {
        return Net.parseRange(text)?.family;
    }

    private static portIn(ports: Ports, port: number): boolean {
        return Evaluate.list(ports).some((entry) => (typeof entry === "number" ? entry === port : entry.min <= port && port <= entry.max));
    }

    private static portsText(ports: Ports): string {
        return Evaluate.list(ports)
            .map((entry) => (typeof entry === "number" ? String(entry) : `${entry.min}-${entry.max}`))
            .join(", ");
    }

    /** Whether a packet meets a rule's `if`, each condition as its doc in src/config/firewall.ts describes it. */
    private static packetMeets(match: FilterMatch, packet: Packet, device: Device): Check {
        const checks: Check[] = [];
        const addressSets = (device.firewall?.address_sets ?? {}) as Record<string, readonly string[] | undefined>;
        const interfaceSets = (device.firewall?.interface_sets ?? {}) as Record<string, readonly string[] | undefined>;
        const family = packet.family ?? Evaluate.familyOf(packet.src ?? "") ?? Evaluate.familyOf(packet.dst ?? "");

        if (match.family)
            checks.push(family ? Evaluate.test(match.family === family, `it is for ${match.family} only`) : Evaluate.needs("the family"));

        // A rule with addresses of one family applies to that family only.
        const ruleAddresses = [
            ...Evaluate.list(match.src),
            ...Evaluate.list(match.dst),
            ...[match.src_address_set, match.dst_address_set].flatMap((name) => (name ? (addressSets[name] ?? []) : [])),
        ];
        const ruleFamilies = new Set(ruleAddresses.map(Evaluate.familyOf).filter(Boolean));
        if (family && ruleFamilies.size === 1 && !ruleFamilies.has(family))
            checks.push(Evaluate.test(false, `its addresses are ${[...ruleFamilies][0]}`));

        if (match.protocol)
            checks.push(
                packet.protocol
                    ? Evaluate.test(match.protocol === packet.protocol, `it is for ${match.protocol}`)
                    : Evaluate.needs("the protocol")
            );

        const address = (rule: string | readonly string[] | undefined, given: string | undefined, side: string) => {
            const prefixes = Evaluate.list(rule);
            if (!prefixes.length) return;
            checks.push(
                given
                    ? Evaluate.test(
                          prefixes.some((prefix) => Net.covers(prefix, given)),
                          `its ${side} is ${prefixes.join(" or ")}`
                      )
                    : Evaluate.needs(`the ${side} address`)
            );
        };
        address(match.src, packet.src, "source");
        address(match.dst, packet.dst, "destination");

        const addressSet = (name: string | undefined, given: string | undefined, side: string) => {
            if (!name) return;
            checks.push(
                given
                    ? Evaluate.test(
                          (addressSets[name] ?? []).some((entry) => Net.covers(entry, given)),
                          `its ${side} is in the address set ${name}`
                      )
                    : Evaluate.needs(`the ${side} address`)
            );
        };
        addressSet(match.src_address_set, packet.src, "source");
        addressSet(match.dst_address_set, packet.dst, "destination");

        const port = (rule: Ports | undefined, given: number | undefined, side: string) => {
            if (rule === undefined) return;
            if (packet.protocol && packet.protocol !== "tcp" && packet.protocol !== "udp")
                return checks.push(Evaluate.test(false, "it names ports, which only TCP and UDP have"));
            checks.push(
                given !== undefined
                    ? Evaluate.test(Evaluate.portIn(rule, given), `its ${side} port is ${Evaluate.portsText(rule)}`)
                    : Evaluate.needs(`the ${side} port`)
            );
        };
        port(match.src_port, packet.srcPort, "source");
        port(match.dst_port, packet.dstPort, "destination");

        const where = (names: string[], given: string | undefined, way: string, need: string) => {
            if (!names.length) return;
            checks.push(
                given ? Evaluate.test(names.includes(given), `it is for packets ${way} ${names.join(" or ")}`) : Evaluate.needs(need)
            );
        };
        where(
            [...Evaluate.list(match.in_interface), ...(match.in_interface_set ? (interfaceSets[match.in_interface_set] ?? []) : [])],
            packet.inInterface,
            "arriving on",
            "the interface it arrives on"
        );
        where(
            [...Evaluate.list(match.out_interface), ...(match.out_interface_set ? (interfaceSets[match.out_interface_set] ?? []) : [])],
            packet.outInterface,
            "leaving through",
            "the interface it leaves through"
        );

        if (match.connection_state)
            checks.push(
                packet.state
                    ? Evaluate.test(
                          match.connection_state.includes(packet.state),
                          `it is for ${match.connection_state.join(" or ")} packets`
                      )
                    : Evaluate.needs("the connection state")
            );

        if (match.connection_nat_state) {
            const translated: string[] = { none: [], srcnat: ["srcnat"], dstnat: ["dstnat"], both: ["srcnat", "dstnat"] }[
                packet.nat ?? "none"
            ];
            checks.push(
                packet.nat
                    ? Evaluate.test(
                          match.connection_nat_state.some((state) => translated.includes(state)),
                          `it is for connections translated by ${match.connection_nat_state.join(" or ")}`
                      )
                    : Evaluate.needs("how the connection was translated")
            );
        }

        if (match.tcp_flags) {
            const set = match.tcp_flags.set ?? [];
            const unset = match.tcp_flags.unset ?? [];
            if (packet.protocol && packet.protocol !== "tcp") checks.push(Evaluate.test(false, "it names TCP flags"));
            else if (!packet.flags?.length) checks.push(Evaluate.needs("the TCP flags"));
            else {
                const flags = packet.flags;
                const wanted = [set.length ? `${set.join(", ")} set` : "", unset.length ? `${unset.join(", ")} not set` : ""];
                checks.push(
                    Evaluate.test(
                        set.every((flag) => flags.includes(flag)) && unset.every((flag) => !flags.includes(flag)),
                        `it is for TCP flags ${wanted.filter(Boolean).join(" and ")}`
                    )
                );
            }
        }

        return Evaluate.all(checks);
    }

    /** A packet through one of a device's filter chains: each rule in order until one matches, then the chain's `default_action`, accept when it has none. */
    static firewall(device: Device, chain: "input" | "forward" | "output", packet: Packet): FirewallResult {
        const settings = device.firewall?.filter?.[chain];
        const steps: FirewallStep[] = [];

        for (const [index, written] of (settings?.rules ?? []).entries()) {
            const check = Evaluate.packetMeets(written.if ?? {}, packet, device);
            steps.push({ rule: index + 1, written, check });

            if (check.answer === "yes") return { steps, verdict: written.then, by: `rule ${index + 1}`, needs: [] };
            if (check.answer === "unknown") return { steps, by: `rule ${index + 1}`, needs: check.why };
        }

        return settings?.default_action
            ? { steps, verdict: settings.default_action, by: "the chain's default_action", needs: [] }
            : { steps, verdict: "accept", by: "no rule: a chain with no default_action accepts", needs: [] };
    }

    /** Whether a route meets a rule's `if`, each condition as its doc in src/config/routing.ts describes it. */
    private static routeMeets(match: NonNullable<RouteRule["if"]>, route: Route, attributes: Attributes, device: Device): Check {
        const checks: Check[] = [];
        const range = Net.parseRange(route.prefix);
        const length = range?.length ?? 0;

        if (match.family) checks.push(Evaluate.test(match.family === range?.family, `it is for ${match.family} only`));
        if (match.prefix) checks.push(Evaluate.test(Net.samePrefix(match.prefix, route.prefix), `it is for ${match.prefix} exactly`));

        if (match.prefix_set) {
            const set = device.routing?.prefix_sets?.[match.prefix_set];
            if (set && "source" in set)
                checks.push(
                    Evaluate.test(
                        route.inRegistrySets.includes(match.prefix_set),
                        `the route is not in ${match.prefix_set}, from ${set.source.registry} (not ticked)`
                    )
                );
            else {
                // A set contains a route whose prefix is one of its own, or inside one.
                const prefixes = set ? (Array.isArray(set.prefixes) ? set.prefixes : Object.values(set.prefixes)) : [];
                checks.push(
                    Evaluate.test(
                        prefixes.some((prefix: string) => Net.covers(prefix, route.prefix)),
                        `the route is not in the prefix set ${match.prefix_set}`
                    )
                );
            }
        }

        const { min, max } = match.prefix_length ?? {};
        if (min !== undefined) checks.push(Evaluate.test(length >= min, `it is for /${min} or longer`));
        if (max !== undefined) checks.push(Evaluate.test(length <= max, `it is for /${max} or shorter`));

        if (match.as_path_length) {
            const { min: shortest, max: longest } = match.as_path_length;
            if (!route.asPath) checks.push(Evaluate.needs("the AS path"));
            else {
                const hops = route.asPath.length;
                if (shortest !== undefined) checks.push(Evaluate.test(hops >= shortest, `it is for AS paths of ${shortest} or more`));
                if (longest !== undefined) checks.push(Evaluate.test(hops <= longest, `it is for AS paths of ${longest} or fewer`));
            }
        }

        if (match.as_path_contains !== undefined)
            checks.push(
                route.asPath
                    ? Evaluate.test(route.asPath.includes(match.as_path_contains), `the AS path has no AS${match.as_path_contains}`)
                    : Evaluate.needs("the AS path")
            );

        if (match.rpki)
            checks.push(
                route.rpki
                    ? Evaluate.test(match.rpki === route.rpki, `it is for routes RPKI finds ${match.rpki}`)
                    : Evaluate.needs("the RPKI state")
            );

        // Communities as the rules before this one left them.
        if (match.standard_community)
            checks.push(
                Evaluate.test(attributes.communities.includes(match.standard_community), `the route has no ${match.standard_community}`)
            );
        if (match.large_community)
            checks.push(
                Evaluate.test(attributes.largeCommunities.includes(match.large_community), `the route has no ${match.large_community}`)
            );

        return Evaluate.all(checks);
    }

    /** Whether a community fits a pattern in which `*` stands for any value of a part. */
    private static fits(pattern: string, community: string): boolean {
        const want = pattern.split(":");
        const have = community.split(":");
        return want.length === have.length && want.every((part, index) => part === "*" || part === have[index]);
    }

    /** Apply a rule's `set` to what the route carries, and say what changed. */
    private static apply(set: RouteSet, attributes: Attributes): string[] {
        const changed: string[] = [];

        if (set.local_pref !== undefined) changed.push(`local_pref ${(attributes.localPref = set.local_pref)}`);
        if (set.med !== undefined) changed.push(`med ${(attributes.med = set.med)}`);
        if (set.prepend) {
            attributes.prepend += set.prepend;
            changed.push(`prepend our AS ${set.prepend} ${set.prepend === 1 ? "time" : "times"} (${attributes.prepend} in all)`);
        }

        const communities = (
            key: "communities" | "largeCommunities",
            replace: readonly string[] | undefined,
            add: readonly string[] | undefined,
            remove: readonly string[] | undefined,
            name: string
        ) => {
            if (replace) changed.push(`${name} replaced by ${(attributes[key] = [...replace]).join(", ") || "none"}`);
            if (remove?.length) {
                const removed = attributes[key].filter((community) => remove.some((pattern) => Evaluate.fits(pattern, community)));
                attributes[key] = attributes[key].filter((community) => !removed.includes(community));
                changed.push(`${name} removed by ${remove.join(", ")}: ${removed.join(", ") || "none carried"}`);
            }
            if (add?.length) {
                attributes[key] = [...new Set([...attributes[key], ...add])];
                changed.push(`${name} added: ${add.join(", ")}`);
            }
        };
        communities("communities", set.standard_communities, set.add_standard_communities, set.remove_standard_communities, "communities");
        communities(
            "largeCommunities",
            set.large_communities,
            set.add_large_communities,
            set.remove_large_communities,
            "large communities"
        );

        if (set.next_hop) changed.push(`next_hop ${(attributes.nextHop = set.next_hop)}`);
        if (set.preferred_source) changed.push(`preferred_source ${(attributes.preferredSource = set.preferred_source)}`);
        if (set.blackhole) {
            attributes.blackhole = true;
            changed.push("blackhole: traffic to it is dropped here");
        }

        return changed;
    }

    /**
     * A route through one of a device's route policies, rule by rule: a call runs the policy it names, and a route that policy accepts
     * or rejects stops there; any other goes on, with what it set. A rule on routes checks its `if`, then applies `set`, then `then`
     * decides. A route no rule accepts is rejected.
     */
    static policy(device: Device, policy: string, route: Route): PolicyResult {
        const policies = (device.routing?.policies ?? {}) as Record<string, readonly PolicyRule[] | undefined>;
        const steps: PolicyStep[] = [];
        const attributes: Attributes = { prepend: 0, communities: [...route.communities], largeCommunities: [...route.largeCommunities] };
        let needs: string[] = [];

        type Outcome = { decision: "accept" | "reject" | "unknown"; by: string } | undefined;

        const run = (name: string, running: string[]): Outcome => {
            for (const [index, written] of (policies[name] ?? []).entries()) {
                const step = { policy: name, rule: index + 1, depth: running.length - 1, written };
                const by = `rule ${index + 1} of ${name}`;

                if ("call" in written && written.call !== undefined) {
                    const called = written.call;
                    // A policy that calls itself, at any depth, is not followed again, as Circuit reads it.
                    if (running.includes(called)) {
                        steps.push({ ...step, changed: [], note: `${called} is running already: not followed again` });
                        continue;
                    }
                    if (!policies[called]) {
                        steps.push({ ...step, changed: [], note: `no policy ${called} on the device` });
                        continue;
                    }
                    steps.push({ ...step, changed: [], note: `runs ${called}` });
                    const outcome = run(called, [...running, called]);
                    if (outcome) return outcome;
                    continue;
                }

                const rule = written as RouteRule;
                const check = Evaluate.routeMeets(rule.if ?? {}, route, attributes, device);

                if (check.answer === "unknown") {
                    steps.push({ ...step, check, changed: [] });
                    needs = check.why;
                    return { decision: "unknown", by };
                }
                if (check.answer === "no") {
                    steps.push({ ...step, check, changed: [] });
                    continue;
                }

                const changed = Evaluate.apply(rule.set ?? {}, attributes);
                steps.push({ ...step, check, changed, ...(rule.then ? { decision: rule.then } : {}) });
                if (rule.then) return { decision: rule.then, by };
            }

            return undefined;
        };

        const outcome = run(policy, [policy]);
        if (!outcome)
            return { steps, decision: "reject", by: "no rule accepted it: a route no rule accepts is rejected", needs, attributes };
        if (outcome.decision === "unknown") return { steps, by: outcome.by, needs, attributes };
        return { steps, decision: outcome.decision, by: outcome.by, needs, attributes };
    }

    /** The policies of a device, each with the BGP sessions that use it: the ones sessions use first, then the rest. */
    static policiesOf(data: StudioData, device: Device): { policy: string; users: string[] }[] {
        const sessions = data.sessions.filter((session) => session.device === device.name);

        return Object.keys(device.routing?.policies ?? {})
            .map((policy) => ({
                policy,
                users: sessions.flatMap((session) => [
                    ...(session.import === policy ? [`import of ${session.name}`] : []),
                    ...(session.export === policy ? [`export of ${session.name}`] : []),
                ]),
            }))
            .sort((a, b) => Number(!a.users.length) - Number(!b.users.length));
    }
}
