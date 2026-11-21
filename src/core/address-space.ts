// What `circuit addresses` prints. It reads only the project, so an address a device gave out itself, such as a DHCP lease, is not in it.

import type { Device } from "../model";
import { Address } from "./address";
import { Topology } from "./topology";

/** One address or range in a segment, and what holds it. */
export type Use = {
    /** An address, or `first-last` for a range. */
    address: string;
    what: string;
};

/** A prefix the devices have addresses in. */
export type Segment = {
    prefix: string;
    uses: Use[];
    /** How many addresses no one uses, written out, since an IPv6 count does not fit a JavaScript number. */
    free: string;
    /** The lowest free address, when there is one. */
    next?: string;
};

/** A prefix in use without being a segment: a loopback's address, a point-to-point address, a block routed elsewhere, or a NAT or PPPoE pool. */
export type Block = {
    prefix: string;
    what: string;
    /** `first-last`, for a pool that is no prefix. Then `prefix` is the smallest prefix that holds it, which places it in a space. */
    range?: string;
};

/** Space the network owns: in `circuit({ prefixes })`, originated in BGP, or asked for. Everything in use inside it, and what is free. */
export type Space = {
    prefix: string;
    /** Where it comes from, such as `prefixes ours.v4 in circuit.ts, originated by edge-01`. */
    owner: string;
    segments: Segment[];
    blocks: Block[];
    /** The fewest prefixes that cover what nothing uses. */
    free: string[];
};

export type AddressReport = {
    spaces: Space[];
    /** What is in use outside every space. Left out when a prefix is asked for. */
    elsewhere: { segments: Segment[]; blocks: Block[] };
};

/** The network's prefixes, as `circuit({ prefixes })` writes them: groups of named prefixes. */
export type OwnedPrefixes = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A use as a range of numbers, for counting. */
type Taken = { first: bigint; last: bigint };

export class AddressSpace {
    /** A /31 has no network or broadcast address (RFC 3021). */
    private static readonly IPV4_POINT_TO_POINT = 31;
    /** A /127 has no subnet-router anycast address (RFC 6164). */
    private static readonly IPV6_POINT_TO_POINT = 127;
    /** How many free prefixes of one length the text lists before it says how many more. */
    private static readonly FREE_LISTED = 16;

    private static isHostRoute(cidr: string): boolean {
        const { len, family } = Address.split(cidr);
        return len === Address.bits(family);
    }

    private static numberOf(address: string): bigint {
        return Address.toNumber(address) ?? 0n;
    }

    /** Addresses a segment can give out: IPv4 leaves out the network and broadcast addresses, IPv6 the subnet-router anycast address. */
    private static usable(prefix: string): Taken {
        const { first, last, family } = Address.range(prefix);
        const { len } = Address.split(prefix);

        if (family === "ipv4" && len < AddressSpace.IPV4_POINT_TO_POINT) return { first: first + 1n, last: last - 1n };
        if (family === "ipv6" && len < AddressSpace.IPV6_POINT_TO_POINT) return { first: first + 1n, last };
        return { first, last };
    }

