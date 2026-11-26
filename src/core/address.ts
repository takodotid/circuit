// Addresses are parsed to bigint, so IPv4 and IPv6 share one code path.

import type { Family, IP, IPv4, IPv6, Prefix } from "../model";

export class Address {
    private static readonly IPV4_BITS = 32;
    private static readonly IPV6_BITS = 128;
    private static readonly IPV4_OCTETS = 4;
    private static readonly OCTET_MAX = 255;
    private static readonly IPV6_GROUPS = 8;
    private static readonly IPV6_GROUP_BITS = 16;
    private static readonly HEX = 16;

    /**
     * Whether another network can reach each block: the Globally Reachable column of IANA's IPv4 and IPv6 Special-Purpose Address Registries (RFC 6890), checked 2026-11-18. IPv4 multicast (RFC 5771) and IPv6 outside 2000::/3 are not global. A block the registry leaves blank, or that says the same as the block around it, is left out.
     */
    private static readonly GLOBALLY_REACHABLE: Readonly<Record<string, boolean>> = {
        "0.0.0.0/0": true,
        "0.0.0.0/8": false,
        "10.0.0.0/8": false,
        "100.64.0.0/10": false,
        "127.0.0.0/8": false,
        "169.254.0.0/16": false,
        "172.16.0.0/12": false,
        "192.0.0.0/24": false,
        "192.0.0.9/32": true,
        "192.0.0.10/32": true,
        "192.0.2.0/24": false,
        "192.88.99.2/32": false,
        "192.168.0.0/16": false,
        "198.18.0.0/15": false,
        "198.51.100.0/24": false,
        "203.0.113.0/24": false,
        "224.0.0.0/4": false,
        "240.0.0.0/4": false,
        "::/0": false,
        "64:ff9b::/96": true,
        "2000::/3": true,
        "2001::/23": false,
        "2001:1::1/128": true,
        "2001:1::2/128": true,
        "2001:1::3/128": true,
        "2001:3::/32": true,
        "2001:4:112::/48": true,
        "2001:20::/28": true,
        "2001:30::/28": true,
        "2001:db8::/32": false,
        "3fff::/20": false,
        "5f00::/16": false,
    };

    static family(address: string): Family {
        return address.includes(":") ? "ipv6" : "ipv4";
    }

    static bits(family: Family): number {
        return family === "ipv4" ? Address.IPV4_BITS : Address.IPV6_BITS;
    }

    static toNumber(address: string): bigint | null {
        if (!address.includes(":")) {
            const octets = address.split(".");
            const valid =
                octets.length === Address.IPV4_OCTETS &&
                octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= Address.OCTET_MAX);
            if (!valid) return null;

            return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
        }

        // The last 32 bits may be written as an IPv4 address, as in `::ffff:192.0.2.1` (RFC 4291, section 2.2).
        const lastColon = address.lastIndexOf(":");
        const embedded = address.slice(lastColon + 1);
        if (embedded.includes(".")) {
            const ipv4 = Address.toNumber(embedded);
            if (ipv4 === null) return null;

            const groupBits = BigInt(Address.IPV6_GROUP_BITS);
            const high = (ipv4 >> groupBits).toString(Address.HEX);
            const low = (ipv4 & ((1n << groupBits) - 1n)).toString(Address.HEX);
            return Address.toNumber(`${address.slice(0, lastColon + 1)}${high}:${low}`);
        }

        const [before, after, extra] = address.split("::");
        if (extra !== undefined) return null;

        const groupsOf = (text: string | undefined) => (text ? text.split(":") : []);
        const leading = groupsOf(before);
        const trailing = groupsOf(after);

        // `::` stands for as many zero groups as make eight.
        const zeros = after === undefined ? 0 : Address.IPV6_GROUPS - leading.length - trailing.length;
        const groups = [...leading, ...Array(zeros).fill("0"), ...trailing];

