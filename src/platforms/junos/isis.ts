import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device, Family, IsisAuthentication } from "../../model";
import type { JunosNames } from "./names";
import type { JunosStatements } from "./statements";

/** IS-IS in the main table, with wide metrics only. IPv6 shares IPv4's topology unless `multi_topology` gives it its own. */
export class JunosIsis {
    private static readonly LEVELS = { "level-1": [1], "level-2": [2], "level-1-2": [1, 2] } as const;

    /** The device routes both families unless told not to, with these. */
    private static readonly NOT_ROUTED: Record<Family, string> = { ipv4: "no-ipv4-routing", ipv6: "no-ipv6-routing" };

    /** Where an interface's BFD for each family goes. */
    private static readonly FAMILY: Record<Family, string> = { ipv4: "inet", ipv6: "inet6" };

    /** The key chain that holds a level's HMAC-SHA key: `circuit-isis-l2-keys`. The switch refuses a key chain name that ends in a number (TRAPS.md). */
    private static readonly KEY_CHAIN = { before: "circuit-isis-l", after: "-keys" };

    /** A key chain's key signs from its start time. 2001 is before any date the switch's clock shows, so the key signs at once. The switch prints it with its own time zone, which the plan ignores. */
    private static readonly KEY_START = "2001-1-1.00:00:00";

    /** The algorithms Junos 21.4's key chains sign IS-IS with, beside HMAC-MD5. Juniper adds HMAC-SHA2 in 24.2R1. */
    private static readonly SHA: readonly IsisAuthentication["algorithm"][] = ["hmac-sha-1"];

    /** A key chain numbers its keys from 0 to 63. */
    private static readonly MAX_KEY_ID = 63;

    /** The IS-IS export policy that leaks level 2 routes into level 1, after Juniper's example. */
    private static readonly LEAK = "circuit-isis-level2-to-level1";

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
            const authentication = Derive.isisAuthentication(isis, level);
            if (authentication) JunosIsis.sign(out, level, authentication);
        }

        for (const [family, statement] of Object.entries(JunosIsis.NOT_ROUTED))
            if (!isis.address_families.includes(family as Family)) out.set("protocols isis", statement);
        if (isis.overload_bit) out.set("protocols isis overload");
        if (isis.multi_topology) out.set("protocols isis topologies ipv6-unicast");
        if (isis.level2_to_level1) JunosIsis.leak(out, isis.level2_to_level1.import_policy);

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

    /** HMAC-SHA that the platform's key chains don't take. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const { where, authentication } of Derive.isisAuthentications(device)) {
            const { algorithm, key_id: id } = authentication;
            if (algorithm !== "hmac-md5" && !JunosIsis.SHA.includes(algorithm))
                found.push(`${where}.algorithm ${algorithm}, Junos 21.4 signs IS-IS with hmac-md5 or hmac-sha-1 only`);
            if (id !== undefined && id > JunosIsis.MAX_KEY_ID)
                found.push(`${where}.key_id ${id}, a Junos key chain numbers its keys from 0 to ${JunosIsis.MAX_KEY_ID}`);
        }

        return found;
    }

    /**
     * The level's key signs its hellos as well as its LSPs and sequence number packets. HMAC-MD5 is the level's own key. HMAC-SHA comes from a key chain, whose `isis-enhanced` sends RFC 5310's packets: without it, the key signs as RFC 5304 does.
     */
    private static sign(out: JunosStatements, level: number, authentication: IsisAuthentication): void {
        if (authentication.algorithm === "hmac-md5") {
            out.set("protocols isis level", level, "authentication-key", Secrets.marker(authentication.key));
            out.set("protocols isis level", level, "authentication-type md5");
            return;
        }

        const chain = `${JunosIsis.KEY_CHAIN.before}${level}${JunosIsis.KEY_CHAIN.after}`;
        const key = `security authentication-key-chains key-chain ${chain} key ${authentication.key_id}`;
        out.set(key, "secret", Secrets.marker(authentication.key));
        out.set(key, "start-time", JunosIsis.KEY_START);
        out.set(key, "algorithm", authentication.algorithm);
        out.set(key, "options isis-enhanced");
        out.set("protocols isis level", level, "authentication-key-chain", chain);
    }

    /** An IS-IS export policy that takes the level 2 routes the leak's policy accepts into level 1. Its policy runs as a subroutine: a route it accepts matches. Routes of level 1 still go up to level 2, as no term rejects them. */
    private static leak(out: JunosStatements, policy: string): void {
        out.set("protocols isis export", JunosIsis.LEAK);

        const statement = `policy-options policy-statement ${JunosIsis.LEAK}`;
        out.set(statement, "from protocol isis");
        out.set(statement, "from level 2");
        out.set(statement, "from policy", policy);
        out.set(statement, "to protocol isis");
        out.set(statement, "to level 1");
        out.set(statement, "then accept");
    }
}
