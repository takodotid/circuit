// Every address the config uses, by prefix, and what is still free: what `circuit addresses` prints. It reads the config only, so an address a device gave out by itself, such as a DHCP lease, is not known.

import type { Device } from "../schema";
import { Address } from "./address";
import { Topology } from "./topology";

/** One address or range in a segment, and what holds it. */
export type Use = {
    /** An address, or `first-last` for a range. */
    address: string;
    what: string;
};

/** A prefix our devices have addresses in. */
export type Segment = {
    prefix: string;
    uses: Use[];
    /** How many addresses no one uses, as a number written out, since an IPv6 count does not fit a JavaScript number. */
    free: string;
    /** The lowest free address, when there is one. */
    next?: string;
};

/** A prefix in use without being a segment: a loopback's address, or a block routed elsewhere. */
export type Block = {
    prefix: string;
    what: string;
};

/** Space the network owns: a prefix it originates in BGP, or one asked for. Everything in use inside it, and what is free. */
export type Space = {
    prefix: string;
    /** Why it is listed, such as `originated by edge-01`. */
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

/** A use as a range of numbers, for counting. */
type Taken = { first: bigint; last: bigint };

export class AddressSpace {
    private static isHostRoute(cidr: string): boolean {
        return Address.split(cidr).len === Address.bits(Address.split(cidr).family);
    }

    private static numberOf(address: string): bigint {
        return Address.toNumber(address)!;
    }

    /** Addresses a segment can give out: IPv4 leaves out the network and broadcast addresses below /31, and IPv6 the subnet-router anycast address. */
    private static usable(prefix: string): Taken {
        const { first, last, family } = Address.range(prefix);
        const { len } = Address.split(prefix);

        if (family === "ipv4" && len <= 30) return { first: first + 1n, last: last - 1n };
        if (family === "ipv6" && len < 127) return { first: first + 1n, last };

        return { first, last };
    }

    /** Ranges merged, so overlapping ones count once. */
    private static merged(ranges: Taken[]): Taken[] {
        const sorted = [...ranges].sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));
        const result: Taken[] = [];

        for (const range of sorted) {
            const previous = result.at(-1);
            if (previous && range.first <= previous.last + 1n) previous.last = range.last > previous.last ? range.last : previous.last;
            else result.push({ ...range });
        }

        return result;
    }

    /** What is inside `within` and not in any of the ranges. */
    private static gaps(within: Taken, taken: Taken[]): Taken[] {
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

    /** `12` or, for a count too long to read, `about 2^64`, to the nearest power of two. */
    private static count(value: bigint): string {
        if (value <= 1n << 20n) return String(value);

        const power = value.toString(2).length - 1;
        const nearer = value - (1n << BigInt(power)) >= 1n << BigInt(power - 1) ? power + 1 : power;
        return `about 2^${nearer}`;
    }

    private static byAddress(a: Use, b: Use): number {
        const first = (use: Use) => AddressSpace.numberOf(use.address.split("-")[0]!);
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

    /** Every address in use, by segment, under the space the network owns. With `within`, only what falls inside that prefix, as the one space. */
    static report(devices: readonly Device[], within?: string): AddressReport {
        const segments = new Map<string, { uses: Use[]; taken: Taken[] }>();
        const blocks: Block[] = [];

        const segmentOf = (address: string) => [...segments.keys()].find((prefix) => Address.contains(prefix, address));

        // Segments come from the addresses on interfaces; a host route, such as a loopback's, is a block of its own.
        for (const holder of Topology.holders(devices)) {
            const vrf = holder.device.ports?.[holder.name]?.vrf ?? holder.device.interfaces?.[holder.name]?.vrf;
            const what = `${holder.device.name} ${holder.name}${vrf ? `, VRF ${vrf}` : ""}`;

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

                const holders = devices.filter((device) =>
                    Object.values({ ...device.ports, ...device.interfaces }).some((settings) =>
                        settings?.vrrp?.some((other) => other.id === group.id && other.address === group.address)
                    )
                );

                segment.uses.push({
                    address: group.address,
                    what: `VRRP ${group.id} on ${holders.map((device) => device.name).join(", ")}`,
                });
                segment.taken.push({ first: AddressSpace.numberOf(group.address), last: AddressSpace.numberOf(group.address) });
            }
        }

        // A use inside a segment is an address taken; outside every segment, a block of its own. An address one of our interfaces holds is listed once, as that interface.
        const take = (address: string, what: string, first = address, last = address) => {
            const prefix = segmentOf(first);
            if (!prefix) return false;

            const segment = segments.get(prefix)!;
            if (segment.uses.some((use) => use.address === address)) return true;

            segment.uses.push({ address, what });
            segment.taken.push({ first: AddressSpace.numberOf(first), last: AddressSpace.numberOf(last) });
            return true;
        };

        for (const device of devices) {
            for (const [name, server] of Object.entries(device.dhcp ?? {})) {
                const [start, end] = server.pool;
                if (Address.isValid(start) && Address.isValid(end))
                    take(`${start}-${end}`, `DHCP pool ${name} on ${device.name}`, start, end);

                for (const reservation of server.reservations ?? []) {
                    if (Address.isValid(reservation.address))
                        take(reservation.address, `reserved for ${reservation.description ?? reservation.mac} by ${device.name}`);
                }
            }

            for (const route of device.routing?.static ?? []) {
                if (route.via && Address.isValid(route.via)) take(route.via, `next hop for ${route.prefix} on ${device.name}`);
            }

            for (const [name, neighbor] of Object.entries(device.routing?.bgp?.neighbors ?? {})) {
                if (Address.isValid(neighbor.address)) take(neighbor.address, `BGP neighbor ${name} of ${device.name}`);
            }

            for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
                if (iface.type !== "wireguard") continue;

                for (const peer of iface.peers ?? []) {
                    for (const allowed of peer.allowed_addresses) {
                        if (!Address.isCidr(allowed)) continue;

                        const what = `WireGuard peer ${peer.name} on ${device.name} ${name}`;
                        if (AddressSpace.isHostRoute(allowed) && take(Address.host(allowed), what)) continue;
                        if (!segmentOf(Address.host(allowed))) blocks.push({ prefix: Address.prefixOf(allowed), what });
                    }
                }
            }
        }

        // Space the network owns: what it originates in BGP, or the prefix asked for.
        const owners = new Map<string, string[]>();
        for (const device of devices) {
            for (const prefix of device.routing?.bgp?.networks ?? []) {
                if (!Address.isCidr(prefix)) continue;
                owners.set(Address.prefixOf(prefix), [...(owners.get(Address.prefixOf(prefix)) ?? []), device.name]);
            }
        }

        // A static route to a prefix no segment is in hands that block to whoever is at the next hop. A route covering segments or owned space, such as an aggregate, is not a use.
        for (const device of devices) {
            for (const route of device.routing?.static ?? []) {
                if (!Address.isCidr(route.prefix) || Address.split(route.prefix).len === 0) continue;

                const overlapsSegment = [...segments.keys()].some(
                    (prefix) => Address.contains(route.prefix, prefix) || Address.contains(prefix, route.prefix)
                );
                const coversOwned = [...owners.keys()].some((owned) => Address.contains(route.prefix, owned));
                if (overlapsSegment || coversOwned) continue;

                const how = route.blackhole ? "discarded" : route.via ? `routed via ${route.via}` : `routed out ${route.interface}`;
                blocks.push({ prefix: Address.prefixOf(route.prefix), what: `${how} by ${device.name}` });
            }
        }

        const asked = within ? Address.prefixOf(within) : undefined;
        const spacePrefixes = asked ? [asked] : [...owners.keys()];

        // A segment or block belongs to the smallest space it is inside.
        const spaceOf = (prefix: string) =>
            spacePrefixes.filter((space) => Address.contains(space, prefix)).sort((a, b) => Address.split(b).len - Address.split(a).len)[0];

        const toSegment = (prefix: string): Segment => {
            const { uses, taken } = segments.get(prefix)!;
            const free = AddressSpace.gaps(AddressSpace.usable(prefix), taken);
            const total = free.reduce((sum, range) => sum + range.last - range.first + 1n, 0n);
            const family = Address.family(prefix);

            return {
                prefix,
                uses: uses.sort(AddressSpace.byAddress),
                free: AddressSpace.count(total),
                ...(free[0] ? { next: Address.fromNumber(free[0].first, family) } : {}),
            };
        };

        const uniqueBlocks = blocks.filter(
            (block, index) => blocks.findIndex((other) => other.prefix === block.prefix && other.what === block.what) === index
        );

        const spaces: Space[] = spacePrefixes.sort(AddressSpace.comparePrefixes).map((space) => {
            const inside = (prefix: string) => spaceOf(prefix) === space;
            const spaceSegments = [...segments.keys()].filter(inside).sort(AddressSpace.comparePrefixes);
            const spaceBlocks = uniqueBlocks.filter((block) => inside(block.prefix)).sort(AddressSpace.byPrefix);

            // Smaller spaces inside this one are in use too.
            const nested = spacePrefixes.filter((other) => other !== space && Address.contains(space, other));
            const taken = [...spaceSegments, ...spaceBlocks.map((block) => block.prefix), ...nested].map((prefix) => Address.range(prefix));
            const family = Address.family(space);

            return {
                prefix: space,
                owner: asked && !owners.has(space) ? "asked for" : `originated by ${(owners.get(space) ?? []).join(", ")}`,
                segments: spaceSegments.map(toSegment),
                blocks: spaceBlocks,
                free: AddressSpace.gaps(Address.range(space), taken).flatMap((range) =>
                    Address.prefixesBetween(range.first, range.last, family)
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
}
