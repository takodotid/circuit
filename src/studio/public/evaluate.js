// @ts-check
// What Studio's tools work out from the config: where an address is and how each device would reach it, the VLAN path between two devices, which firewall rule a packet meets, and what a route policy does to a route.
// They follow the schema's own description of each field, read from the files: a device can still behave otherwise, so they say what the config means, not what the device did.

import { Net } from "./net.js";

/** @typedef {import("../../schema").Device} Device */
/** @typedef {import("../../schema").FilterMatch<string, string>} FilterMatch */
/** @typedef {import("../../schema").FilterRule<string, string>} FilterRule */
/** @typedef {import("../../schema").PolicyRule<string, string>} PolicyRule */
/** @typedef {import("../../schema").Match<string>} RouteMatch */
/** @typedef {import("../../schema").Sets} Sets */
/** @typedef {import("../../schema").Ports} Ports */
/** @typedef {import("../../core/topology").GraphEdge} GraphEdge */
/** @typedef {import("../data").StudioData} StudioData */

/** Whether a condition holds: yes, no, or not known from what was given. @typedef {"yes" | "no" | "unknown"} Answer */
/** @typedef {{ answer: Answer, why: string[] }} Check */
/** @typedef {{ device: string, table: string, kind: "local" | "connected" | "static" | "none", prefix?: string, via?: string, through?: string, note?: string }} RouteFound */
/** @typedef {{ device: string, where: string, rule: number, description?: string, action: string, side: string }} RuleFound */
/** @typedef {{ family?: "ipv4" | "ipv6", protocol?: string, src?: string, dst?: string, srcPort?: number, dstPort?: number, inInterface?: string, outInterface?: string, state?: string, flags?: string[] }} Packet */
/** @typedef {{ prefix: string, asPathLength?: number, rpki?: string, communities: string[], largeCommunities: string[], inRegistrySets: string[] }} Route */
/** @typedef {{ localPref?: number, med?: number, prepend: number, communities: string[], largeCommunities: string[], nextHop?: string, preferredSource?: string, blackhole?: boolean }} Attributes */
/** @typedef {{ policy: string, rule: number, description?: string, check: Check, changed: string[], decision?: string, call?: string }} PolicyStep */

export class Evaluate {
    /**
     * Every condition must hold. One that does not decides; otherwise one not known leaves the whole not known.
     *
     * @param {Check[]} checks
     * @returns {Check}
     */
    static #all(checks) {
        const no = checks.filter((check) => check.answer === "no");
        if (no.length) return { answer: "no", why: no.flatMap((check) => check.why) };

        const unknown = checks.filter((check) => check.answer === "unknown");
        if (unknown.length) return { answer: "unknown", why: unknown.flatMap((check) => check.why) };

