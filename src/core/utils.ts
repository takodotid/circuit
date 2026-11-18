import { readFileSync } from "node:fs";
import { join } from "node:path";

export class Utils {
    private static readonly MINUTES_PER_HOUR = 60;

    /** The project's folder. A path in the config, such as a certificate's `certificate_file`, is from here. Reading a project sets it. */
    static root = process.cwd();

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
        const sizeInMinutes = Number(hours) * Utils.MINUTES_PER_HOUR + Number(minutes);
        return sign === "-" ? -sizeInMinutes : sizeInMinutes;
    }
}
