// Small helpers that stand alone: combining records from several sources, reading a time zone's offset, and reading a file of the project.

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Merged<T extends readonly object[]> = T extends readonly [infer Head, ...infer Tail extends readonly object[]]
    ? Head & Merged<Tail>
    : unknown;

export class Utils {
    /** The project's folder. A path in the config, such as a certificate's `certificate_file`, is from here. Circuit sets it when it reads a project. */
    static root = process.cwd();

    /** The text of a file of the project, by its path from the project's folder. */
    static projectFile(path: string): string {
        return readFileSync(join(Utils.root, path), "utf8");
    }

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

    /** The table a route or a BGP session is in, beside the main one: `undefined` for the main table, written `main` or left out. */
    static otherTable(table: string | undefined): string | undefined {
        return table === "main" ? undefined : table;
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
