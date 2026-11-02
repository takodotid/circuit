// Hijacks and leaks lesson: prefixes as numbers, and route origin validation as RFC 6811 defines it. OriginCheck.vue and HijackSpread.vue share it.

/** A prefix read into its family, its first address as a number, and its length. */
export type Parsed = { family: 4 | 6; value: bigint; length: number };

/** A ROA as a validator hands it to routers: a prefix, the longest length allowed inside it, and the one AS that may originate it. */
export type Roa = { prefix: string; maxLength: number; asn: number };

/** What origin validation says about a route. Invalid is split by the reason, which RFC 6811 does not name but a reader needs. */
export type Validity = "valid" | "invalid-origin" | "invalid-length" | "not-found";

export type Verdict = {
    state: Validity;
    /** The ROAs whose prefix holds the route's prefix. */
    covering: Roa[];
    /** The covering ROAs that also name the route's origin and allow its length. */
    matching: Roa[];
};

export class Rov {
    /** How many bits an address of the family has. */
    private static bits(family: 4 | 6) {
        return family === 4 ? 32 : 128;
    }

    private static parseIpv4(text: string): bigint | undefined {
        const parts = text.split(".");
        if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return undefined;
        return parts.reduce((sum, part) => sum * 256n + BigInt(part), 0n);
    }

    private static parseIpv6(text: string): bigint | undefined {
        const halves = text.split("::");
        if (halves.length > 2) return undefined;

        const groupsOf = (half: string) => (half === "" ? [] : half.split(":"));
        const head = groupsOf(halves[0]!);
        const tail = halves.length === 2 ? groupsOf(halves[1]!) : [];
        const missing = 8 - head.length - tail.length;

        if (halves.length === 1 && head.length !== 8) return undefined;
        if (halves.length === 2 && missing < 1) return undefined;

        const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
        if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;

        return groups.reduce((sum, group) => sum * 65536n + BigInt(parseInt(group, 16)), 0n);
    }

    /** A prefix such as `192.0.2.0/24` or `2001:db8:a00::/40`, or a sentence saying what is wrong with it. */
    static parsePrefix(text: string): Parsed | string {
        const [address, length, extra] = text.trim().split("/");
        if (!address || length === undefined || extra !== undefined || !/^\d{1,3}$/.test(length)) {
            return "Write a prefix with its length, such as 2001:db8:a00::/40.";
        }

        const family = address.includes(":") ? 6 : 4;
        const value = family === 4 ? Rov.parseIpv4(address) : Rov.parseIpv6(address);
        if (value === undefined) return `${address} is not an IPv${family} address.`;

        const bits = Number(length);
        if (bits > Rov.bits(family)) return `An IPv${family} prefix is at most /${Rov.bits(family)} long.`;

        const hostBits = BigInt(Rov.bits(family) - bits);
        if ((value >> hostBits) << hostBits !== value)
            return `${text.trim()} has bits set after the first ${bits}, so it is not where a /${bits} starts.`;

        return { family, value, length: bits };
    }

    /** A ROA covers a route when the route's prefix is the ROA's own or inside it. */
    static covers(roa: Parsed, route: Parsed): boolean {
        if (roa.family !== route.family || roa.length > route.length) return false;

        const shift = BigInt(Rov.bits(roa.family) - roa.length);
        return roa.value >> shift === route.value >> shift;
    }

    /**
     * Route origin validation, after RFC 6811: not found when no ROA covers the route; valid when a covering ROA names the route's origin and allows its length; invalid otherwise.
     *
     * An invalid route is called too long when a covering ROA names its origin but none allows its length, and of the wrong origin when no covering ROA names its origin at all.
     */
    static validate(roas: readonly Roa[], prefix: string, origin: number): Verdict {
        const route = Rov.parsePrefix(prefix);
        if (typeof route === "string") throw new Error(route);

        const covering = roas.filter((roa) => {
            const parsed = Rov.parsePrefix(roa.prefix);
            return typeof parsed !== "string" && Rov.covers(parsed, route);
        });

        const matching = covering.filter((roa) => roa.asn === origin && route.length <= roa.maxLength);

        if (covering.length === 0) return { state: "not-found", covering, matching };
        if (matching.length > 0) return { state: "valid", covering, matching };
        if (covering.some((roa) => roa.asn === origin)) return { state: "invalid-length", covering, matching };
        return { state: "invalid-origin", covering, matching };
    }

    /** Whether a prefix is the given one or inside it. */
    static inside(prefix: string, outer: string): boolean {
        const inner = Rov.parsePrefix(prefix);
        const block = Rov.parsePrefix(outer);
        return typeof inner !== "string" && typeof block !== "string" && Rov.covers(block, inner);
    }
}
