// Lesson: reading an IP address. Reading, splitting and writing IPv4 addresses, shared by PrefixSlider and SameNetwork.

/** An IPv4 address as one whole number from 0 to 4294967295, or why the text is not one. */
export function parseAddress(text: string): { value: number } | { error: string } {
    const trimmed = text.trim();
    if (!trimmed) return { error: "Type an address first, such as 192.168.1.37." };

    const parts = trimmed.split(".");
    if (parts.length !== 4) {
        return {
            error: `An address is four numbers with a dot between each, such as 192.168.1.37. This one has ${parts.length} ${parts.length === 1 ? "part" : "parts"}.`,
        };
    }

    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) {
            return {
                error:
                    part === ""
                        ? "One of the four parts is empty. Put a number between each pair of dots."
                        : `"${part}" is not a number from 0 to 255. Use only digits and dots.`,
            };
        }

        const number = Number(part);
        if (number > 255) {
            return { error: `${number} is too big. Each part is eight bits, and eight bits go up to 255.` };
        }

        value = value * 256 + number;
    }

    return { value };
}

/** The four parts of an address, such as [192, 168, 1, 37]. */
export function partsOf(value: number): number[] {
    return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256);
}

/** An address written the usual way, such as "192.168.1.37". */
export function formatAddress(value: number): string {
    return partsOf(value).join(".");
}

/** The 32 bits of an address, from the left. */
export function bitsOfAddress(value: number): number[] {
    return Array.from({ length: 32 }, (_, index) => Math.floor(value / 2 ** (31 - index)) % 2);
}

/** How many addresses a block with this prefix length holds. */
export function blockSize(prefix: number): number {
    return 2 ** (32 - prefix);
}

/** The mask for a prefix length, as one whole number: the network bits are 1, the host bits 0. */
export function maskOf(prefix: number): number {
    return 2 ** 32 - blockSize(prefix);
}

/** The first address of the block the address is in: the network address. */
export function networkOf(value: number, prefix: number): number {
    const size = blockSize(prefix);
    return Math.floor(value / size) * size;
}

/** The last address of the block the address is in: the broadcast address. */
export function broadcastOf(value: number, prefix: number): number {
    return networkOf(value, prefix) + blockSize(prefix) - 1;
}

/** A number written with commas between thousands, such as "65,536". */
export function countText(count: number): string {
    return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The ranges set aside for use inside homes and offices. */
export const privateRanges = [
    { network: 10 * 2 ** 24, prefix: 8, text: "10.0.0.0/8" },
    { network: (172 * 256 + 16) * 2 ** 16, prefix: 12, text: "172.16.0.0/12" },
    { network: (192 * 256 + 168) * 2 ** 16, prefix: 16, text: "192.168.0.0/16" },
];

/** The private range an address is in, if any. */
export function privateRangeOf(value: number) {
    return privateRanges.find((range) => networkOf(value, range.prefix) === range.network);
}
