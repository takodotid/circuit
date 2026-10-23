// Address arithmetic for both families. Addresses are parsed to bigint so v4 and v6 share one code path.

import type { Family, IP, IPv4, IPv6, Prefix } from "../schema";

/** Address helpers, for checks of your own. */
export class Address {
    /** IPv4 space another network cannot reach: this host, private, shared, loopback, link-local and documentation, after RFC 6890. */
    private static readonly NOT_GLOBAL_V4 = [
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.2.0/24",
        "192.168.0.0/16",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
    ];

    static family(address: string): Family {
        return address.includes(":") ? "ipv6" : "ipv4";
    }

    /** How many bits an address of the family has: 32 or 128. */
    static bits(family: Family): number {
        return family === "ipv4" ? 32 : 128;
    }

    /** An address as a number, or null when it is not one. */
    static toNumber(address: string): bigint | null {
        if (!address.includes(":")) {
            const octets = address.split(".");
            const valid = octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
            if (!valid) return null;

            return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
        }

        const [before, after, extra] = address.split("::");
        if (extra !== undefined) return null;

        const groupsOf = (text: string | undefined) => (text ? text.split(":") : []);
        const leading = groupsOf(before);
        const trailing = groupsOf(after);

        // `::` stands for as many zero groups as make eight.
        const zeros = after === undefined ? 0 : 8 - leading.length - trailing.length;
        const groups = [...leading, ...Array(zeros).fill("0"), ...trailing];

        const valid = groups.length === 8 && groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group));
        if (!valid) return null;

        return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
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

    /** A number back to the address it stands for. */
    static fromNumber(value: bigint, family: Family): IP {
        if (family === "ipv4") {
            return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".") as IPv4;
        }

        const groups = Array.from({ length: 8 }, (_, index) => ((value >> BigInt(112 - index * 16)) & 0xffffn).toString(16));

        // Compress the longest run of zero groups, as RFC 5952 asks.
        let longestStart = -1;
        let longestLength = 0;

        for (let start = 0; start < 8;) {
            let end = start;
            while (end < 8 && groups[end] === "0") end++;

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
        const [address, length] = text.split("/");
        const value = Address.toNumber(address!);
        if (value === null) return text;

        const spelled = Address.fromNumber(value, Address.family(address!));
        return length === undefined ? spelled : `${spelled}/${length}`;
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

    /** The first and last address of a prefix, as numbers. */
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

    /** The address with its length dropped. */
    static host(cidr: string): IP {
        return cidr.split("/")[0]! as IP;
    }

    /** Whether another network can reach the address. IPv6 is global only inside 2000::/3, less documentation space. */
    static isGlobal(address: string): boolean {
        if (Address.family(address) === "ipv6") return Address.contains("2000::/3", address) && !Address.contains("2001:db8::/32", address);

        return !Address.NOT_GLOBAL_V4.some((prefix) => Address.contains(prefix, address));
    }
}
