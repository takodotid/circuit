// MPLS on VRP: LDP for IPv4 on VLAN interfaces, sessions to targets, and the labels the device gives its neighbors. The commands are from Huawei's CloudEngine MPLS guide. A CE6855 on V200R005C00SPC800 committed them with `commit trial`, with no LDP neighbor, showed how it prints them, and refused the rest of Circuit's MPLS (TRAPS.md).

import { Address } from "../../core/address";
import type { Device, RouteMatch } from "../../model";
import type { Group } from "../line-diff";
import { VrpPolicies } from "./policies";

/** An entry of a prefix list: its address, its length, and the lengths of the routes inside it that it matches. */
type Range = { address: string; length: number; from: number; to: number };

export class VrpMpls {
    /** VRP labels host routes alone unless told otherwise (`lsp-trigger host`), and Circuit's LDP labels each route of the IGP. */
    private static readonly TRIGGER = "lsp-trigger all";

    /** A prefix list that LDP's outbound policy names, after the policy. */
    private static readonly LIST_PREFIX = "circuit-ldp-";

    /** Entries of a list are numbered in steps of 10, as the switch numbers them. */
    private static readonly STEP = 10;

    /** The lines that run MPLS for the whole switch: a session to a target, LDP, MPLS, and the LSR ID. They go last, once every VLAN interface has let go of MPLS. */
    private static readonly GLOBAL = /^(mpls ldp remote-peer \S+|mpls ldp|mpls|mpls lsr-id \S+)$/;

    /** Every IPv4 route, as a list entry. */
    private static readonly ANY: Range = { address: "0.0.0.0", length: 0, from: 0, to: Address.bits("ipv4") };

    /**
     * The LSR ID, MPLS with every route labeled, LDP with the policies for the labels it gives, then a session to each target. A policy is a prefix list, `circuit-ldp-<policy>`, with an entry for each prefix a rule matches, in order. The first entry that holds a route decides, and a route none holds gets no label. LDP's view prints its IPv4 lines after ` #`, which the read ignores.
     */
    static lines(device: Device): string[] {
        const ldp = device.routing?.mpls?.ldp;
        if (!ldp) return [];

        const neighbors = Object.entries(ldp.neighbors ?? {}).flatMap(([lsrId, neighbor]) =>
            neighbor?.export_policy ? [{ peer: lsrId, policy: neighbor.export_policy }] : []
        );
        const outbound = [...neighbors, ...(ldp.export_policy ? [{ peer: "all", policy: ldp.export_policy }] : [])];
        const policies = [...new Set(outbound.map(({ policy }) => policy))];

        return [
            ...policies.flatMap((policy) => VrpMpls.listLines(device, policy)),
            ...(policies.length ? ["#"] : []),
            `mpls lsr-id ${ldp.lsr_id}`,
            "#",
            "mpls",
            ` ${VrpMpls.TRIGGER}`,
            "#",
            "mpls ldp",
            " ipv4-family",
            ...outbound.map(({ peer, policy }) => `  outbound peer ${peer} fec ip-prefix ${VrpMpls.listName(policy)}`),
            "#",
            ...(ldp.targets ?? []).flatMap((target) => [`mpls ldp remote-peer ${target}`, ` remote-ip ${target}`, "#"]),
        ];
    }

    /** A VLAN interface that runs LDP forwards MPLS too. */
    static interfaceLines(device: Device, name: string): string[] {
        return device.routing?.mpls?.ldp.interfaces.includes(name) ? ["mpls", "mpls ldp"] : [];
    }

    /** `mpls` and `mpls ldp` are two settings, on a VLAN interface as for the whole switch, and a new target's session doesn't replace another's. Undefined for any other line. */
    static head(line: string): string | undefined {
        return /^mpls( ldp( remote-peer \S+)?)?$/.test(line) ? line : undefined;
    }

    /** The LSR ID is undone without its address, and an outbound policy without its list: with it, `Too many parameters`. Undefined for any other line. */
    static undo(line: string): string | undefined {
        if (line.startsWith("mpls lsr-id ")) return "undo mpls lsr-id";
        const outbound = /^outbound peer \S+ fec(?= )/.exec(line);
        return outbound ? `undo ${outbound[0]}` : undefined;
    }

    /** The switch-wide lines that go, taken from the top level in the order they are undone, to go after the VLAN interfaces let go of MPLS. */
    static removed(top: Group | undefined): string[] {
        const gone = top?.remove.filter((line) => VrpMpls.GLOBAL.test(line)) ?? [];
        if (top) top.remove = top.remove.filter((line) => !gone.includes(line));
        const rank = (line: string) =>
            ["mpls ldp remote-peer", "mpls ldp", "mpls", "mpls lsr-id"].findIndex(
                (start) => line === start || line.startsWith(`${start} `)
            );
        return [...gone].sort((a, b) => rank(a) - rank(b));
    }

    /** Committed with `commit trial` on a CE6855 with no LDP neighbor: no session came up. */
    static experimental(device: Device): string[] {
        return device.routing?.mpls ? ["routing.mpls"] : [];
    }

