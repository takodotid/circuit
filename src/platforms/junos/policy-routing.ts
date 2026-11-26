import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import { Utils } from "../../core/utils";
import type { Device, Family, RoutingRule } from "../../model";
import { JunosBgp } from "./bgp";
import type { JunosNames } from "./names";
import { JunosStatements } from "./statements";

/** A logical interface where routed packets of the main table arrive, with the name the config gives it. */
type Arrival = { name: string; unit: string };

/**
 * Tables and policy routing, as Juniper's filter-based forwarding on a switch has them. A table is a `virtual-router` instance without interfaces: a QFX5100 has no `forwarding` instance. A RIB group puts the main table's interface routes in each table, so its routes reach their next hops. A filter of each family sends what each rule matches to its table.
 */
export class JunosPolicyRouting {
    /** A filter's name is unique across families (TRAPS.md). */
    private static readonly FILTER = { ipv4: "circuit-policy-routing", ipv6: "circuit-policy-routing-v6" } as const;

    /** The RIB group of each family that puts the main table's interface routes in every table. */
    private static readonly RIB_GROUP = { ipv4: "circuit-tables", ipv6: "circuit-tables-v6" } as const;

    private static readonly FAMILY = { ipv4: "inet", ipv6: "inet6" } as const;

    /** The main table of each family. */
    private static readonly MAIN = { ipv4: "inet.0", ipv6: "inet6.0" } as const;

    private static readonly DEFAULT_ROUTE = { ipv4: "0.0.0.0/0", ipv6: "::/0" } as const;

    private static readonly FAMILIES = ["ipv4", "ipv6"] as const;

    /** Where routed packets arrive: a loopback takes only what the switch receives itself. */
    private static readonly ROUTED_KINDS = new Set(["ethernet", "lag", "vlan_interface", "gre"]);

    static render(out: JunosStatements, device: Device, names: JunosNames): void {
        const tables = Object.entries(device.routing?.tables ?? {});

        for (const [name, table] of tables) {
            out.set(`routing-instances ${name} instance-type virtual-router`);
            if (table?.description) out.set(`routing-instances ${name} description`, JunosStatements.quote(table.description));
        }

        for (const family of JunosPolicyRouting.FAMILIES) {
            if (!tables.length) break;

            const group = `routing-options rib-groups ${JunosPolicyRouting.RIB_GROUP[family]} import-rib`;
            out.set(group, JunosPolicyRouting.MAIN[family]);
            for (const [name] of tables) out.set(group, `${name}.${JunosPolicyRouting.MAIN[family]}`);
            out.set(
                `routing-options interface-routes rib-group ${JunosPolicyRouting.FAMILY[family]}`,
                JunosPolicyRouting.RIB_GROUP[family]
            );

            for (const table of JunosPolicyRouting.fallingBack(device, family))
                out.set(
                    `${JunosBgp.options(family, table)} static route ${JunosPolicyRouting.DEFAULT_ROUTE[family]} next-table`,
                    JunosPolicyRouting.MAIN[family]
                );
        }

        for (const family of JunosPolicyRouting.FAMILIES) JunosPolicyRouting.filters(out, device, names, family);
    }

    /** One filter for the interfaces no rule names, and one for each interface a rule names, which takes the rules for every interface too. */
    private static filters(out: JunosStatements, device: Device, names: JunosNames, family: Family): void {
        const rules = device.routing?.policy_routing ?? [];
        if (!rules.length) return;

        for (const { name, unit } of JunosPolicyRouting.arrivals(device, names, family)) {
            const own = rules.some((rule) => rule.match?.in_interface === name);
            const filterName = own
                ? `${JunosPolicyRouting.FILTER[family]}-${unit.replace(/[/.]/g, "-")}`
                : JunosPolicyRouting.FILTER[family];
            const filter = `firewall family ${JunosPolicyRouting.FAMILY[family]} filter ${filterName}`;

            const written = rules
                .map((rule, index) => {
                    const at = rule.match?.in_interface;
                    if (at !== undefined && at !== name) return false;
                    return JunosPolicyRouting.term(out, filter, family, rule, index);
                })
                .some(Boolean);
            if (!written) continue;

            out.set(filter, "term circuit-default then accept");
            out.set(`interfaces ${unit.replace(".", " unit ")} family ${JunosPolicyRouting.FAMILY[family]} filter input`, filterName);
        }
    }

    /** A rule's term, when it can match a packet of the family. It sends the packet to the rule's table, or accepts it for the main table: the first rule that matches decides. */
    private static term(out: JunosStatements, filter: string, family: Family, rule: RoutingRule, index: number): boolean {
        const match = rule.match ?? {};
        if (!JunosPolicyRouting.ofFamily(rule, family)) return false;

        const label = `${index + 1}`;
        const term = `${filter} term ${JunosStatements.quote(rule.description ? `${label} ${rule.description}` : label)}`;

        if (match.src) out.set(term, "from source-address", Address.canonical(match.src));
        if (match.dst) out.set(term, "from destination-address", Address.canonical(match.dst));

        const table = Utils.otherTable(rule.routing_table);
        if (table) out.set(term, "then routing-instance", table);
        else out.set(term, "then accept");
        return true;
    }

