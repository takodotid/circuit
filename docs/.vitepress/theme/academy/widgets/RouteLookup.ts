// Routing tables lesson: IPv4 addresses and prefixes as numbers, and the longest match a router makes with them.

export type Prefix = { network: number; length: number };

export type Route = {
    prefix: Prefix;
    /** Where matching traffic goes. */
    via?: string;
    interface?: string;
    blackhole?: boolean;
    kind: "connected" | "static";
    description?: string;
};

export class RouteTable {
    /** An IPv4 address as a 32-bit number, or undefined when the text is not one. */
    static parseIPv4(text: string): number | undefined {
        const parts = text.trim().split(".");
        if (parts.length !== 4) return undefined;

        let value = 0;

        for (const part of parts) {
            if (!/^\d{1,3}$/.test(part)) return undefined;

            const number = Number(part);
            if (number > 255) return undefined;

            value = value * 256 + number;
        }

        return value;
    }

    static formatIPv4(value: number): string {
        return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
    }

    /** The mask of a prefix length as a 32-bit number: /24 is 255.255.255.0. */
    static maskOf(length: number): number {
        return length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0;
    }

    /** A prefix such as 10.0.0.0/8, or the reason the text is not one. */
    static parsePrefix(text: string): { prefix: Prefix } | { error: string } {
        const [address, length, ...rest] = text.trim().split("/");
        const network = RouteTable.parseIPv4(address ?? "");

        if (network === undefined || rest.length)
            return {
                error: `${text.trim() || "An empty box"} is not a prefix. Write it as an address, a slash and a length, such as 10.0.0.0/8.`,
            };
        if (length === undefined || !/^\d{1,2}$/.test(length) || Number(length) > 32)
            return { error: "The length after the slash must be a number from 0 to 32." };

        const bits = Number(length);
        const masked = (network & RouteTable.maskOf(bits)) >>> 0;

        if (masked !== network)
            return {
                error: `${text.trim()} has bits set after the first ${bits}. The prefix that holds it is ${RouteTable.formatIPv4(masked)}/${bits}.`,
            };

        return { prefix: { network, length: bits } };
    }

    static formatPrefix(prefix: Prefix): string {
        return `${RouteTable.formatIPv4(prefix.network)}/${prefix.length}`;
    }

    /** Whether the address is inside the prefix: its first `length` bits are the same as the prefix's. */
    static contains(prefix: Prefix, address: number): boolean {
        const mask = RouteTable.maskOf(prefix.length);
        return (address & mask) >>> 0 === prefix.network;
    }

    /** The first bit, counted from 1, where the address and the prefix differ, or undefined when they agree on every bit of the prefix. */
    static firstDifference(prefix: Prefix, address: number): number | undefined {
        for (let bit = 1; bit <= prefix.length; bit++) {
            const shift = 32 - bit;
            const ours = Math.floor(prefix.network / 2 ** shift) % 2;
            const theirs = Math.floor(address / 2 ** shift) % 2;
            if (ours !== theirs) return bit;
        }

        return undefined;
    }

    /** The 32 bits of an address, as text. */
    static bitsOf(value: number): string {
        return value.toString(2).padStart(32, "0");
    }

    /** Every route that holds the address, and the one a router uses: the longest prefix, then the lowest distance (connected before static). */
    static lookup<R extends Route>(table: readonly R[], address: number): { matches: R[]; winner?: R } {
        const matches = table.filter((route) => RouteTable.contains(route.prefix, address));
        const distance = (route: R) => (route.kind === "connected" ? 0 : 1);

        const winner = matches.reduce<R | undefined>((best, route) => {
            if (!best) return route;
            if (route.prefix.length !== best.prefix.length) return route.prefix.length > best.prefix.length ? route : best;
            return distance(route) < distance(best) ? route : best;
        }, undefined);

        return { matches, winner };
    }
}