        const valid = groups.length === Address.IPV6_GROUPS && groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group));
        if (!valid) return null;

        return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, Address.HEX)), 0n);
    }

    /** `10.0.0.1/24` to its parts. Throws when it is not an address with a length. */
    static split(cidr: string): { addr: string; len: number; family: Family } {
        const [address, lengthText] = cidr.split("/");
        const family = Address.family(address!);
        const length = Number(lengthText);

        const valid =
            Address.toNumber(address!) !== null &&
            lengthText !== undefined &&
            Number.isInteger(length) &&
            length >= 0 &&
            length <= Address.bits(family);
        if (!valid) throw new Error(`'${cidr}' is not an address with a length`);

        return { addr: address!, len: length, family };
    }

    static isValid(text: string): boolean {
        return Address.toNumber(text) !== null;
    }

    static isCidr(text: string): boolean {
        try {
            Address.split(text);
            return true;
        } catch {
            return false;
        }
    }

    private static mask(length: number, family: Family): bigint {
        const all = (1n << BigInt(Address.bits(family))) - 1n;
        const hostBits = (1n << BigInt(Address.bits(family) - length)) - 1n;
        return all ^ hostBits;
    }

    static fromNumber(value: bigint, family: Family): IP {
        if (family === "ipv4") {
            return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".") as IPv4;
        }

        const groups = Array.from({ length: Address.IPV6_GROUPS }, (_, index) =>
            ((value >> BigInt(Address.IPV6_BITS - (index + 1) * Address.IPV6_GROUP_BITS)) & 0xffffn).toString(Address.HEX)
        );

        // Compress the longest run of zero groups, as RFC 5952 asks.
        let longestStart = -1;
        let longestLength = 0;

        for (let start = 0; start < Address.IPV6_GROUPS;) {
            let end = start;
            while (end < Address.IPV6_GROUPS && groups[end] === "0") end++;

            const runLength = end - start;
            if (runLength > longestLength && runLength > 1) {
                longestStart = start;
                longestLength = runLength;
            }

            start = end === start ? start + 1 : end;
        }

        if (longestStart < 0) return groups.join(":") as IPv6;

        const head = groups.slice(0, longestStart).join(":");
        const tail = groups.slice(longestStart + longestLength).join(":");
        return `${head}::${tail}`;
    }

    /** An address, with or without its length, in one spelling: IPv6 as RFC 5952 writes it, so `2001:DB8:0:0::1` and `2001:db8::1` compare equal. Text that is not an address comes back as it is. */
    static canonical(text: string): string {
        const [address, length, ...rest] = text.split("/");
        const value = Address.toNumber(address!);
        // A list, `10.0.2.0/24,198.51.100.0/30`, is not one address, so it too comes back whole.
        const oneAddress = value !== null && !rest.length && (length === undefined || /^\d+$/.test(length));
        if (!oneAddress) return text;

        const spelled = Address.fromNumber(value, Address.family(address!));
        return length === undefined ? spelled : `${spelled}/${length}`;
    }

    /** An address or prefix with its length, `/32` or `/128` for one address, IPv6 as RFC 5952 writes it. */
    static withLength(text: string): string {
        const canonical = Address.canonical(text);
        return canonical.includes("/") ? canonical : `${canonical}/${Address.bits(Address.family(canonical))}`;
    }

    /** `10.0.0.1/24` to `10.0.0.0/24`. */
    static prefixOf(cidr: string): Prefix {
        const { addr, len, family } = Address.split(cidr);
        return `${Address.fromNumber(Address.toNumber(addr)! & Address.mask(len, family), family)}/${len}`;
    }

    /** Is the address or prefix `inner` inside `outer`? */
    static contains(outer: string, inner: string): boolean {
        const outerParts = Address.split(outer);
        const [innerAddress, innerLengthText] = inner.split("/");
        if (Address.family(innerAddress!) !== outerParts.family) return false;

        const innerLength = innerLengthText === undefined ? Address.bits(outerParts.family) : Number(innerLengthText);
        if (innerLength < outerParts.len) return false;

        const outerMask = Address.mask(outerParts.len, outerParts.family);
        return (Address.toNumber(innerAddress!)! & outerMask) === (Address.toNumber(outerParts.addr)! & outerMask);
    }

    static range(cidr: string): { first: bigint; last: bigint; family: Family } {
        const { addr, len, family } = Address.split(cidr);
        const hostBits = Address.mask(len, family) ^ ((1n << BigInt(Address.bits(family))) - 1n);
        const first = Address.toNumber(addr)! & Address.mask(len, family);

        return { first, last: first | hostBits, family };
    }

    /** The fewest prefixes that cover every address from `first` to `last` and nothing else. */
    static prefixesBetween(first: bigint, last: bigint, family: Family): Prefix[] {
        const bits = Address.bits(family);
        const prefixes: Prefix[] = [];

        for (let start = first; start <= last;) {
            // The largest block that starts here on its own boundary and does not pass `last`.
            let size = 0;
            while (size < bits && start % (1n << BigInt(size + 1)) === 0n && start + (1n << BigInt(size + 1)) - 1n <= last) size++;

            prefixes.push(`${Address.fromNumber(start, family)}/${bits - size}`);
            start += 1n << BigInt(size);
        }

        return prefixes;
    }

    /** `/25` to `255.255.255.128`. */
    static netmask(length: number): IPv4 {
        return Address.fromNumber(Address.mask(length, "ipv4"), "ipv4") as IPv4;
    }

    /** `/24` to `0.0.0.255`, the inverted mask some ACLs take. */
    static wildcard(length: number): IPv4 {
        return Address.fromNumber(Address.mask(length, "ipv4") ^ 0xffffffffn, "ipv4") as IPv4;
    }

    static host(cidr: string): IP {
        return cidr.split("/")[0]! as IP;
    }

    /** Whether another network can reach the address: the longest block of `GLOBALLY_REACHABLE` that holds it decides. */
    static isGlobal(address: string): boolean {
        const blocks = Object.keys(Address.GLOBALLY_REACHABLE).filter((block) => Address.contains(block, address));
        const longest = blocks.reduce((best, block) => (Address.split(block).len > Address.split(best).len ? block : best));

        return Address.GLOBALLY_REACHABLE[longest]!;
    }
}
