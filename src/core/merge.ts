// Combining records from several sources, such as a device's own interfaces and those a module derives for it.

type Merged<T extends readonly object[]> = T extends readonly [infer Head, ...infer Tail extends readonly object[]]
    ? Head & Merged<Tail>
    : unknown;

/** Combine records into one. Unlike spreading them, a name two of them hold is an error rather than one silently replacing the other. */
export function merge<const T extends readonly Record<string, unknown>[]>(...records: T): Merged<T> {
    const result: Record<string, unknown> = {};

    for (const record of records) {
        for (const [key, value] of Object.entries(record)) {
            if (key in result) throw new Error(`merge: ${key} is declared twice`);
            result[key] = value;
        }
    }

    return result as Merged<T>;
}
