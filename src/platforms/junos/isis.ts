import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device, Family } from "../../model";
import type { JunosNames } from "./names";
import type { JunosStatements } from "./statements";

/** IS-IS in the main table, with wide metrics only. IPv6 shares IPv4's topology unless `multi_topology` gives it its own. */
export class JunosIsis {
    private static readonly LEVELS = { "level-1": [1], "level-2": [2], "level-1-2": [1, 2] } as const;

    /** The device routes both families unless told not to, with these. */
    private static readonly NOT_ROUTED: Record<Family, string> = { ipv4: "no-ipv4-routing", ipv6: "no-ipv6-routing" };

    /** Where an interface's BFD for each family goes. */
    private static readonly FAMILY: Record<Family, string> = { ipv4: "inet", ipv6: "inet6" };

    /** The device takes its NET from an ISO address of the main loopback. Each IS-IS interface has the ISO family. */
    static render(out: JunosStatements, device: Device, names: JunosNames): void {
        const isis = device.routing?.isis;
        if (!isis) return;

        const levels: readonly number[] = JunosIsis.LEVELS[isis.level_capability];
        out.set("interfaces lo0 unit 0 family iso address", isis.net);

        for (const level of [1, 2] as const) {
            if (!levels.includes(level)) {
                out.set("protocols isis level", level, "disable");
                continue;
            }

            out.set("protocols isis level", level, "wide-metrics-only");
            // The level's key signs its hellos as well as its LSPs and sequence number packets.
            const key = Derive.isisKey(isis, level);
            if (!key) continue;

            out.set("protocols isis level", level, "authentication-key", Secrets.marker(key));
            out.set("protocols isis level", level, "authentication-type md5");
        }

        for (const [family, statement] of Object.entries(JunosIsis.NOT_ROUTED))
            if (!isis.address_families.includes(family as Family)) out.set("protocols isis", statement);
        if (isis.overload_bit) out.set("protocols isis overload");
        if (isis.multi_topology) out.set("protocols isis topologies ipv6-unicast");

        for (const [name, settings] of Object.entries(isis.interfaces)) {
            const unit = names.unit(name);
            const dot = unit.lastIndexOf(".");
            out.set("interfaces", unit.slice(0, dot), "unit", unit.slice(dot + 1), "family iso");

            const statement = `protocols isis interface ${unit}`;
            out.set(statement);
            if (settings?.passive) out.set(statement, "passive");
            if (settings?.network === "point-to-point") out.set(statement, "point-to-point");
            const metric = settings?.metric;
            // In a topology of its own, IPv6 has a metric of its own, which the config's one metric sets too.
            const metrics = isis.multi_topology ? ["metric", "ipv6-unicast-metric"] : ["metric"];
            if (metric !== undefined)
                for (const level of levels) for (const kind of metrics) out.set(statement, "level", level, kind, metric);
            // A BFD session runs for each family.
            if (settings?.bfd)
                for (const family of isis.address_families) out.bfd(`${statement} family ${JunosIsis.FAMILY[family]}`, device.routing?.bfd);
        }
    }
}
