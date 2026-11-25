import { Address } from "../../core/address";
import type { BuiltFeature } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device, Family, OspfArea, OspfInterface } from "../../model";
import { JunosBgp } from "./bgp";
import type { JunosNames } from "./names";
import type { JunosStatements } from "./statements";

/** OSPF for IPv4 and OSPFv3 for IPv6, with the same areas and interfaces, in the main instance or a VRF's. */
export class JunosOspf {
    /** OSPF's features beyond its areas and interfaces, each experimental (`experimental()`). */
    static readonly BUILT: readonly BuiltFeature[] = [
        "ospf-ranges",
        "ospf-range-cost",
        "ospf-priority",
        "ospf-unicast-links",
        "ospf-virtual-links",
    ];

    private static readonly EXPORT = "circuit-ospf-redistribute";

    /** Each network type besides broadcast, as `interface-type` names it. */
    private static readonly NETWORK = {
        "point-to-point": "p2p",
        "point-to-multipoint": "p2mp",
        "non-broadcast": "nbma",
    } as const;

    static render(out: JunosStatements, device: Device, names: JunosNames): void {
        const ospf = device.routing?.ospf;
        if (!ospf) return;

        const instance = JunosBgp.instance(ospf.vrf);
        const routerId = device.routing?.router_id;
        // A routing instance otherwise takes the address of one of its own interfaces as its router ID.
        if (ospf.vrf && routerId) out.set(`${instance}routing-options router-id`, routerId);

        for (const family of ospf.address_families ?? ["ipv4"]) {
            const protocol = `${instance}protocols ${family === "ipv4" ? "ospf" : "ospf3"}`;

            for (const [areaId, area] of Object.entries(ospf.areas)) {
                if (area.type) {
                    const type = `${protocol} area ${areaId} ${area.type}`;
                    out.set(type);
                    if (area.no_summaries) out.set(type, "no-summaries");
                    // An NSSA's border router announces its default route only with `default-lsa`.
                    const defaultRoute = area.type === "nssa" ? `${type} default-lsa` : type;
                    if (area.stub_default_cost !== undefined) out.set(defaultRoute, "default-metric", area.stub_default_cost);
                }

                JunosOspf.ranges(out, `${protocol} area ${areaId}`, family, area.ranges);
                for (const link of area.virtual_links ?? [])
                    out.set(`${protocol} area ${areaId} virtual-link neighbor-id ${link.router_id} transit-area ${link.transit_area_id}`);

                for (const [iface, settings] of Object.entries(area.interfaces)) {
                    if (!settings) continue;

                    const statement = `${protocol} area ${areaId} interface ${names.unit(iface)}`;
                    out.set(statement);

                    if (settings.cost !== undefined) out.set(statement, "metric", settings.cost);
                    if (settings.passive) out.set(statement, "passive");
                    if (settings.network && settings.network !== "broadcast")
                        out.set(statement, "interface-type", JunosOspf.NETWORK[settings.network]);
                    JunosOspf.neighbors(out, statement, settings);
                    if (settings.priority !== undefined) out.set(statement, "priority", settings.priority);
                    if (settings.hello_interval !== undefined) out.set(statement, "hello-interval", settings.hello_interval);
                    if (settings.dead_interval !== undefined) out.set(statement, "dead-interval", settings.dead_interval);
                    // `unsupported()` refuses HMAC-SHA, and the device checks refuse authentication on OSPFv3.
                    const authentication = settings.authentication;
                    if (authentication)
                        out.set(statement, `authentication md5 ${authentication.key_id} key`, Secrets.marker(authentication.key));
                    if (settings.bfd) out.bfd(statement, device.routing?.bfd);
                }
            }

            if (ospf.redistribute?.length) out.set(`${protocol} export`, JunosOspf.EXPORT);
        }

        for (const source of ospf.redistribute ?? []) {
            const term = `policy-options policy-statement ${JunosOspf.EXPORT} term ${source}`;
            out.set(term, "from protocol", source === "connected" ? "direct" : "static");
            out.set(term, "then accept");
        }
    }

    /** HMAC-SHA, which Junos 21 has no OSPF statement for, and a range's cost of 0, which `override-metric` refuses: `Value 0 is not within range (1..16777215)`. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const [areaId, area] of Object.entries(device.routing?.ospf?.areas ?? {})) {
            const where = `routing.ospf.areas.${areaId}`;
            (area.ranges ?? []).forEach((range, index) => {
                if (range.cost === 0)
                    found.push(`${where}.ranges[${index}].cost 0, Junos announces a range at a cost from 1: write 1 or more`);
            });

            for (const [iface, settings] of Object.entries(area.interfaces)) {
                const algorithm = settings?.authentication?.algorithm;
                if (algorithm && algorithm !== "md5")
                    found.push(`${where}.interfaces.${iface}.authentication.algorithm ${algorithm}, Junos 21 signs OSPF with md5 only`);
            }
        }

        return found;
    }

    /** Ranges, priorities, NBMA and point-to-multipoint links, and virtual links passed `commit check` only, with no neighbor to run them with. */
    static experimental(device: Device): string[] {
        const found: string[] = [];

        for (const [areaId, area] of Object.entries(device.routing?.ospf?.areas ?? {})) {
            const where = `routing.ospf.areas.${areaId}`;
            if (area.ranges) found.push(`${where}.ranges`);
            if (area.virtual_links) found.push(`${where}.virtual_links`);

            for (const [name, settings] of Object.entries(area.interfaces)) {
                const at = `${where}.interfaces.${name}`;
                if (settings?.priority !== undefined) found.push(`${at}.priority`);
                if (settings?.network === "point-to-multipoint" || settings?.network === "non-broadcast")
                    found.push(`${at}.network ${settings.network}`);
                if (settings?.neighbors) found.push(`${at}.neighbors`);
            }
        }

        return found;
    }

    /** Each range of the OSPF version's family. `restrict` announces nothing of it, and `override-metric` is its cost. */
    private static ranges(out: JunosStatements, area: string, family: Family, ranges: OspfArea["ranges"]): void {
        for (const range of ranges ?? []) {
            if (Address.family(range.prefix) !== family) continue;

            const statement = `${area} area-range ${Address.prefixOf(range.prefix)}`;
            out.set(statement);
            if (!range.advertise) out.set(statement, "restrict");
            if (range.cost !== undefined) out.set(statement, "override-metric", range.cost);
        }
    }

    /**
     * An NBMA neighbor is `eligible`: Juniper's reference says one without it is not eligible to become the DR, and Circuit leaves that to each router's `priority`. A point-to-multipoint link without neighbors learns them with `dynamic-neighbors`: Juniper's example lists each one, as there is no discovery (TRAPS.md).
     */
    private static neighbors(out: JunosStatements, statement: string, settings: OspfInterface): void {
        if (settings.network === "point-to-multipoint" && !settings.neighbors?.length) out.set(statement, "dynamic-neighbors");

        const eligible = settings.network === "non-broadcast" ? ["eligible"] : [];
        for (const neighbor of settings.neighbors ?? []) out.set(statement, "neighbor", neighbor, ...eligible);
    }
}