    /** Overlapping ranges count once. */
    private static merged(ranges: readonly Taken[]): Taken[] {
        const sorted = [...ranges].sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));
        const result: Taken[] = [];

        for (const range of sorted) {
            const previous = result.at(-1);
            if (previous && range.first <= previous.last + 1n) previous.last = range.last > previous.last ? range.last : previous.last;
            else result.push({ ...range });
        }

        return result;
    }

    /** What is inside `within` and in none of the ranges. */
    private static gaps(within: Taken, taken: readonly Taken[]): Taken[] {
        const result: Taken[] = [];
        let cursor = within.first;

        for (const range of AddressSpace.merged(taken)) {
            if (range.last < within.first || range.first > within.last) continue;
            if (range.first > cursor) result.push({ first: cursor, last: range.first - 1n });
            if (range.last + 1n > cursor) cursor = range.last + 1n;
        }

        if (cursor <= within.last) result.push({ first: cursor, last: within.last });
        return result;
    }

    /** `12`, or for a count too long to read, `about 2^64`, to the nearest power of two. */
    private static count(value: bigint): string {
        if (value <= 1n << 20n) return String(value);

        const power = value.toString(2).length - 1;
        const nearer = value - (1n << BigInt(power)) >= 1n << BigInt(power - 1) ? power + 1 : power;
        return `about 2^${nearer}`;
    }

    /** The addresses a block uses: its range, or all of its prefix. */
    private static extent(block: Block): Taken {
        const [first, last] = (block.range ?? "").split("-");
        if (first === undefined || last === undefined) return Address.range(block.prefix);
        return { first: AddressSpace.numberOf(first), last: AddressSpace.numberOf(last) };
    }

    /** The first and last address of a prefix. */
    private static ends(prefix: string): { first: string; last: string } {
        const { first, last, family } = Address.range(prefix);
        return { first: Address.fromNumber(first, family), last: Address.fromNumber(last, family) };
    }

    /** The smallest prefix that holds both addresses. */
    private static covering(first: string, last: string): string {
        const family = Address.family(first);
        const differing = (AddressSpace.numberOf(first) ^ AddressSpace.numberOf(last)).toString(2).replace(/^0$/, "").length;
        return Address.prefixOf(`${first}/${Address.bits(family) - differing}`);
    }

    private static byAddress(a: Use, b: Use): number {
        const first = (use: Use) => AddressSpace.numberOf(use.address.split("-")[0] ?? "");
        return first(a) < first(b) ? -1 : first(a) > first(b) ? 1 : 0;
    }

    /** IPv4 before IPv6, then by first address. */
    private static comparePrefixes(a: string, b: string): number {
        const [ra, rb] = [Address.range(a), Address.range(b)];
        if (ra.family !== rb.family) return ra.family === "ipv4" ? -1 : 1;
        return ra.first < rb.first ? -1 : ra.first > rb.first ? 1 : 0;
    }

    private static byPrefix(a: { prefix: string }, b: { prefix: string }): number {
        return AddressSpace.comparePrefixes(a.prefix, b.prefix);
    }

    /**
     * Every address in use, by segment, under the space the network owns: each prefix of `owned`, and each prefix a device originates in BGP. With `within`, only what falls inside that prefix.
     */
    static report(devices: readonly Device[], owned: OwnedPrefixes = {}, within?: string): AddressReport {
        const segments = new Map<string, { uses: Use[]; taken: Taken[] }>();
        const blocks: Block[] = [];
        const segmentOf = (address: string) => [...segments.keys()].find((prefix) => Address.contains(prefix, address));

        // Segments come from the addresses on ports and interfaces. A host route, such as a loopback's, or a point-to-point address, is a block of its own.
        for (const holder of Topology.holders(devices)) {
            const what = `${holder.device.name} ${holder.name}${holder.vrf ? `, VRF ${holder.vrf}` : ""}`;

            if (AddressSpace.isHostRoute(holder.address) || holder.peer) {
                blocks.push({ prefix: `${Address.host(holder.address)}/${Address.bits(Address.family(holder.address))}`, what });
                continue;
            }

            const prefix = Address.prefixOf(holder.address);
            const segment = segments.get(prefix) ?? { uses: [], taken: [] };
            const value = AddressSpace.numberOf(Address.host(holder.address));

            segment.uses.push({ address: Address.host(holder.address), what });
            segment.taken.push({ first: value, last: value });
            segments.set(prefix, segment);

            for (const group of holder.vrrp) {
                if (!Address.isValid(group.address) || !Address.contains(prefix, group.address)) continue;
                if (segment.uses.some((use) => use.address === group.address)) continue;

                const sharing = devices.filter((device) =>
                    Topology.routedOf(device).some(([, settings]) =>
                        (settings.vrrp ?? []).some((other) => other.id === group.id && other.address === group.address)
                    )
                );

                segment.uses.push({
                    address: group.address,
                    what: `VRRP ${group.id} on ${sharing.map((device) => device.name).join(", ")}`,
                });
                const shared = AddressSpace.numberOf(group.address);
                segment.taken.push({ first: shared, last: shared });
            }
        }

        // A use inside a segment is an address taken; outside every segment, it is a block of its own. An address one of the interfaces holds is listed once, as that interface.
        const take = (address: string, what: string, first = address, last = address) => {
            const prefix = segmentOf(first);
            const segment = prefix === undefined ? undefined : segments.get(prefix);
            if (!segment) return false;
            if (segment.uses.some((use) => use.address === address)) return true;

            segment.uses.push({ address, what });
            segment.taken.push({ first: AddressSpace.numberOf(first), last: AddressSpace.numberOf(last) });
            return true;
        };

        // A range is an address taken only when both ends are in one segment. A range that leaves its segment is a block.
        const claim = (first: string, last: string, what: string, label = `${first}-${last}`) => {
            const prefix = segmentOf(first);
            return prefix !== undefined && prefix === segmentOf(last) && take(label, what, first, last);
        };

        for (const device of devices) {
            for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
                if (!server) continue;
                const [start, end] = server.pool;
                if (Address.isValid(start) && Address.isValid(end))
                    take(`${start}-${end}`, `DHCP pool ${name} on ${device.name}`, start, end);

                for (const reservation of server.reservations ?? []) {
                    if (Address.isValid(reservation.address))
                        take(reservation.address, `reserved for ${reservation.description ?? reservation.mac} by ${device.name}`);
                }
            }

            for (const [name, server] of Object.entries(device.services?.dhcpv6_server ?? {})) {
                const [start, end] = server?.pool ?? [];
                if (start && end && Address.isValid(start) && Address.isValid(end))
                    take(`${start}-${end}`, `DHCPv6 pool ${name} on ${device.name}`, start, end);

                const delegated = server?.prefix_delegation?.pool;
                if (delegated && Address.isCidr(delegated))
                    blocks.push({
                        prefix: Address.prefixOf(delegated),
                        what: `prefixes delegated by DHCPv6 server ${name} on ${device.name}`,
                    });
            }

            for (const [name, server] of Object.entries(device.services?.pppoe_server ?? {})) {
                if (!server) continue;
                const [start, end] = server.pool;
                const what = `PPPoE pool ${name} on ${device.name}`;
                if (Address.isValid(start) && Address.isValid(end) && !claim(start, end, what))
                    blocks.push({ prefix: AddressSpace.covering(start, end), what, range: `${start}-${end}` });

                const local = `PPPoE server ${name} on ${device.name}`;
                if (Address.isValid(server.local_address) && !take(server.local_address, local))
                    blocks.push({ prefix: `${server.local_address}/${Address.bits("ipv4")}`, what: local });

                const delegated = server.prefix_delegation?.pool;
                if (delegated && Address.isCidr(delegated))
                    blocks.push({
                        prefix: Address.prefixOf(delegated),
                        what: `prefixes delegated by PPPoE server ${name} on ${device.name}`,
                    });

                const sessions = server.slaac?.pool;
                if (sessions && Address.isCidr(sessions))
                    blocks.push({ prefix: Address.prefixOf(sessions), what: `sessions' /64s of PPPoE server ${name} on ${device.name}` });
            }

            // A pool and the subscribers it serves are both address space in use. A rule with no pool, such as masquerade, uses none.
            for (const rule of device.firewall?.nat?.source ?? []) {
                if (!("to_pool" in rule) || !Address.isCidr(rule.to_pool)) continue;

                // A deterministic pool's subscribers are one prefix, and a dynamic pool's any number.
                const subscribers = [rule.if?.src].flat().filter((src) => src !== undefined);
                const pool = AddressSpace.ends(rule.to_pool);
                if (!claim(pool.first, pool.last, `NAT pool ${rule.to_pool} on ${device.name}`, rule.to_pool))
                    blocks.push({
                        prefix: Address.prefixOf(rule.to_pool),
                        what: `NAT pool${subscribers.length ? ` for ${subscribers.join(", ")}` : ""} on ${device.name}`,
                    });

                for (const prefix of subscribers.filter((src) => Address.isCidr(src))) {
                    const each = AddressSpace.ends(prefix);
                    const what = `subscribers of NAT pool ${rule.to_pool} on ${device.name}`;
                    if (!claim(each.first, each.last, what, prefix)) blocks.push({ prefix: Address.prefixOf(prefix), what });
                }
            }

            for (const route of device.routing?.static_routes ?? []) {
                if (route.next_hop && Address.isValid(route.next_hop))
                    take(route.next_hop, `next hop for ${route.prefix} on ${device.name}`);
            }

            for (const [name, neighbor] of Object.entries(device.routing?.bgp?.neighbors ?? {})) {
                if (neighbor?.address && Address.isValid(neighbor.address))
                    take(neighbor.address, `BGP neighbor ${name} of ${device.name}`);
            }

            const peers = Object.entries(device.interfaces?.wireguard ?? {}).flatMap(([name, tunnel]) =>
                (tunnel?.peers ?? []).map((peer) => ({ peer, what: `WireGuard peer ${peer.name} on ${device.name} ${name}` }))
            );
            for (const { peer, what } of peers) {
                for (const allowed of peer.allowed_addresses) {
                    if (!Address.isCidr(allowed)) continue;
                    if (AddressSpace.isHostRoute(allowed) && take(Address.host(allowed), what)) continue;
                    if (!segmentOf(Address.host(allowed))) blocks.push({ prefix: Address.prefixOf(allowed), what });
                }
            }
        }

        // Space the network owns: its prefixes in circuit.ts, and what its devices originate in BGP.
        const owners = new Map<string, { named: string[]; by: string[] }>();
        const ownerOf = (prefix: string) => {
            const key = Address.prefixOf(prefix);
            const known = owners.get(key) ?? { named: [], by: [] };
            owners.set(key, known);
            return known;
        };
        for (const [group, prefixes] of Object.entries(owned)) {
            for (const [name, prefix] of Object.entries(prefixes))
                if (Address.isCidr(prefix)) ownerOf(prefix).named.push(`${group}.${name}`);
        }
        for (const device of devices) {
            for (const prefix of device.routing?.bgp?.originated_prefixes ?? []) {
                const known = Address.isCidr(prefix) ? ownerOf(prefix) : undefined;
                if (known && !known.by.includes(device.name)) known.by.push(device.name);
            }
        }

        // A static route to a prefix no segment is in hands that block to whoever is at the next hop. A route covering segments or owned space, such as an aggregate or a default route, is no use.
        for (const device of devices) {
            for (const route of device.routing?.static_routes ?? []) {
                if (!Address.isCidr(route.prefix) || Address.split(route.prefix).len === 0) continue;

                const overlapsSegment = [...segments.keys()].some(
                    (prefix) => Address.contains(route.prefix, prefix) || Address.contains(prefix, route.prefix)
                );
                const coversOwned = [...owners.keys()].some((space) => Address.contains(route.prefix, space));
                if (overlapsSegment || coversOwned) continue;

                const how = route.blackhole
                    ? "discarded"
                    : route.next_hop
                      ? `routed via ${route.next_hop}`
                      : `routed out ${route.interface}`;
                blocks.push({ prefix: Address.prefixOf(route.prefix), what: `${how} by ${device.name}` });
            }
        }

        const asked = within ? Address.prefixOf(within) : undefined;
        const spacePrefixes = asked ? [asked] : [...owners.keys()];

        // A segment or block belongs to the smallest space it is inside.
        const spaceOf = (prefix: string) =>
            spacePrefixes.filter((space) => Address.contains(space, prefix)).sort((a, b) => Address.split(b).len - Address.split(a).len)[0];

        const toSegment = (prefix: string): Segment => {
            const { uses, taken } = segments.get(prefix) ?? { uses: [], taken: [] };
            const free = AddressSpace.gaps(AddressSpace.usable(prefix), taken);
            const total = free.reduce((sum, range) => sum + range.last - range.first + 1n, 0n);
            const [lowest] = free;

            return {
                prefix,
                uses: uses.sort(AddressSpace.byAddress),
                free: AddressSpace.count(total),
                ...(lowest ? { next: Address.fromNumber(lowest.first, Address.family(prefix)) } : {}),
            };
        };

        const uniqueBlocks = blocks.filter(
            (block, index) => blocks.findIndex((other) => other.prefix === block.prefix && other.what === block.what) === index
        );

        const describe = (space: string) => {
            const known = owners.get(space);
            if (!known) return "asked for";
            return [
                ...(known.named.length ? [`prefixes ${known.named.join(", ")} in circuit.ts`] : []),
                ...(known.by.length ? [`originated by ${known.by.join(", ")}`] : []),
            ].join(", ");
        };

        const spaces: Space[] = [...spacePrefixes].sort(AddressSpace.comparePrefixes).map((space) => {
            const inside = (prefix: string) => spaceOf(prefix) === space;
            const spaceSegments = [...segments.keys()].filter(inside).sort(AddressSpace.comparePrefixes);
            const spaceBlocks = uniqueBlocks.filter((block) => inside(block.prefix)).sort(AddressSpace.byPrefix);

            // Smaller spaces inside this one are in use too.
            const nested = spacePrefixes.filter((other) => other !== space && Address.contains(space, other));
            const taken = [
                ...spaceSegments.map((prefix) => Address.range(prefix)),
                ...spaceBlocks.map(AddressSpace.extent),
                ...nested.map((prefix) => Address.range(prefix)),
            ];

            return {
                prefix: space,
                owner: describe(space),
                segments: spaceSegments.map(toSegment),
                blocks: spaceBlocks,
                free: AddressSpace.gaps(Address.range(space), taken).flatMap((range) =>
                    Address.prefixesBetween(range.first, range.last, Address.family(space))
                ),
            };
        });

        const outside = (prefix: string) => !spaceOf(prefix);

        return {
            spaces,
            elsewhere: asked
                ? { segments: [], blocks: [] }
                : {
                      segments: [...segments.keys()].filter(outside).sort(AddressSpace.comparePrefixes).map(toSegment),
                      blocks: uniqueBlocks.filter((block) => outside(block.prefix)).sort(AddressSpace.byPrefix),
                  },
        };
    }

    /** Free prefixes of one length inside the free space, up to `limit`, and how many there are in all. */
    static freeOfLength(free: readonly string[], length: number, limit: number): { prefixes: string[]; total: bigint } {
        const prefixes: string[] = [];
        let total = 0n;

        for (const prefix of free) {
            const { len, family } = Address.split(prefix);
            if (len > length || length > Address.bits(family)) continue;

            const { first } = Address.range(prefix);
            const step = 1n << BigInt(Address.bits(family) - length);
            const fits = 1n << BigInt(length - len);
            total += fits;

            for (let index = 0n; index < fits && prefixes.length < limit; index++) {
                prefixes.push(`${Address.fromNumber(first + index * step, family)}/${length}`);
            }
        }

        return { prefixes, total };
    }

    static text(report: AddressReport, length?: number): string {
        const lines: string[] = [];
        const segment = (each: Segment) => {
            lines.push(`  ${each.prefix}, ${each.free} free${each.next ? `, next ${each.next}` : ""}`);
            for (const use of each.uses) lines.push(`      ${use.address}  ${use.what}`);
        };
        const block = (each: Block) => lines.push(`  ${each.range ?? each.prefix}  ${each.what}`);

        for (const space of report.spaces) {
            lines.push(`${space.prefix}, ${space.owner}`);
            space.segments.forEach(segment);
            space.blocks.forEach(block);

            if (length === undefined) lines.push(`  free: ${space.free.join(", ") || "none"}`);
            else {
                const { prefixes, total } = AddressSpace.freeOfLength(space.free, length, AddressSpace.FREE_LISTED);
                const more = total > BigInt(prefixes.length) ? `, and ${total - BigInt(prefixes.length)} more` : "";
                lines.push(`  free /${length}: ${prefixes.join(", ") || "none"}${more}`);
            }
            lines.push("");
        }

        const { segments, blocks } = report.elsewhere;
        if (segments.length || blocks.length) {
            lines.push("Outside the space the network owns");
            segments.forEach(segment);
            blocks.forEach(block);
            lines.push("");
        }

        return lines.join("\n");
    }
}
