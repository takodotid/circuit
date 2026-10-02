// Address arithmetic for both families. Addresses are parsed to bigint so v4 and v6 share one code path.

import type { Family } from "../schema";

export const familyOf = (address: string): Family => (address.includes(":") ? "ipv6" : "ipv4");

const bitsOf = (family: Family) => (family === "ipv4" ? 32 : 128);

/** An address as a number, or null when it is not one. */
export function parse(address: string): bigint | null {
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
export function split(cidr: string): { addr: string; len: number; family: Family } {
    const [address, lengthText] = cidr.split("/");
    const family = familyOf(address!);
    const length = Number(lengthText);

    const valid =
        parse(address!) !== null && lengthText !== undefined && Number.isInteger(length) && length >= 0 && length <= bitsOf(family);
    if (!valid) throw new Error(`'${cidr}' is not an address with a length`);

    return { addr: address!, len: length, family };
}

export const isAddress = (text: string) => parse(text) !== null;

export function isCidr(text: string): boolean {
    try {
        split(text);
        return true;
    } catch {
        return false;
    }
}

const mask = (length: number, family: Family) => {
    const all = (1n << BigInt(bitsOf(family))) - 1n;
    const hostBits = (1n << BigInt(bitsOf(family) - length)) - 1n;
    return all ^ hostBits;
};

function format(value: bigint, family: Family): string {
    if (family === "ipv4") {
        return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".");
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

    if (longestStart < 0) return groups.join(":");

    const head = groups.slice(0, longestStart).join(":");
    const tail = groups.slice(longestStart + longestLength).join(":");
    return `${head}::${tail}`;
}

/** `10.0.0.1/24` to `10.0.0.0/24`. */
export function network(cidr: string): string {
    const { addr, len, family } = split(cidr);
    return `${format(parse(addr)! & mask(len, family), family)}/${len}`;
}

/** Is the address or prefix `inner` inside `outer`? */
export function contains(outer: string, inner: string): boolean {
    const outerParts = split(outer);
    const [innerAddress, innerLengthText] = inner.split("/");
    if (familyOf(innerAddress!) !== outerParts.family) return false;

    const innerLength = innerLengthText === undefined ? bitsOf(outerParts.family) : Number(innerLengthText);
    if (innerLength < outerParts.len) return false;

    const outerMask = mask(outerParts.len, outerParts.family);
    return (parse(innerAddress!)! & outerMask) === (parse(outerParts.addr)! & outerMask);
}

/** `/25` to `255.255.255.128`. */
export const netmask = (length: number) => format(mask(length, "ipv4"), "ipv4");

/** `/24` to `0.0.0.255`, the inverted mask some ACLs take. */
export const wildcard = (length: number) => format(mask(length, "ipv4") ^ 0xffffffffn, "ipv4");

/** The address with its length dropped. */
export const host = (cidr: string) => cidr.split("/")[0]!;

/** IPv4 space another network cannot reach: this host, private, shared, loopback, link-local and documentation, after RFC 6890. */
const NOT_GLOBAL_V4 = [
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

/** Whether another network can reach the address. IPv6 is global only inside 2000::/3, less documentation space. */
export function isGlobal(address: string): boolean {
    if (familyOf(address) === "ipv6") return contains("2000::/3", address) && !contains("2001:db8::/32", address);

    return !NOT_GLOBAL_V4.some((prefix) => contains(prefix, address));
}
