// IPv6 lesson: reading an address in any of its written forms, writing it in full, and shortening it the standard way (RFC 5952).

/** The eight 16-bit groups of an address, or the reason the text is not an IPv6 address. */
export function parseIPv6(text: string): { groups: number[] } | { error: string } {
    const written = text.trim();

    if (!written) return { error: "Type an address first." };
    if (/[^0-9a-fA-F:]/.test(written)) {
        if (written.includes("."))
            return {
                error: "This has an IPv4 address written inside it. That form exists, but this widget only takes the eight groups of hexadecimal digits.",
            };
        if (written.includes("/")) return { error: "Leave out the slash and the length: type the address alone." };
        return { error: "An IPv6 address only has the digits 0 to 9, the letters a to f, and colons." };
    }

    const halves = written.split("::");
    if (halves.length > 2)
        return {
            error: "There is more than one ::. It may appear only once, or nobody could tell how many zero groups each one stands for.",
        };

    const groupsOf = (half: string) => (half === "" ? [] : half.split(":"));
    const head = groupsOf(halves[0]!);
    const tail = halves.length === 2 ? groupsOf(halves[1]!) : [];

    for (const group of [...head, ...tail]) {
        if (group === "") return { error: "There is an empty group between two single colons. Only :: may stand for zero groups." };
        if (group.length > 4) return { error: `The group ${group} has more than four digits. Each group has at most four.` };
    }

    const writtenCount = head.length + tail.length;

    if (halves.length === 1 && writtenCount !== 8)
        return { error: `This has ${writtenCount} groups. Without ::, an address needs all eight.` };
    if (halves.length === 2 && writtenCount > 7)
        return { error: "With :: there can be at most seven written groups, since :: stands for at least one zero group." };

    const missing = 8 - writtenCount;
    const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((group) => parseInt(group, 16));

    return { groups };
}

/** Every group as four lowercase digits: 2001:0db8:0000:... */
export function expand(groups: readonly number[]): string {
    return groups.map((group) => group.toString(16).padStart(4, "0")).join(":");
}

/** The longest run of two or more zero groups, the first one when two runs are as long; undefined when there is none. */
export function longestZeroRun(groups: readonly number[]): { start: number; length: number } | undefined {
    let best: { start: number; length: number } | undefined;
    let start = -1;

    for (let index = 0; index <= groups.length; index++) {
        const zero = index < groups.length && groups[index] === 0;

        if (zero && start < 0) start = index;

        if (!zero && start >= 0) {
            const length = index - start;
            if (length >= 2 && (!best || length > best.length)) best = { start, length };
            start = -1;
        }
    }

    return best;
}

/** The standard short form: lowercase, no leading zeros, and the longest run of two or more zero groups as ::. */
export function shorten(groups: readonly number[]): string {
    const plain = groups.map((group) => group.toString(16));
    const run = longestZeroRun(groups);

    if (!run) return plain.join(":");

    const before = plain.slice(0, run.start).join(":");
    const after = plain.slice(run.start + run.length).join(":");

    return `${before}::${after}`;
}

/** Why a written form of an address is not its standard short form. Empty when it is. */
export function differences(written: string, groups: readonly number[]): string[] {
    const text = written.trim();
    const reasons: string[] = [];
    const standard = shorten(groups);

    if (text === standard) return reasons;

    if (/[A-F]/.test(text)) reasons.push("The letters should be lowercase.");

    const halves = text.split("::");
    const writtenGroups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));

    if (writtenGroups.some((group) => group.length > 1 && group.startsWith("0")))
        reasons.push("Some groups still start with a zero that can be dropped, such as 0db8 for db8.");

    const run = longestZeroRun(groups);

    if (halves.length === 2) {
        const head = halves[0] === "" ? 0 : halves[0]!.split(":").length;
        const tail = halves[1] === "" ? 0 : halves[1]!.split(":").length;
        const covered = 8 - head - tail;

        const inside = run !== undefined && head >= run.start && head + covered <= run.start + run.length;

        if (covered === 1 && !inside)
            reasons.push("The :: stands for a single zero group. A single zero is written as 0, and :: is kept for two or more.");
        else if (run && covered < run.length && inside)
            reasons.push("The :: should take in the whole run of zero groups, with no 0 left beside it.");
        else if (run && covered < run.length)
            reasons.push("The :: is not on the longest run of zero groups. It should replace the longest one.");
        else if (run && head !== run.start)
            reasons.push(
                "The :: is not on the first of the longest runs of zero groups. When two runs are as long, the first one is shortened."
            );
    } else if (run) {
        reasons.push(`There are ${run.length} zero groups in a row that can be written as ::.`);
    }

    if (!reasons.length) reasons.push(`The standard short form is ${standard}.`);

    return reasons;
}

/** Whether two addresses are the same. */
export function same(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((group, index) => group === b[index]);
}
