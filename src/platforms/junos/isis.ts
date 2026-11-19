import type { Device, Family } from "../../model";
import type { JunosNames } from "./names";
import type { JunosStatements } from "./statements";

/** IS-IS in the main table, with wide metrics only. */
export class JunosIsis {
    private static readonly LEVELS = { "level-1": [1], "level-2": [2], "level-1-2": [1, 2] } as const;

    /** The device routes both families unless told not to, with these. */
    private static readonly NOT_ROUTED: Record<Family, string> = { ipv4: "no-ipv4-routing", ipv6: "no-ipv6-routing" };

    /** The device takes its NET from an ISO address of the main loopback. Each IS-IS interface has the ISO family. */
    static render(out: JunosStatements, device: Device, names: JunosNames): void {
        const isis = device.routing?.isis;
        if (!isis) return;

        const levels: readonly number[] = JunosIsis.LEVELS[isis.level_capability];
        out.set("interfaces lo0 unit 0 family iso address", isis.net);

        for (const level of [1, 2]) out.set("protocols isis level", level, levels.includes(level) ? "wide-metrics-only" : "disable");

        for (const [family, statement] of Object.entries(JunosIsis.NOT_ROUTED))
            if (!isis.address_families.includes(family as Family)) out.set("protocols isis", statement);

        for (const [name, settings] of Object.entries(isis.interfaces)) {
            const unit = names.unit(name);
            const dot = unit.lastIndexOf(".");
            out.set("interfaces", unit.slice(0, dot), "unit", unit.slice(dot + 1), "family iso");

            const statement = `protocols isis interface ${unit}`;
            out.set(statement);
            if (settings?.passive) out.set(statement, "passive");
            if (settings?.network === "point-to-point") out.set(statement, "point-to-point");
            const metric = settings?.metric;
            if (metric !== undefined) for (const level of levels) out.set(statement, "level", level, "metric", metric);
        }
    }
}