    /** What the switch refused, and what a prefix list can't hold. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const mpls = device.routing?.mpls;
        const ldp = mpls?.ldp;

        // A CE6855 refused each of these as `Unrecognized command`.
        if (mpls?.rsvp_te)
            found.push(
                "routing.mpls.rsvp_te, V200R005 on a CE6855 has no RSVP-TE: `mpls te` and `mpls rsvp-te` are not commands in its `mpls` view, nor `explicit-path`"
            );
        for (const [areaId, area] of Object.entries(device.routing?.ospf?.areas ?? {}))
            if (area.traffic_engineering)
                found.push(
                    `routing.ospf.areas.${areaId}.traffic_engineering, V200R005 on a CE6855 has no traffic engineering: \`mpls-te enable\` is not a command in an OSPF area`
                );
        if (!ldp) return found;

        // A CE6855 committed both, but Huawei's guide says MPLS doesn't run beside a MUX VLAN, which is how VRP builds a private VLAN.
        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {}))
            if (vlan?.private_vlan)
                found.push(
                    `switching.vlans.${name}.private_vlan beside routing.mpls: Huawei's CloudEngine MPLS guide says MPLS can't be used together with a MUX VLAN, which a private VLAN is here`
                );

        for (const name of ldp.interfaces)
            if (!device.interfaces?.vlan_interface?.[name])
                found.push(`routing.mpls.ldp.interfaces ${name}, not a VLAN interface: the switch routes on VLAN interfaces only. Use one`);

        const ipv6 =
            "V200R005 has no LDP for IPv6: `ipv6-family` is not a command in its `mpls ldp` view, and a VLAN interface refuses `mpls ldp ipv6`";
        if (ldp.address_families?.includes("ipv6")) found.push(`routing.mpls.ldp.address_families ipv6, ${ipv6}`);
        for (const key of ["ipv6_transport_address", "prefer_ipv4_transport"] as const)
            if (ldp[key] !== undefined) found.push(`routing.mpls.ldp.${key}, ${ipv6}`);

        const inbound = "V200R005 has no policy for the labels LDP takes: `inbound peer` is not a command in its `mpls ldp` view";
        if (ldp.import_policy) found.push(`routing.mpls.ldp.import_policy, ${inbound}`);
        const neighbors = Object.entries(ldp.neighbors ?? {});
        for (const [lsrId, neighbor] of neighbors)
            if (neighbor?.import_policy) found.push(`routing.mpls.ldp.neighbors.${lsrId}.import_policy, ${inbound}`);

        // "This specific peer's outbound configuration will be invalid, because the global outbound is configured already."
        if (ldp.export_policy)
            for (const [lsrId, neighbor] of neighbors)
                if (neighbor?.export_policy)
                    found.push(
                        `routing.mpls.ldp.neighbors.${lsrId}.export_policy beside routing.mpls.ldp.export_policy: the switch takes a policy for every LDP neighbor, or for some, not both`
                    );

        // A policy called on the way is looked at once, after those LDP names. `VrpPolicies` refuses a prefix and a prefix set at once.
        const exported = [ldp.export_policy, ...neighbors.map(([, neighbor]) => neighbor?.export_policy)];
        const pending = [...new Set(exported.filter((each) => each !== undefined))];
        for (const policy of pending)
            for (const [index, rule] of (device.routing?.policies?.[policy] ?? []).entries()) {
                if ("call" in rule && rule.call !== undefined && !pending.includes(rule.call)) pending.push(rule.call);
                const name = "if" in rule ? rule.if?.prefix_set : undefined;
                const set = name ? device.routing?.prefix_sets?.[name] : undefined;
                if (set && "source" in set)
                    found.push(
                        `routing.policies.${policy}[${index}].if.prefix_set ${name}, from a registry, in an LDP policy: the switch writes an entry for each prefix. Write the prefixes`
                    );
            }

        return found;
    }

    private static listName(policy: string): string {
        return `${VrpMpls.LIST_PREFIX}${policy}`;
    }

    /** A policy's rules that decide, in order, each a list entry for each IPv4 prefix it matches. A list that holds no entry denies every route. */
    private static listLines(device: Device, policy: string): string[] {
        const entries = VrpPolicies.nodes(device, policy).flatMap(({ rule }) => {
            if (!rule.then) return [];
            const action = rule.then === "reject" ? "deny" : "permit";
            return VrpMpls.ranges(device, rule.if ?? {}).map((range) => ({ action, range }));
        });
        if (!entries.length) entries.push({ action: "deny", range: VrpMpls.ANY });

        const name = VrpMpls.listName(policy);
        return entries.map(
            ({ action, range }, index) =>
                `ip ip-prefix ${name} index ${(index + 1) * VrpMpls.STEP} ${action} ${VrpPolicies.entry(range.address, range.length, range.from, range.to)}`
        );
    }

    /** The IPv4 routes a rule matches, as list entries: its prefix alone, each prefix of its set with those inside it, or every route, each kept to its `prefix_length`. */
    private static ranges(device: Device, match: RouteMatch): Range[] {
        if (match.family === "ipv6") return [];
        const bits = Address.bits("ipv4");
        const min = match.prefix_length?.min ?? 0;
        const max = Math.min(match.prefix_length?.max ?? bits, bits);
        if (min > max) return [];

        if (match.prefix) {
            const { addr, len, family } = Address.split(match.prefix);
            return family === "ipv4" && len >= min && len <= max ? [{ address: addr, length: len, from: len, to: len }] : [];
        }

        const set = match.prefix_set ? device.routing?.prefix_sets?.[match.prefix_set] : undefined;
        if (match.prefix_set)
            return (set ? VrpPolicies.prefixesOf(set) : []).flatMap((prefix) => {
                const { addr, len, family } = Address.split(prefix);
                const from = Math.max(len, min);
                return family === "ipv4" && from <= max ? [{ address: addr, length: len, from, to: max }] : [];
            });

        return [{ ...VrpMpls.ANY, from: min, to: max }];
    }
}