    /** The logical interfaces of the main table with an address of the family, where routed packets arrive. */
    private static arrivals(device: Device, names: JunosNames, family: Family): Arrival[] {
        return Derive.holders(device).flatMap(({ kind, name, settings }) => {
            if (!JunosPolicyRouting.ROUTED_KINDS.has(kind) || settings.vrf) return [];
            if (kind === "ethernet" && names.port(name).startsWith("em")) return [];

            const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
            return addresses.some((address) => Address.family(address) === family) ? [{ name, unit: names.unit(name) }] : [];
        });
    }

    /** Whether a rule can match a packet of the family: a rule without addresses matches either. */
    private static ofFamily(rule: RoutingRule, family: Family): boolean {
        const prefixes = [rule.match?.src, rule.match?.dst].filter((prefix) => prefix !== undefined);
        return prefixes.every((prefix) => Address.family(Address.host(prefix)) === family);
    }

    /** The tables whose rules for packets of the family fall back to the main table. */
    private static fallingBack(device: Device, family: Family): Set<string> {
        const rules = (device.routing?.policy_routing ?? []).filter(
            (rule) => rule.fallback === "main" && JunosPolicyRouting.ofFamily(rule, family)
        );
        return new Set(rules.flatMap((rule) => Utils.otherTable(rule.routing_table) ?? []));
    }

    /** What policy routing can't do here. */
    static unsupported(device: Device, names: JunosNames): string[] {
        const found: string[] = [];
        const routing = device.routing;
        const bgp = routing?.bgp;
        const notBuilt =
            "not built for Junos: a session of the main instance puts its routes in another table only through a RIB group, untried";

        for (const [name, group] of Object.entries(bgp?.neighbor_groups ?? {}))
            if (Utils.otherTable(group?.routing_table)) found.push(`routing.bgp.neighbor_groups.${name}.routing_table, ${notBuilt}`);
        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {}))
            if (Utils.otherTable(neighbor?.routing_table)) found.push(`routing.bgp.neighbors.${name}.routing_table, ${notBuilt}`);

        const rules = routing?.policy_routing ?? [];
        const arriving = new Set(
            JunosPolicyRouting.FAMILIES.flatMap((family) => JunosPolicyRouting.arrivals(device, names, family).map(({ name }) => name))
        );
        const fallbacks = new Map<string, { fallback: string; index: number }>();

        rules.forEach((rule, index) => {
            const where = `routing.policy_routing[${index}]`;
            const at = rule.match?.in_interface;
            if (at !== undefined && !arriving.has(at))
                found.push(
                    `${where}.match.in_interface ${at}, where no routed packet of the main table arrives: Junos policy-routes on VLAN interfaces, routed ports and LAGs, and tunnels of the main table, with an address`
                );

            const table = Utils.otherTable(rule.routing_table);
            if (!table) return;
            const fallback = rule.fallback ?? "none";
            const first = fallbacks.get(table);
            if (first && first.fallback !== fallback)
                found.push(
                    `${where}.fallback ${fallback}, unlike routing.policy_routing[${first.index}] to table ${table}: Junos falls back for a whole table, so give each rule to it one fallback`
                );
            if (!first) fallbacks.set(table, { fallback, index });
        });

        // The fallback is the table's default route, so a default route of its own would take its place.
        for (const family of JunosPolicyRouting.FAMILIES)
            for (const route of routing?.static_routes ?? [])
                if (
                    JunosPolicyRouting.fallingBack(device, family).has(route.routing_table ?? "main") &&
                    Address.split(route.prefix).len === 0 &&
                    Address.family(Address.split(route.prefix).addr) === family
                )
                    found.push(
                        `routing.static_routes ${route.prefix} in table ${route.routing_table}, whose rules fall back to main: Junos falls back through the table's default route, so remove the route or the fallback`
                    );

        // An interface takes one input filter of each family.
        if (rules.length && device.qos?.marking?.length)
            found.push("routing.policy_routing beside qos.marking: an interface takes one input filter of each family, and both need it");
        if (rules.length)
            for (const [name, port] of Derive.ports(device))
                if (port.ingress_acl && arriving.has(name))
                    found.push(
                        `interfaces.ethernet.${name}.ingress_acl beside routing.policy_routing: a routed port takes one filter of each family`
                    );

        return found;
    }

    /** Tables, their routes, and policy routing passed `commit check` only, in a candidate that was never committed. */
    static experimental(device: Device): string[] {
        const routing = device.routing;
        const found = Object.keys(routing?.tables ?? {}).map((name) => `routing.tables.${name}`);
        if (routing?.policy_routing?.length) found.push("routing.policy_routing");
        for (const route of routing?.static_routes ?? [])
            if (Utils.otherTable(route.routing_table)) found.push(`routing.static_routes ${route.prefix} routing_table`);
        return found;
    }
}
