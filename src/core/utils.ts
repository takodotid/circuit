// Small helpers that stand alone.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export class Utils {
    /** The project's folder. A path in the config, such as a certificate's `certificate_file`, is from here. Circuit sets it when it reads a project. */
    static root = process.cwd();

    /** The text of a file of the project, by its path from the project's folder. */
    static projectFile(path: string): string {
        return readFileSync(join(Utils.root, path), "utf8");
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
