// @ts-check
// Address arithmetic for the browser, for both families, as src/core/address.ts does it for Circuit: addresses as numbers, so IPv4 and IPv6 share one path.

/** @typedef {"ipv4" | "ipv6"} Family */
/** @typedef {{ family: Family, value: bigint }} Address */
/** @typedef {{ family: Family, first: bigint, last: bigint, length: number }} Range */

export class Net {
    /** @param {Family} family */
    static #bits(family) {
        return family === "ipv4" ? 32 : 128;
    }

    /**
     * An address as a number, or undefined when the text is not one.
     *
     * @param {string} text
     * @returns {Address | undefined}
     */
    static parseAddress(text) {
        if (!text.includes(":")) {
            const octets = text.split(".");
            if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return undefined;
            return { family: "ipv4", value: octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n) };
        }

        const [before, after, extra] = text.split("::");
        if (extra !== undefined || before === undefined) return undefined;

        /** @param {string | undefined} part */
        const groupsOf = (part) => (part ? part.split(":") : []);
        const leading = groupsOf(before);
        const trailing = groupsOf(after);

        // `::` stands for as many zero groups as make eight.
        const zeros = after === undefined ? 0 : 8 - leading.length - trailing.length;
        if (zeros < 0) return undefined;
        const groups = [...leading, ...Array(zeros).fill("0"), ...trailing];
        if (groups.length !== 8 || !groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return undefined;

        return { family: "ipv6", value: groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n) };
    }

    /**
     * A prefix, or a lone address as the prefix of just itself, as the range of numbers it covers. Undefined when the text is neither.
     *
     * @param {string} text
     * @returns {Range | undefined}
     */
    static parseRange(text) {
        const [addressText, lengthText] = text.split("/");
        const address = Net.parseAddress(addressText ?? "");
        if (!address) return undefined;

        const bits = Net.#bits(address.family);
        const length = lengthText === undefined ? bits : Number(lengthText);
        if (!Number.isInteger(length) || length < 0 || length > bits) return undefined;

        const hostBits = (1n << BigInt(bits - length)) - 1n;
        const first = address.value & ~hostBits & ((1n << BigInt(bits)) - 1n);
        return { family: address.family, first, last: first | hostBits, length };
    }

    /**
     * Whether a prefix, or an address, holds an address or a whole other prefix.
     *
     * @param {string} outer
     * @param {string} inner
     */
    static covers(outer, inner) {
        const a = Net.parseRange(outer);
        const b = Net.parseRange(inner);
        return Boolean(a && b && a.family === b.family && a.first <= b.first && b.last <= a.last);
    }

    /**
     * The same prefix, however it is written: same family, same length, same network.
     *
     * @param {string} a
     * @param {string} b
     */
    static samePrefix(a, b) {
        const x = Net.parseRange(a);
        const y = Net.parseRange(b);
        return Boolean(x && y && x.family === y.family && x.length === y.length && x.first === y.first);
    }

    /**
     * The family of an address or prefix, or undefined when it is not one.
     *
     * @param {string} text
     */
    static family(text) {
        return Net.parseRange(text)?.family;
    }

    /**
     * A number back to the address it stands for, with IPv6 written short as RFC 5952 asks.
     *
     * @param {bigint} value
     * @param {Family} family
     */
    static formatAddress(value, family) {
        if (family === "ipv4") return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".");

        const groups = Array.from({ length: 8 }, (_, index) => ((value >> BigInt(112 - index * 16)) & 0xffffn).toString(16));

        // The longest run of two or more zero groups becomes `::`.
        let start = -1;
        let length = 0;
        for (let at = 0; at < 8;) {
            let end = at;
            while (end < 8 && groups[end] === "0") end++;
            if (end - at > length && end - at > 1) {
                start = at;
                length = end - at;
            }
            at = end === at ? at + 1 : end;
        }

        if (start < 0) return groups.join(":");
        return `${groups.slice(0, start).join(":")}::${groups.slice(start + length).join(":")}`;
    }

    /**
     * The network a prefix or interface address is in, such as `10.0.0.0/24` for `10.0.0.1/24`.
     *
     * @param {string} text
     */
    static prefixOf(text) {
        const range = Net.parseRange(text);
        return range ? `${Net.formatAddress(range.first, range.family)}/${range.length}` : text;
    }
}
