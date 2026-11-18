import type { ApplyOptions, Plan, Step } from "../platform";
import { JunosBgp } from "./bgp";

export class JunosPlan {
    /** Statements the device keeps for itself: the release it runs and the number it gives each user. */
    static readonly DEVICE_FACTS = [/^set version /, /^set system login user \S+ uid \d+$/];

    /** A value the device keeps hashed or encrypted, and the render writes as a marker, as one word both sides share. Each keeps the number of words. */
    private static readonly SECRETS: [RegExp, string][] = [
        [/ (?:encrypted-password|plain-text-password-value) (?:"[^"]*"|\S+)/, " password <secret>"],
        [/ (?:authentication-key|authentication-password) (?:"[^"]*"|\S+)/, " authentication-key <secret>"],
        [/ (?:privacy-key|privacy-password) (?:"[^"]*"|\S+)/, " privacy-key <secret>"],
        [/ (authentication md5 \d+ key) (?:"[^"]*"|\S+)/, " $1 <secret>"],
        [/^set snmp community (?:"[^"]*"|\S+)/, "set snmp community <secret>"],
    ];

    /** Lists whose entries are named: a delete cannot stop at the list, `delete interfaces xe-0/0/1 unit`, only at an entry, `unit 0`. A leaf-list such as `vlan members` or `ciphers` can go whole. */
    private static readonly NAMED_LISTS = new Set([
        "address",
        "area",
        "as-path",
        "class",
        "collector",
        "community",
        "family",
        "file",
        "filter",
        "group",
        "host",
        "interface",
        "interfaces",
        "neighbor",
        "oid",
        "policer",
        "policy-statement",
        "pool",
        "prefix",
        "prefix-list",
        "qualified-next-hop",
        "range",
        "rib",
        "route",
        "security-level",
        "security-model",
        "security-name",
        "server",
        "server-group",
        "session",
        "storm-control-profiles",
        "term",
        "trap-group",
        "unit",
        "user",
        "view",
        "vlan",
        "vrrp-group",
    ]);

    /** A statement only the render holds is set. One only the device holds is deleted at the shortest path that holds nothing the render wants, so a removed port goes whole and a changed value goes alone. */
    static of(desired: string, current: string, options: Pick<ApplyOptions, "secrets">): Plan {
        const lines = (text: string, verb: string) => text.split("\n").filter((line) => line.startsWith(`${verb} `));

        const wanted = lines(desired, "set");
        const deactivated = lines(current, "deactivate");
        const generated = desired
            .split("\n")
            .filter((line) => line.startsWith(JunosBgp.GENERATED))
            .map((line) => JunosPlan.wordsOf(line.slice(JunosBgp.GENERATED.length)).map(JunosPlan.bare));

        const printed = lines(current, "set").filter((line) => !JunosPlan.DEVICE_FACTS.some((fact) => fact.test(line)));

        // A path the render marks as generated, such as a prefix list `refresh` fills, keeps what the device holds.
        const isGenerated = (line: string) =>
            generated.some((path) => JunosPlan.keyOf(line).length > path.length && JunosPlan.startsWith(JunosPlan.keyOf(line), path));
        const existing = printed.filter((line) => !isGenerated(line));

        const join = (path: string[]) => path.join("\u0000");
        const wantedPaths = wanted.map(JunosPlan.keyOf);
        const wantedKeys = new Set(wantedPaths.map(join));
        const existingKeys = new Set(existing.map((line) => join(JunosPlan.keyOf(line))));

        const wantedUnder = (path: string[]) => wantedPaths.filter((other) => JunosPlan.startsWith(other, path));

        const sections = new Map<string, { show: string[]; activate: string[]; remove: string[]; add: string[] }>();
        const sectionFor = (path: string[]) => {
            const name = JunosPlan.sectionOf(path);
            if (!sections.has(name)) sections.set(name, { show: [], activate: [], remove: [], add: [] });
            return sections.get(name)!;
        };

        // Sections in the order the render lists them, then the ones only the device has.
        for (const path of wantedPaths) sectionFor(path);

        // An ordered block whose items or order differ from the device's is deleted and set again whole, in the render's order.
        const rewritten: string[][] = [];
        const blocks = new Map<string, string[]>();
        for (const path of wantedPaths) {
            const ordered = JunosPlan.orderedBlockOf(path);
            if (ordered) blocks.set(join(ordered.block), ordered.block);
        }

        for (const block of blocks.values()) {
            const inBlock = (line: string) => JunosPlan.startsWith(JunosPlan.keyOf(line), block);
            const order = (all: string[]) => [
                ...new Set(all.filter(inBlock).map((line) => JunosPlan.orderedBlockOf(JunosPlan.keyOf(line))!.item)),
            ];
            const keys = (all: string[]) =>
                all
                    .filter(inBlock)
                    .map((line) => join(JunosPlan.keyOf(line)))
                    .sort()
                    .join("\n");

            const wantedHere = wanted.filter(inBlock);
            const existingHere = existing.filter(inBlock);
            if (join(order(wanted)) === join(order(existing)) && keys(wanted) === keys(existing)) continue;

            rewritten.push(block);
            const section = sectionFor(block);

            if (existingHere.length)
                section.remove.push(
                    `delete ${JunosPlan.wordsOf(existingHere[0]!)
                        .slice(1, 1 + block.length)
                        .join(" ")}`
                );
            section.show.push(...existingHere.map((line) => `- ${line}`), ...wantedHere.map((line) => `+ ${line}`));
            section.add.push(...wantedHere);
        }

        const isRewritten = (line: string) => rewritten.some((block) => JunosPlan.startsWith(JunosPlan.keyOf(line), block));

        const removed: string[][] = [];

        for (const line of existing) {
            if (isRewritten(line)) continue;

            const path = JunosPlan.keyOf(line);
            if (wantedKeys.has(join(path))) continue;
            // The render extends this statement, so setting the longer one replaces it.
            if (wantedUnder(path).length) continue;

            let length = 1;
            while (wantedUnder(path.slice(0, length)).length) length++;
            while (length < path.length && !JunosPlan.canStopAt(path, length - 1)) length++;

            // A hidden value ends a path by its name alone. A hidden name in a list, such as a community, stays `<redacted>` for the session to name each entry.
            const hidden = path.indexOf("<secret>");
            if (hidden !== -1 && hidden < length && !JunosPlan.NAMED_LISTS.has(path[hidden - 1]!)) length = hidden;

            removed.push(JunosPlan.wordsOf(line).slice(1, 1 + length));
        }

        // A path inside another removed path goes with it.
        const isInside = (path: string[], other: string[]) =>
            other.length < path.length && other.every((word, index) => JunosPlan.bare(path[index]!) === JunosPlan.bare(word));
        const removals = removed.filter(
            (path, index) =>
                !removed.some((other) => isInside(path, other)) && removed.findIndex((other) => join(other) === join(path)) === index
        );

        const isRemoved = (line: string) => removals.some((path) => JunosPlan.startsWith(JunosPlan.keyOf(line), path.map(JunosPlan.bare)));

        for (const path of removals) {
            const section = sectionFor(path.map(JunosPlan.bare));
            section.remove.push(`delete ${path.join(" ")}`);

            const under = existing.filter((line) => JunosPlan.startsWith(JunosPlan.keyOf(line), path.map(JunosPlan.bare)));
            section.show.push(...under.map((line) => `- ${line}`));
        }

        for (const line of deactivated) {
            const path = JunosPlan.wordsOf(line).slice(1);
            if (!wantedUnder(path.map(JunosPlan.bare)).length) continue;

            const section = sectionFor(path.map(JunosPlan.bare));
            section.activate.push(`activate ${path.join(" ")}`);
            section.show.push(`+ activate ${path.join(" ")}`);
        }

        // A statement the device extends with one it keeps is there already: the device prints only the longest.
        const extended = (path: string[]) => printed.some((line) => !isRemoved(line) && JunosPlan.startsWith(JunosPlan.keyOf(line), path));

        for (const line of wanted) {
            if (isRewritten(line)) continue;

            const path = JunosPlan.keyOf(line);
            const isNew = !existingKeys.has(join(path)) && !extended(path);
            const rotated = options.secrets && line.includes("<secret:");
            if (!isNew && !rotated) continue;

            const section = sectionFor(path);
            section.add.push(line);
            section.show.push(`+ ${line}`);

            // A community is named by its value, so a new value is a second community. The device's go first.
            const clear = "delete snmp community <redacted>";
            if (rotated && line.startsWith("set snmp community ") && !section.remove.includes(clear)) section.remove.push(clear);
        }

        const steps: Step[] = [...sections]
            .filter(([, section]) => section.show.length)
            .map(([title, section]) => ({ title, show: section.show, send: [...section.activate, ...section.remove, ...section.add] }));

        return { steps, problems: [] };
    }

    /** A quoted value is one word, with its quotes. */
    static wordsOf(statement: string): string[] {
        return statement.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    }

    /** A word as the platform means it, without quotes or escapes, so a value quoted on one side and not on the other compares equal. */
    private static bare(word: string): string {
        return word.startsWith('"') ? word.slice(1, -1).replace(/\\(.)/g, "$1") : word;
    }

    /** A statement in the form both sides compare in: its words, secrets as one marker, quotes dropped. */
    private static keyOf(statement: string): string[] {
        let canonical = statement;
        for (const [pattern, replacement] of JunosPlan.SECRETS) canonical = canonical.replace(pattern, replacement);

        return JunosPlan.wordsOf(canonical).slice(1).map(JunosPlan.bare);
    }

    /** Whether a delete may stop after `path[index]`. Below the top level a named list may not; `vlan` names a list except in `vlan members`. */
    private static canStopAt(path: string[], index: number): boolean {
        if (index === 0 || !JunosPlan.NAMED_LISTS.has(path[index]!)) return true;

        return path[index] === "vlan" && path[index + 1] === "members";
    }

    /** The section a statement belongs to, for a reviewer: `interfaces xe-0/0/1`, `system login`, `snmp`. */
    private static sectionOf(path: string[]): string {
        return path.slice(0, 2).join(" ");
    }

    /** The ordered block a statement sits in, and its item there: a policy's or a filter's term, or one policy of an import or export chain. The device keeps their order, and `set` adds at the end. */
    private static orderedBlockOf(path: string[]): { block: string[]; item: string } | undefined {
        if (path[0] === "policy-options" && path[1] === "policy-statement" && path[3] === "term") {
            return { block: path.slice(0, 3), item: path[4]! };
        }

        if (path[0] === "firewall" && path[1] === "family" && path[3] === "filter" && path[5] === "term") {
            return { block: path.slice(0, 5), item: path[6]! };
        }

        const chain = path.length - 2;
        if (path[0] === "protocols" && (path[chain] === "import" || path[chain] === "export")) {
            return { block: path.slice(0, chain + 1), item: path[chain + 1]! };
        }

        return undefined;
    }

    private static startsWith(path: string[], prefix: string[]): boolean {
        return prefix.every((word, index) => path[index] === word);
    }
}
