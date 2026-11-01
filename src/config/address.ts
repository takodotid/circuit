// `address`, a global beside `presets`: standard IP math for a project's own checks, IPv4 prefixes by RFC 4632 and IPv6 by RFC 4291,
// each address written back in its standard form (RFC 5952 for IPv6). Each helper takes an address alone, a /32 or a /128, or with its length.

import type { Family, IP, Prefix } from "./common";

/** An address alone, such as `10.0.0.1`, or with its length, such as `10.0.0.0/24` or `10.0.0.1/24`. */
export type AddressOrPrefix = IP | Prefix;

/** An address or prefix as numbers: the address written, and the first and last address of its range. */
function parse(text: string) {
    const bad = () => new Error(`address: ${JSON.stringify(text)} is not an IPv4 or IPv6 address, alone or with its length.`);
    const [ip = "", length, extra] = text.split("/");
    const v6 = ip.includes(":");
    const bits = v6 ? 128 : 32;
    const len = length === undefined ? bits : /^\d{1,3}$/.test(length) ? Number(length) : -1;
    if (extra !== undefined || len < 0 || len > bits) throw bad();

    let value = 0n;
    if (v6) {
        // An IPv4 address may end an IPv6 one, `::ffff:192.0.2.1` (RFC 4291, 2.2): it is the last two groups.
        let text6 = ip;
        const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
        if (tail) {
            const v4 = parse(tail[1]!).address;
            text6 = `${ip.slice(0, -tail[1]!.length)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
        }
        const halves = text6.split("::");
        const groups = (s: string) => (s === "" ? [] : s.split(":"));
        const head = groups(halves[0]!);
        const rest = halves.length === 2 ? groups(halves[1]!) : [];
        const zeros = 8 - head.length - rest.length;
        // `::` stands for one or more groups of zeros.
        if (halves.length > 2 || (halves.length === 2 ? zeros < 1 : zeros !== 0)) throw bad();
        const all = [...head, ...Array<string>(halves.length === 2 ? zeros : 0).fill("0"), ...rest];
        if (all.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) throw bad();
        for (const g of all) value = (value << 16n) + BigInt(parseInt(g, 16));
    } else {
        const parts = ip.split(".");
        if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) throw bad();
        for (const p of parts) value = (value << 8n) + BigInt(p);
    }
    const size = 1n << BigInt(bits - len);
    const first = value - (value % size);
    return { family: (v6 ? "ipv6" : "ipv4") as Family, address: value, first, last: first + size - 1n };
}

/** A number written as an address of `family`: dotted for IPv4; for IPv6 lowercase, no leading zeros, the longest run of two or more zero groups as `::`, the first if two tie (RFC 5952). */
function format(family: Family, n: bigint): IP {
    if (family === "ipv4") return [24n, 16n, 8n, 0n].map((s) => String((n >> s) & 255n)).join(".") as IP;
    const groups = [112n, 96n, 80n, 64n, 48n, 32n, 16n, 0n].map((s) => ((n >> s) & 0xffffn).toString(16));
    let best = { at: -1, length: 1 };
    for (let i = 0; i < 8; i++) {
        let j = i;
        while (j < 8 && groups[j] === "0") j++;
        if (j - i > best.length) best = { at: i, length: j - i };
    }
    if (best.at < 0) return groups.join(":") as IP;
    return `${groups.slice(0, best.at).join(":")}::${groups.slice(best.at + best.length).join(":")}` as IP;
}

/**
 * IP math for your own checks, by RFC 4632 (IPv4) and RFC 4291 (IPv6). Each takes an address alone (a /32 or a /128) or with its
 * length. An address it can't read is an error naming it.
 */
export const address = {
    /** Whether `inner` lies wholly inside `outer`, of the same family: `address.contains("10.0.0.0/8", "10.1.0.0/16")` is true. */
    contains(outer: AddressOrPrefix, inner: AddressOrPrefix): boolean {
        const a = parse(outer);
        const b = parse(inner);
        return a.family === b.family && a.first <= b.first && b.last <= a.last;
    },

    /** Whether `a` and `b` share any address: one contains the other. */
    overlaps(a: AddressOrPrefix, b: AddressOrPrefix): boolean {
        const x = parse(a);
        const y = parse(b);
        return x.family === y.family && x.first <= y.last && y.first <= x.last;
    },

    /** `ipv4` or `ipv6`. */
    family(x: AddressOrPrefix): Family {
        return parse(x).family;
    },

    /** The address without its length, in its standard form: `address.host("2001:db8:0:0::33/64")` is `2001:db8::33`. */
    host(x: AddressOrPrefix): IP {
        const p = parse(x);
        return format(p.family, p.address);
    },

    /** The first address of a prefix, its network address: `address.first("192.0.2.33/27")` is `192.0.2.32`. */
    first(x: AddressOrPrefix): IP {
        const p = parse(x);
        return format(p.family, p.first);
    },

    /** The last address of a prefix: `address.last("192.0.2.32/27")` is `192.0.2.63`. */
    last(x: AddressOrPrefix): IP {
        const p = parse(x);
        return format(p.family, p.last);
    },
};
