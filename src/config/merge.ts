// `merge`, by MODEL.md's Merge rules for a language with import, and the types that check a merge in the editor. Each map remembers the file that wrote each of its keys, so an error names both.

/** Where each key of a map was written, `file:line`. Not enumerable, so the JSON never shows it. */
const WRITTEN = Symbol("written in");

/** For a key written through a function in `lib/`, the line in `lib/` that called Circuit, `file:line`. Not enumerable either. */
const INNER = Symbol("written through");

type Obj = Record<string, unknown>;
const isMap = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Circuit's own folder, the one above this file's: its files are left out when looking for the user's file on the stack. */
const CIRCUIT = decodeURIComponent(new URL("..", import.meta.url).pathname)
    .replace(/^\/([A-Za-z]:)/, "$1")
    .toLowerCase();

/** Whether a file on the stack is one of Circuit's own. */
const isCircuit = (file: string) => file.replaceAll("\\", "/").toLowerCase().startsWith(CIRCUIT);

/**
 * The user's frames on the stack of `error`, innermost first, each `file:line`. A frame of code outside any function, such as a device
 * file's own lines, is `at /path/file.ts:3:16` on Linux and macOS, with no brackets: the `at ` is not part of the file.
 */
export function userFrames(error: Error = new Error()): string[] {
    return (error.stack ?? "")
        .split("\n")
        .map((line) => /\(?((?:[A-Za-z]:)?[^():]+\.ts):(\d+)/.exec(line.replace(/^\s*at\s+/, "")))
        .filter((m): m is RegExpExecArray => !!m && !isCircuit(m[1]!))
        .map((m) => `${m[1]!.trim()}:${m[2]}`);
}

/**
 * The user's file and line that called into Circuit: the outermost frame outside Circuit. A part a function in `lib/` builds is
 * named after the file that called that function, such as the tenant's file, which is the one to change.
 */
export const caller = (): string => userFrames().at(-1) ?? "?";

/** The innermost frame outside Circuit, such as the line in `lib/` that called `part`. */
export const innerCaller = (): string => userFrames()[0] ?? "?";

/** Marks every map in a value as written in `file`, and through `inner` when that is another line, where nothing marked it before. */
export function mark<T>(value: T, file: string, inner = file): T {
    if (Array.isArray(value)) value.forEach((v) => mark(v, file, inner));
    else if (isMap(value)) {
        if (!Object.hasOwn(value, WRITTEN)) {
            Object.defineProperty(value, WRITTEN, { value: Object.fromEntries(Object.keys(value).map((k) => [k, file])) });
            if (inner !== file)
                Object.defineProperty(value, INNER, { value: Object.fromEntries(Object.keys(value).map((k) => [k, inner])) });
        }
        for (const v of Object.values(value)) mark(v, file, inner);
    }
    return value;
}

/** Where each key of a map was written, for an error that names the file. */
export const writtenIn = (map: object, key: string): string => (map as { [WRITTEN]?: Record<string, string> })[WRITTEN]?.[key] ?? "?";

/** The line in `lib/` a key was written through, or nothing. */
const innerIn = (map: object, key: string): string | undefined => (map as { [INNER]?: Record<string, string> })[INNER]?.[key];

/** Reads a file of the project as its lines. Circuit gives it when it reads a project (src/project/project.ts): the project's editor has no Node types, so this file reads none itself. */
export const source = { read: (_file: string): string => "" };

/** Each file's lines, read once. */
const lines = new Map<string, string[]>();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * From `written`, `file:line`, the first line at or after it that writes each of `path` in turn, as `file:line`, or undefined when the last
 * of `path` is not found. A key not found before the last is skipped.
 */
function find(written: string, path: string[]): string | undefined {
    const colon = written.lastIndexOf(":");
    if (colon < 0) return undefined;
    const file = written.slice(0, colon);
    let line = Number(written.slice(colon + 1)) - 1;
    if (!lines.has(file))
        try {
            lines.set(file, source.read(file).split("\n"));
        } catch {
            lines.set(file, []);
        }
    const text = lines.get(file)!;
    let found = -1;
    path.forEach((name, p) => {
        const writes = new RegExp(`(^|[\\s{,])(["']?)${escape(name)}\\2\\s*:`);
        const i = text.findIndex((t, n) => n >= line && !t.trim().startsWith("//") && writes.test(t));
        if (i >= 0) line = found = i;
        else if (p === path.length - 1) found = -1;
    });
    return found >= 0 ? `${file}:${found + 1}` : undefined;
}

/**
 * Where `key` of `map` is written, as `file:line: `, or nothing when no file is known. `writtenIn` knows the line that made the map (a
 * network's `device()`, a `literal`, a `part`); from there, the file is read for the first line that writes each of `path` in turn,
 * `path` ending in the key: `["vlans", "exchange-a"]`. A key written through `lib/` is looked for there first. When the key is not found,
 * the line that made the map stays.
 */
export function writtenAt(map: unknown, key: string, path: string[] = [key]): string {
    const outer = writtenIn(map as object, key);
    const inner = innerIn(map as object, key);
    const at = (inner && find(inner, path)) ?? find(outer, path) ?? (outer === "?" ? undefined : outer);
    return at ? `${at}: ` : "";
}

/** From `written`, `file:line`, the line that writes the last of `path`, as `file:line: `; `written` itself when it is not found. */
export const lineOf = (written: string, path: string[]): string => `${find(written, path) ?? written}: `;

/**
 * An ordered list, by its path: a chain's rules, NAT, an ACL, a route policy, policy routing. Under a source, the hostname comes
 * first (`edge-01.firewall.nat.source`). It is written whole in one place, never joined.
 */
const ORDERED =
    /(^|\.)(firewall\.filter\.[^.]+\.rules|firewall\.nat\.(source|destination)|switching\.acls\.[^.]+|routing\.policies\.[^.]+|routing\.policy_routing)$/;
export const isOrdered = (path: string) => ORDERED.test(path);

/** A value that is one value, compared whole and never merged key by key: a secret, a link, a threshold, a port range. */
const isOneValue = (key: string, v: Obj) =>
    key === "link" ||
    "secret" in v ||
    "secret_file" in v ||
    "pps" in v ||
    "percent" in v ||
    ("min" in v && "max" in v && Object.keys(v).length === 2);

/** Marks a rule list `part` made. Not enumerable, so nothing else sees it. */
const RULE_LIST = Symbol("rule list");
export const ruleList = <T extends object>(list: T): T => Object.defineProperty(list, RULE_LIST, { value: true });
const isRuleList = (v: unknown) => Array.isArray(v) && Object.hasOwn(v, RULE_LIST);

/**
 * Merges `b` into a copy of `a`. Two rule lists `part` made, at one path that is no ordered list, join in order with every rule kept:
 * each tenant's router input rules, one tenant after another, for the router to place.
 */
function mergeTwo(a: Obj, b: Obj, path: string): Obj {
    const out: Obj = { ...a };
    const written: Record<string, string> = {};
    const inner: Record<string, string> = {};
    const note = (from: Obj, key: string) => {
        written[key] = writtenIn(from, key);
        const through = innerIn(from, key);
        if (through) inner[key] = through;
        else delete inner[key];
    };
    for (const key of Object.keys(a)) note(a, key);

    for (const [key, value] of Object.entries(b)) {
        const here = path ? `${path}.${key}` : key;
        if (!(key in out)) {
            out[key] = value;
            note(b, key);
            continue;
        }
        const old = out[key];
        const both = `in ${written[key]} and in ${writtenIn(b, key)}`;
        if (Array.isArray(old) && Array.isArray(value) && isOrdered(here))
            throw new Error(
                `${here} is an ordered list, written ${both}. Write it whole in one place, and place the other's rules in it with merge.`
            );
        if (isRuleList(old) && isRuleList(value)) out[key] = ruleList([...(old as unknown[]), ...(value as unknown[])]);
        else if (Array.isArray(old) && Array.isArray(value)) out[key] = [...old, ...value.filter((v) => !old.some((o) => same(o, v)))];
        else if (isMap(old) && isMap(value) && !isOneValue(key, old) && !isOneValue(key, value)) out[key] = mergeTwo(old, value, here);
        else if (!same(old, value))
            throw new Error(
                `${here} is written twice with two values: ${JSON.stringify(old)} in ${written[key]}, and ${JSON.stringify(value)} in ${writtenIn(b, key)}. One name holds one value: rename one, or make both the same.`
            );
    }

    Object.defineProperty(out, WRITTEN, { value: written });
    if (Object.keys(inner).length) Object.defineProperty(out, INNER, { value: inner });
    return out;
}

/** Merges parts in order. The file of a part not marked yet is `file`. */
export function mergeAll(parts: readonly unknown[], file: string, path = ""): Obj {
    let out: Obj = {};
    for (const part of parts) if (part !== undefined) out = mergeTwo(out, mark(part as Obj, file), path);
    return out;
}

// ---------- `merge([...])`: one list or one map, by where it lands ----------

/** What a `merge` call was given, flat, and the file that called it. Not enumerable, so nothing else sees it. */
const MADE = Symbol("merge items");
type Made = { [MADE]: { values: readonly unknown[]; file: string } };
const madeBy = (v: unknown) => (v && typeof v === "object" && Object.hasOwn(v, MADE) ? (v as Made)[MADE] : undefined);

/** The items, flat: a list in the items gives its own items in its place, in order. */
const flat = (items: readonly unknown[]): unknown[] => items.flatMap((v) => (Array.isArray(v) ? flat(v) : [v]));

/**
 * What `merge` returns before it lands: a list when an item is a list or no map, else the maps merged. The same rule the editor uses
 * for a `merge` that lands in no field. Where it lands decides (`resolve`).
 */
export function made(items: readonly unknown[], file: string): object {
    const values = flat(items);
    // One map given twice, such as a tenant: its data would be kept once and its rules twice, and nothing would say so.
    if (values.some((v, i) => isMap(v) && values.indexOf(v) !== i))
        throw new Error(`${file}: merge is given the same value twice. Give each once.`);
    const isList = items.some(Array.isArray) || values.some((v) => !isMap(v));
    let out: object = [...values];
    if (!isList)
        try {
            out = mergeAll(values, file);
        } catch (error) {
            // Maps that clash may be single rules, which a list field takes as they are: they stay a list until they land (`resolve`).
            // A field of them read before, such as `tenants.parts` of two tenants with one VLAN name, says what clashed, naming both
            // values and where each is written, not that the field is missing. Never `then`, which a promise reads.
            const clash = `${file}: merge: ${error instanceof Error ? error.message : String(error)}`;
            for (const key of new Set(values.flatMap((v) => Object.keys(v as object))))
                if (key !== "then")
                    Object.defineProperty(out, key, {
                        get: () => {
                            throw new Error(clash);
                        },
                    });
        }
    return Object.defineProperty(out, MADE, { value: { values, file } });
}

/**
 * Lists of the model whose items are maps, besides the ordered ones: there, a merge of single maps is a list of them, never one map.
 * Taken from Circuit's schema (every array of objects under a device).
 */
const MAP_LISTS =
    /(^|\.)(routing\.(static_routes|rpki)|monitoring\.(syslog|flow_export\.collectors)|system\.vdoms\.[^.]+\.static_routes|interfaces\.[^.]+\.[^.]+\.(addresses|peers|vrrp)|services\.dhcp_server\.[^.]+\.reservations)$/;

/**
 * Every `merge` in a value, made again by the field it lands in, `path`, which Circuit knows from the model:
 *
 * - in an ordered list (`isOrdered`), its items flat, in order, each kept as it is;
 * - in a list of maps (`MAP_LISTS`), or when an item is no map (a VLAN name, a port), its items flat, the same item twice kept once;
 * - anywhere else, its items merged as maps, by `mergeAll`.
 *
 * So two single rules, `merge([rule_a, rule_b])`, are two rules in a chain and never one map: the chain's path says so. A source in a
 * device's `include` lands at the top, so it is a map, keyed by hostname. Changes maps and lists in place, so a rule keeps its identity.
 */
export function resolve(value: unknown, path: string): unknown {
    const by = madeBy(value);
    if (by) {
        const { values, file } = by;
        if (isOrdered(path)) value = [...values];
        else if (MAP_LISTS.test(path) || values.some((v) => !isMap(v)))
            value = values.filter((v, i, all) => all.findIndex((o) => same(o, v)) === i);
        else if (Array.isArray(value))
            try {
                value = mergeAll(values, file, path);
            } catch (error) {
                throw new Error(`${file}: merge: ${error instanceof Error ? error.message : String(error)}`);
            }
    }
    if (Array.isArray(value)) value.forEach((v, i) => (value[i] = resolve(v, `${path}[]`)));
    else if (isMap(value))
        for (const [k, v] of Object.entries(value)) if (v && typeof v === "object") value[k] = resolve(v, path ? `${path}.${k}` : k);
    return value;
}

// ---------- the types: what the editor checks ----------

/**
 * Two parts merged as `merge` merges them: maps key by key, lists joined, anything else the later one. A key one side writes out keeps
 * its own type, even when the other side has an index signature.
 */
export type Merge2<A, B> = [A] extends [readonly (infer X)[]]
    ? [B] extends [readonly (infer Y)[]]
        ? readonly (X | Y)[]
        : B
    : [A] extends [object]
      ? [B] extends [object]
          ? {
                [K in keyof A | keyof B]: K extends WrittenKeys<A>
                    ? K extends WrittenKeys<B>
                        ? Merge2<A[K], B[K]>
                        : A[K]
                    : K extends WrittenKeys<B>
                      ? B[K]
                      : (K extends keyof A ? A[K] : never) | (K extends keyof B ? B[K] : never);
            }
          : B
      : B;

/** Parts merged in order. */
export type Merged<T extends readonly unknown[], Acc = {}> = T extends readonly [infer H, ...infer R] ? Merged<R, Merge2<Acc, H>> : Acc;

/** The first `N` parts. */
type Take<T extends readonly unknown[], N extends number, Acc extends unknown[] = []> = Acc["length"] extends N
    ? Acc
    : T extends readonly [infer H, ...infer R]
      ? Take<R, N, [...Acc, H]>
      : Acc;

/** The parts before position `I` of `T`, merged, with `First` before them. */
export type Before<T extends readonly unknown[], I, First = {}> = I extends `${infer N extends number}`
    ? Merged<[First, ...Take<T, N>]>
    : First;

/** The keys written out, not those of an index signature. */
type WrittenKeys<A> = keyof { [K in keyof A as number extends K ? never : string extends K ? never : K]: 0 };

/** Keys to look into: a map's, without symbols. */
type Keys<B> = keyof B & (string | number);

/** The path of an ordered list, as `isOrdered` reads it. */
type OrderedPath =
    | `${string}firewall.filter.${string}.rules`
    | `${string}firewall.nat.${"source" | "destination"}`
    | `${string}switching.acls.${string}`
    | `${string}routing.policies.${string}`
    | `${string}routing.policy_routing`;

/**
 * Every place where part `B` clashes with what came before it, `A`, said in words: an ordered list both write, or another value at
 * one path. Any other list never clashes: it joins.
 */
type ClashPaths<B, A, Path extends string = ""> = {
    [K in Keys<B>]: K extends WrittenKeys<A>
        ? [B[K]] extends [readonly unknown[]]
            ? `${Path}${K}` extends OrderedPath
                ? `${Path}${K} is an ordered list written in two places`
                : never
            : [B[K]] extends [object]
              ? ClashPaths<B[K], A[K & keyof A], `${Path}${K}.`>
              : [B[K]] extends [A[K & keyof A]]
                ? never
                : [A[K & keyof A]] extends [B[K]]
                  ? never
                  : `${Path}${K} is written twice`
        : never;
}[Keys<B>];

/**
 * What part `B` must also be, after `A`: nothing more when nothing clashes, and else a property named after each clash that it lacks,
 * so the editor says `Property '"edge-01.firewall.nat.source is an ordered list written in two places"' is missing`. An
 * ordered list is written whole in one place. Any other value written twice must be the same.
 */
export type Clash<B, A> = [ClashPaths<B, A>] extends [never] ? unknown : { [P in ClashPaths<B, A>]: true };
