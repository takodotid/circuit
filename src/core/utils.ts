// Small helpers that stand alone: combining records from several sources, and reading a time zone's offset.

type Merged<T extends readonly object[]> = T extends readonly [infer Head, ...infer Tail extends readonly object[]]
    ? Head & Merged<Tail>
    : unknown;

export class Utils {
    /** Combine records into one, such as a device's own interfaces and those a module derives for it. Unlike spreading them, a name two of them hold is an error rather than one silently replacing the other. */
    static merge<const T extends readonly Record<string, unknown>[]>(...records: T): Merged<T> {
        const result: Record<string, unknown> = {};

        for (const record of records) {
            for (const [key, value] of Object.entries(record)) {
                if (key in result) throw new Error(`Utils.merge: ${key} is declared twice`);
                result[key] = value;
            }
        }

        return result as Merged<T>;
    }

    /** Minutes east of UTC an IANA zone is at now, for platforms that take an offset rather than a zone. */
    static timeZoneOffset(zone: string): number {
        const name = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            timeZoneName: "longOffset",
        })
            .formatToParts(new Date())
            .find((entry) => entry.type === "timeZoneName")!.value;
        const found = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
        if (!found) return 0;

        const [, sign, hours, minutes] = found;
        const sizeInMinutes = Number(hours) * 60 + Number(minutes);
        return sign === "-" ? -sizeInMinutes : sizeInMinutes;
    }
}