        return { answer: "yes", why: [] };
    }

    /**
     * @param {boolean} holds
     * @param {string} why
     * @returns {Check}
     */
    static #test(holds, why) {
        return { answer: holds ? "yes" : "no", why: holds ? [] : [why] };
    }

    /**
     * @param {string} why
     * @returns {Check}
     */
    static #unknown(why) {
        return { answer: "unknown", why: [why] };
    }

    // Where an address is.

    /**
     * The addresses on a device's ports and interfaces, with where each is and the VRF it routes in.
     *
     * @param {Device} device
     */
    static #addressesOf(device) {
        const routed =
            /** @type {[string, { addresses?: readonly (string | { address: string, peer: string })[], vrf?: string } | undefined][]} */ ([
                ...Object.entries(device.ports ?? {}),
                ...Object.entries(device.interfaces ?? {}),
            ]);

        return routed.flatMap(([name, settings]) =>
            (settings?.addresses ?? []).map((entry) => ({
                name,
                address: typeof entry === "string" ? entry : entry.address,
                peer: typeof entry === "string" ? undefined : entry.peer,
                vrf: settings?.vrf,
            }))
        );
    }

    /**
     * Where an address is in the network, how each device would reach it from what the files say, and every rule that names it.
     *
     * @param {StudioData} data
     * @param {string} text an address, such as `10.0.10.5`
     */
    static trace(data, text) {
        const target = Net.parseRange(text);
        if (!target || target.first !== target.last) return undefined;

        // Who holds it, and the segment or block it is in.
        const held = data.devices.flatMap((device) =>
            Evaluate.#addressesOf(device)
                .filter((entry) => Net.samePrefix(entry.address.split("/")[0] ?? "", text))
                .map((entry) => ({ device: device.name, where: entry.name, address: entry.address }))
        );

        const { spaces, elsewhere } = data.addresses;
        const segments = [...spaces.flatMap((space) => space.segments), ...elsewhere.segments];
        const blocks = [...spaces.flatMap((space) => space.blocks), ...elsewhere.blocks];
        const segment = segments.find((candidate) => Net.covers(candidate.prefix, text));
        const block = blocks.find((candidate) => Net.covers(candidate.prefix, text));
        const space = spaces.find((candidate) => Net.covers(candidate.prefix, text));
        const uses = segment?.uses.filter((use) => {
            const [first, last] = use.address.split("-");
            if (!last) return Net.samePrefix(first ?? "", text);
            const from = Net.parseRange(first ?? "");
            const to = Net.parseRange(last);
            return Boolean(from && to && from.first <= target.first && target.first <= to.first);
        });

        // How each device would reach it: the longest prefix that covers it, in each routing table, among its own addresses and its static routes.
        /** @type {RouteFound[]} */
        const routes = [];

        for (const device of data.devices) {
            /** @type {Map<string, RouteFound & { length: number, rank: number }>} */
            const best = new Map();

            /** @param {RouteFound & { length: number, rank: number }} found */
            const offer = (found) => {
                const current = best.get(found.table);
                const better = !current || found.length > current.length || (found.length === current.length && found.rank < current.rank);
                if (better) best.set(found.table, found);
            };

            for (const entry of Evaluate.#addressesOf(device)) {
                const table = entry.vrf ? `VRF ${entry.vrf}` : "main";
                const range = Net.parseRange(entry.address);
                if (!range) continue;

                if (Net.samePrefix(entry.address.split("/")[0] ?? "", text)) {
                    offer({ device: device.name, table, kind: "local", prefix: entry.address, through: entry.name, length: 129, rank: 0 });
                } else if (entry.peer && Net.samePrefix(entry.peer, text)) {
                    offer({
                        device: device.name,
                        table,
                        kind: "connected",
                        prefix: `${entry.peer} as the peer of ${entry.address}`,
                        through: entry.name,
                        length: 128,
                        rank: 1,
                    });
                } else if (!entry.peer && Net.covers(entry.address, text)) {
                    const network = Net.prefixOf(entry.address);
                    offer({
                        device: device.name,
                        table,
                        kind: "connected",
                        prefix: network,
                        through: entry.name,
                        length: range.length,
                        rank: 1,
                    });
                }
            }

            for (const route of device.routing?.static ?? []) {
                const range = Net.parseRange(route.prefix);
                if (!range || !Net.covers(route.prefix, text)) continue;

                const table = route.vrf ? `VRF ${route.vrf}` : "main";
                offer({
                    device: device.name,
                    table,
                    kind: "static",
                    prefix: route.prefix,
                    via: route.via,
                    through: route.interface,
                    note: route.blackhole ? "discarded: a blackhole route" : route.description,
                    length: range.length,
                    rank: 2 + (route.distance ?? 1),
                });
            }

            if (!best.size) routes.push({ device: device.name, table: "main", kind: "none" });
            for (const found of best.values()) {
                const { length: _length, rank: _rank, ...route } = found;
                routes.push(route);
            }
        }

        // Every rule that names it, by address, prefix or address set.
        /** @type {RuleFound[]} */
        const rules = [];

        for (const device of data.devices) {
            const sets = device.firewall?.address_sets ?? {};
            const inSet = (/** @type {string | undefined} */ name) =>
                Boolean(name && (sets[name] ?? []).some((entry) => Net.covers(entry, text)));

            /**
             * @param {string} where
             * @param {readonly { description?: string, match?: { src?: string, dst?: string, src_set?: string, dst_set?: string }, action: string }[]} list
             */
            const look = (where, list) => {
                for (const [index, rule] of list.entries()) {
                    const match = rule.match ?? {};
                    const sides = [
                        (match.src && Net.covers(match.src, text)) || inSet(match.src_set) ? "source" : "",
                        (match.dst && Net.covers(match.dst, text)) || inSet(match.dst_set) ? "destination" : "",
                    ].filter(Boolean);
                    if (sides.length)
                        rules.push({
                            device: device.name,
                            where,
                            rule: index + 1,
                            description: rule.description,
                            action: rule.action,
                            side: sides.join(" and "),
                        });
                }
            };

            for (const [chain, settings] of Object.entries(device.firewall?.filter ?? {})) look(`filter ${chain}`, settings?.rules ?? []);
            for (const [chain, list] of Object.entries(device.firewall?.nat ?? {})) look(`NAT ${chain}`, list ?? []);
            for (const [name, list] of Object.entries(device.acls ?? {})) look(`ACL ${name}`, list);
        }

        return { address: text, family: target.family, held, segment, uses: uses ?? [], block, space, routes, rules };
    }

    // The VLAN path between two devices.

    /**
     * The fewest cables that carry a VLAN from one device to another, from the graph's VLAN layer. Undefined when no such path exists.
     *
     * @param {StudioData} data
     * @param {number} vlan
     * @param {string} from device name
     * @param {string} to device name
     * @returns {GraphEdge[] | undefined}
     */
    static vlanPath(data, vlan, from, to) {
        const start = `device:${from}`;
        const goal = `device:${to}`;
        const cables = data.graph.edges.filter((edge) => edge.layer === "l2" && edge.vlans?.some((carried) => carried.id === vlan));

        /** @type {Map<string, GraphEdge | null>} */
        const cameBy = new Map([[start, null]]);
        const queue = [start];

        for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
            if (at === goal) break;

            for (const cable of cables) {
                const next = cable.from === at ? cable.to : cable.to === at ? cable.from : undefined;
                if (next === undefined || cameBy.has(next)) continue;

                cameBy.set(next, cable);
                queue.push(next);
            }
        }

        if (!cameBy.has(goal)) return undefined;

        /** @type {GraphEdge[]} */
        const path = [];
        for (let at = goal, cable = cameBy.get(goal); cable; cable = cameBy.get(at)) {
            path.unshift(cable);
            at = cable.from === at ? cable.to : cable.from;
        }

        return path;
    }

    // Which firewall rule a packet meets.

    /**
     * @param {Ports} ports
     * @param {number} port
     */
    static #portIn(ports, port) {
        const list = Array.isArray(ports) ? ports : [ports];
        return list.some((entry) => (typeof entry === "number" ? entry === port : entry.min <= port && port <= entry.max));
    }

    /**
     * Whether a packet meets a rule's conditions, as the schema describes each one.
     *
     * @param {FilterMatch} match
     * @param {Packet} packet
     * @param {Record<string, readonly string[]>} sets the device's address sets
     * @returns {Check}
     */
    static #packetMeets(match, packet, sets) {
        /** @type {Check[]} */
        const checks = [];
        const family = packet.family ?? Net.family(packet.src ?? "") ?? Net.family(packet.dst ?? "");

        if (match.family)
            checks.push(
                family ? Evaluate.#test(match.family === family, `it is for ${match.family} only`) : Evaluate.#unknown("its family")
            );

        // A rule with addresses of one family applies to that family only.
        for (const address of [match.src, match.dst]) {
            const own = address ? Net.family(address) : undefined;
            if (own && family && own !== family) checks.push(Evaluate.#test(false, `it names ${own} addresses`));
        }

        if (match.protocol)
            checks.push(
                packet.protocol
                    ? Evaluate.#test(match.protocol === packet.protocol, `it is for ${match.protocol}`)
                    : Evaluate.#unknown("the protocol")
            );

        /**
         * @param {string | undefined} rule
         * @param {string | undefined} given
         * @param {string} side
         */
        const address = (rule, given, side) => {
            if (!rule) return;
            checks.push(
                given ? Evaluate.#test(Net.covers(rule, given), `its ${side} is ${rule}`) : Evaluate.#unknown(`the ${side} address`)
            );
        };

        address(match.src, packet.src, "source");
        address(match.dst, packet.dst, "destination");

        /**
         * @param {string | undefined} name
         * @param {string | undefined} given
         * @param {string} side
         */
        const set = (name, given, side) => {
            if (!name) return;
            const members = sets[name] ?? [];
            checks.push(
                given
                    ? Evaluate.#test(
                          members.some((entry) => Net.covers(entry, given)),
                          `its ${side} is in the set ${name}`
                      )
                    : Evaluate.#unknown(`the ${side} address`)
            );
        };

        set(match.src_set, packet.src, "source");
        set(match.dst_set, packet.dst, "destination");

        /**
         * @param {Ports | undefined} rule
         * @param {number | undefined} given
         * @param {string} side
         */
        const port = (rule, given, side) => {
            if (rule === undefined) return;
            if (packet.protocol && packet.protocol !== "tcp" && packet.protocol !== "udp")
                return checks.push(Evaluate.#test(false, "it names ports, which only TCP and UDP have"));
            checks.push(
                given !== undefined
                    ? Evaluate.#test(Evaluate.#portIn(rule, given), `its ${side} port is ${JSON.stringify(rule)}`)
                    : Evaluate.#unknown(`the ${side} port`)
            );
        };

        port(match.src_port, packet.srcPort, "source");
        port(match.dst_port, packet.dstPort, "destination");

        if (match.in_interface)
            checks.push(
                packet.inInterface
                    ? Evaluate.#test(match.in_interface === packet.inInterface, `it is for packets arriving on ${match.in_interface}`)
                    : Evaluate.#unknown("where the packet arrives")
            );
        if (match.out_interface)
            checks.push(
                packet.outInterface
                    ? Evaluate.#test(
                          match.out_interface === packet.outInterface,
                          `it is for packets leaving through ${match.out_interface}`
                      )
                    : Evaluate.#unknown("where the packet leaves")
            );
        if (match.state)
            checks.push(
                packet.state
                    ? Evaluate.#test(
                          match.state.includes(/** @type {never} */ (packet.state)),
                          `it is for ${match.state.join(" or ")} packets`
                      )
                    : Evaluate.#unknown("the connection state")
            );

        if (match.tcp_flags) {
            if (packet.protocol && packet.protocol !== "tcp") checks.push(Evaluate.#test(false, "it names TCP flags"));
            else if (!packet.flags) checks.push(Evaluate.#unknown("the TCP flags"));
            else {
                const flags = packet.flags;
                const set = match.tcp_flags.set ?? [];
                const unset = match.tcp_flags.unset ?? [];
                checks.push(
                    Evaluate.#test(
                        set.every((flag) => flags.includes(flag)) && unset.every((flag) => !flags.includes(flag)),
                        "its TCP flags differ"
                    )
                );
            }
        }

        return Evaluate.#all(checks);
    }

    /**
     * A packet through one of a device's filter chains: each rule in order until one matches, then the chain's default, accept when it has none.
     *
     * @param {Device} device
     * @param {"input" | "forward" | "output"} chain
     * @param {Packet} packet
     */
    static filterPacket(device, chain, packet) {
        const settings = device.firewall?.filter?.[chain];
        const rules = settings?.rules ?? [];
        const sets = device.firewall?.address_sets ?? {};

        /** @type {{ rule: number, description?: string, action: string, check: Check }[]} */
        const steps = [];

        for (const [index, rule] of rules.entries()) {
            const check = Evaluate.#packetMeets(rule.match ?? {}, packet, sets);
            steps.push({ rule: index + 1, description: rule.description, action: rule.action, check });

            if (check.answer === "yes") return { steps, verdict: rule.action, by: `rule ${index + 1}` };
            if (check.answer === "unknown") return { steps, verdict: undefined, by: `rule ${index + 1}` };
        }

        return {
            steps,
            verdict: settings?.default ?? "accept",
            by: settings?.default ? "the chain's default" : "the chain's default, accept when none is written",
        };
    }

    // What a route policy does to a route.

    /**
     * Whether a route meets a policy rule's conditions, as the schema describes each one. A prefix set holds a route whose prefix is one of its own or inside one.
     *
     * @param {RouteMatch} match
     * @param {Route} route
     * @param {Device} device
     * @returns {Check}
     */
    static #routeMeets(match, route, device) {
        /** @type {Check[]} */
        const checks = [];
        const range = Net.parseRange(route.prefix);
        const family = range?.family;

        if (match.family) checks.push(Evaluate.#test(match.family === family, `it is for ${match.family} only`));
        if (match.prefix) checks.push(Evaluate.#test(Net.samePrefix(match.prefix, route.prefix), `it is for ${match.prefix} exactly`));

        if (match.prefix_set) {
            const set = device.prefix_sets?.[match.prefix_set];
            if (set && "source" in set)
                checks.push(
                    Evaluate.#test(
                        route.inRegistrySets.includes(match.prefix_set),
                        `the route is not in ${match.prefix_set}, fetched from ${set.source.registry}`
                    )
                );
            else
                checks.push(
                    Evaluate.#test(
                        Boolean(set?.prefixes.some((prefix) => Net.covers(prefix, route.prefix))),
                        `the route is not in the prefix set ${match.prefix_set}`
                    )
                );
        }

        const length = range?.length ?? 0;
        if (match.prefix_length?.min !== undefined)
            checks.push(Evaluate.#test(length >= match.prefix_length.min, `it is for /${match.prefix_length.min} or longer`));
        if (match.prefix_length?.max !== undefined)
            checks.push(Evaluate.#test(length <= match.prefix_length.max, `it is for /${match.prefix_length.max} or shorter`));

        if (match.as_path_length) {
            const { min, max } = match.as_path_length;
            if (route.asPathLength === undefined) checks.push(Evaluate.#unknown("the AS path length"));
            else {
                if (min !== undefined) checks.push(Evaluate.#test(route.asPathLength >= min, `it is for AS paths of ${min} or more`));
                if (max !== undefined) checks.push(Evaluate.#test(route.asPathLength <= max, `it is for AS paths of ${max} or fewer`));
            }
        }

        if (match.rpki)
            checks.push(
                route.rpki
                    ? Evaluate.#test(match.rpki === route.rpki, `it is for routes RPKI finds ${match.rpki}`)
                    : Evaluate.#unknown("the RPKI state")
            );
        if (match.community)
            checks.push(Evaluate.#test(route.communities.includes(match.community), `the route does not carry ${match.community}`));
        if (match.large_community)
            checks.push(
                Evaluate.#test(route.largeCommunities.includes(match.large_community), `the route does not carry ${match.large_community}`)
            );

        return Evaluate.#all(checks);
    }

    /**
     * Whether a community matches a pattern in which `*` stands for any value of a field.
     *
     * @param {string} pattern
     * @param {string} community
     */
    static #fits(pattern, community) {
        const want = pattern.split(":");
        const have = community.split(":");
        return want.length === have.length && want.every((field, index) => field === "*" || field === have[index]);
    }

    /**
     * Apply a rule's changes to a route's attributes, and say what changed.
     *
     * @param {Sets} set
     * @param {Attributes} attributes
     */
    static #apply(set, attributes) {
        /** @type {string[]} */
        const changed = [];

        if (set.local_pref !== undefined) changed.push(`local preference ${(attributes.localPref = set.local_pref)}`);
        if (set.med !== undefined) changed.push(`MED ${(attributes.med = set.med)}`);
        if (set.prepend)
            changed.push(
                `prepend our AS ${set.prepend} ${set.prepend === 1 ? "time" : "times"} (${(attributes.prepend += set.prepend)} in all)`
            );

        /**
         * @param {"communities" | "largeCommunities"} key
         * @param {readonly string[] | undefined} replace
         * @param {readonly string[] | undefined} add
         * @param {readonly string[] | undefined} remove
         * @param {string} name
         */
        const communities = (key, replace, add, remove, name) => {
            if (replace) changed.push(`${name} set to ${(attributes[key] = [...replace]).join(", ") || "none"}`);
            if (remove?.length) {
                const before = attributes[key].length;
                attributes[key] = attributes[key].filter((community) => !remove.some((pattern) => Evaluate.#fits(pattern, community)));
                changed.push(`${before - attributes[key].length} ${name} removed by ${remove.join(", ")}`);
            }
            if (add?.length) {
                attributes[key] = [...new Set([...attributes[key], ...add])];
                changed.push(`${name} added: ${add.join(", ")}`);
            }
        };

        communities("communities", set.communities, set.add_communities, set.remove_communities, "communities");
        communities(
            "largeCommunities",
            set.large_communities,
            set.add_large_communities,
            set.remove_large_communities,
            "large communities"
        );

        if (set.next_hop) changed.push(`next hop ${(attributes.nextHop = set.next_hop)}`);
        if (set.preferred_source) changed.push(`preferred source ${(attributes.preferredSource = set.preferred_source)}`);
        if (set.blackhole) {
            attributes.blackhole = true;
            changed.push("blackholed: traffic to it is dropped here");
        }

        return changed;
    }

    /**
     * A route through one of a device's route policies: `call`, then `match`, then `set`, then `action`, rule by rule, until a decision. A route the policy itself never accepts is rejected; one a called policy leaves undecided goes on in the caller.
     *
     * @param {Device} device
     * @param {string} policy
     * @param {Route} route
     */
    static routeThrough(device, policy, route) {
        /** @type {PolicyStep[]} */
        const steps = [];
        /** @type {Attributes} */
        const attributes = { prepend: 0, communities: [...route.communities], largeCommunities: [...route.largeCommunities] };

        /**
         * @param {string} name
         * @param {number} depth
         * @returns {"accept" | "reject" | "unknown" | undefined}
         */
        const run = (name, depth) => {
            const rules = device.policies?.[name] ?? [];
            if (depth > 16) return "unknown";

            for (const [index, rule] of rules.entries()) {
                const step = { policy: name, rule: index + 1, description: rule.description };

                if (rule.call) {
                    const called = run(rule.call, depth + 1);
                    if (called) {
                        steps.push({ ...step, call: rule.call, check: { answer: "yes", why: [] }, changed: [], decision: called });
                        return called;
                    }
                }

                const current = { ...route, communities: attributes.communities, largeCommunities: attributes.largeCommunities };
                const check = Evaluate.#routeMeets(rule.match ?? {}, current, device);

                if (check.answer === "unknown") {
                    steps.push({ ...step, ...(rule.call ? { call: rule.call } : {}), check, changed: [] });
                    return "unknown";
                }

                if (check.answer === "no") {
                    steps.push({ ...step, ...(rule.call ? { call: rule.call } : {}), check, changed: [] });
                    continue;
                }

                const changed = Evaluate.#apply(rule.set ?? {}, attributes);
                steps.push({
                    ...step,
                    ...(rule.call ? { call: rule.call } : {}),
                    check,
                    changed,
                    ...(rule.action ? { decision: rule.action } : {}),
                });
                if (rule.action) return rule.action;
            }

            return undefined;
        };

        const decided = run(policy, 0);
        return { steps, decision: decided ?? "reject", byDefault: decided === undefined, attributes };
    }

    // What changed between two networks.

    /**
     * An edge's place in the graph, the same whichever way round it was written, to match it across two networks.
     *
     * @param {GraphEdge} edge
     */
    static changeKey(edge) {
        return `${edge.layer} ${[edge.from, edge.to].sort().join(" ")} ${edge.label}`;
    }

    /**
     * What differs between the network before and after: devices added, removed or rendered differently; lines of the graph added or gone; and what validate finds newly or no longer.
     *
     * @param {StudioData} before
     * @param {StudioData} after
     */
    static compareNetworks(before, after) {
        const names = (/** @type {StudioData} */ network) => new Set(network.devices.map((device) => device.name));
        const was = names(before);
        const is = names(after);

        const added = [...is].filter((name) => !was.has(name));
        const removed = [...was].filter((name) => !is.has(name));
        const changed = [...is].filter((name) => was.has(name) && before.rendered[name] !== after.rendered[name]);

        const keys = (/** @type {StudioData} */ network) => new Set(network.graph.edges.map(Evaluate.changeKey));
        const edgesBefore = keys(before);
        const edgesAfter = keys(after);

        const finding = (/** @type {import("../../core/define").Finding} */ one) => `${one.level} ${one.device ?? ""} ${one.message}`;
        const findingsBefore = new Set(before.graph.findings.map(finding));
        const findingsAfter = new Set(after.graph.findings.map(finding));

        return {
            devices: { added, removed, changed },
            edges: {
                added: after.graph.edges.filter((edge) => !edgesBefore.has(Evaluate.changeKey(edge))),
                removed: before.graph.edges.filter((edge) => !edgesAfter.has(Evaluate.changeKey(edge))),
            },
            findings: {
                added: after.graph.findings.filter((one) => !findingsBefore.has(finding(one))),
                resolved: before.graph.findings.filter((one) => !findingsAfter.has(finding(one))),
            },
        };
    }
}
