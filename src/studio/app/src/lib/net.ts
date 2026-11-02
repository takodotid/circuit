// Address arithmetic for the browser, for both families, as src/core/address.ts does it for Circuit: addresses as numbers, so IPv4 and IPv6 share one path.

export type Family = "ipv4" | "ipv6";
export type Range = { family: Family; first: bigint; last: bigint; length: number };

export class Net {
    private static bits(family: Family): number {
        return family === "ipv4" ? 32 : 128;
    }

    /** An address as a number, or undefined when the text is not one. */
    static parseAddress(text: string): { family: Family; value: bigint } | undefined {
        if (!text.includes(":")) {
            const octets = text.split(".");
            if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return undefined;
            return { family: "ipv4", value: octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n) };
        }

        const [before, after, extra] = text.split("::");
        if (extra !== undefined || before === undefined) return undefined;

        const groupsOf = (part: string | undefined) => (part ? part.split(":") : []);
        const leading = groupsOf(before);
        const trailing = groupsOf(after);

        // `::` stands for as many zero groups as make eight.
        const zeros = after === undefined ? 0 : 8 - leading.length - trailing.length;
        if (zeros < 0) return undefined;
        const groups = [...leading, ...Array<string>(zeros).fill("0"), ...trailing];
        if (groups.length !== 8 || !groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return undefined;

        return { family: "ipv6", value: groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n) };
    }

    /** A prefix, or a lone address as the prefix of just itself, as the range of numbers it covers. Undefined when the text is neither. */
    static parseRange(text: string): Range | undefined {
        const [addressText, lengthText] = text.split("/");
        const address = Net.parseAddress(addressText ?? "");
        if (!address) return undefined;

        const bits = Net.bits(address.family);
        const length = lengthText === undefined ? bits : Number(lengthText);
        if (!Number.isInteger(length) || length < 0 || length > bits) return undefined;

        const hostBits = (1n << BigInt(bits - length)) - 1n;
        const first = address.value & ~hostBits & ((1n << BigInt(bits)) - 1n);
        return { family: address.family, first, last: first | hostBits, length };
    }

    /** Whether a prefix, or an address, holds an address or a whole other prefix. */
    static covers(outer: string, inner: string): boolean {
        const a = Net.parseRange(outer);
        const b = Net.parseRange(inner);
        return Boolean(a && b && a.family === b.family && a.first <= b.first && b.last <= a.last);
    }

    /** The same address, however it is written. */
    static sameAddress(a: string, b: string): boolean {
        const x = Net.parseAddress(a.split("/")[0] ?? "");
        const y = Net.parseAddress(b.split("/")[0] ?? "");
        return Boolean(x && y && x.family === y.family && x.value === y.value);
    }

    /** How long a prefix is, or the family's whole length for a lone address. */
    static lengthOf(text: string): number {
        return Net.parseRange(text)?.length ?? 0;
    }
}
