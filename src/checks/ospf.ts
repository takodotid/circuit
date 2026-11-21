import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, Finding, Ospf, OspfArea, OspfInterface } from "../model";

type Report = (message: string) => void;

type Network = NonNullable<OspfInterface["network"]>;

/** OSPF's areas and the settings of their interfaces, as RFC 2328 and RFC 3101 allow them, and what platforms do differently when the config leaves it out. */
export class OspfChecks {
    /** The backbone area, which every other area attaches to (RFC 2328). */
    private static readonly BACKBONE = "0.0.0.0";
    /** The largest metric of a summary LSA; 16777215 is LSInfinity (RFC 2328). */
    private static readonly MAX_SUMMARY_COST = 16_777_214;
    /** A hello or dead interval, in seconds, that every platform takes. */
    private static readonly MAX_INTERVAL = 65_535;
    /** The hello interval every platform uses when the config states none, in seconds. */
    private static readonly HELLO_INTERVAL = 10;
    /** The usual dead interval, in hello intervals (RFC 2328, Appendix C.3). */
    private static readonly DEAD_HELLOS = 4;
    /** An authentication key ID and a router priority are each one octet (RFC 2328). */
    private static readonly MAX_OCTET = 255;
    /** The network type of an interface that writes none. */
    private static readonly DEFAULT_NETWORK: Network = "broadcast";
    /** The network types whose routers elect a designated router (RFC 2328, section 9.4). */
    private static readonly ELECTING: readonly Network[] = ["broadcast", "non-broadcast"];
    /** The network types that take neighbors the device sends its hellos to (RFC 2328, Appendix C.5 and C.6). Circuit runs them for OSPFv2 only. */
    private static readonly UNICAST: readonly Network[] = ["non-broadcast", "point-to-multipoint"];

    static check(device: Device, report: Report): void {
        const ospf = device.routing?.ospf;
        if (!ospf) return;

        for (const [areaId, area] of Object.entries(ospf.areas)) {
            const where = `routing.ospf.areas.${areaId}`;
            if (!/^\d+\.\d+\.\d+\.\d+$/.test(areaId)) report(`routing.ospf.areas '${areaId}' is not written as a dotted area ID`);

            if (area.type && areaId === OspfChecks.BACKBONE)
                report(`${where} has type ${area.type}, but the backbone is a normal area (RFC 2328). Remove type`);
            for (const key of ["no_summaries", "stub_default_cost"] as const) {
                if (area[key] !== undefined && !area.type)
                    report(`${where} has ${key} without type: only a stub area or an NSSA takes it. Write type, or remove ${key}`);
            }
            if (area.stub_default_cost !== undefined && !OspfChecks.within(area.stub_default_cost, 1, OspfChecks.MAX_SUMMARY_COST))
                report(
                    `${where}.stub_default_cost is ${area.stub_default_cost}: write a whole number from 1 to ${OspfChecks.MAX_SUMMARY_COST}`
                );

            OspfChecks.ranges(device, ospf, areaId, area, report);
            OspfChecks.virtualLinks(device, ospf, areaId, area, report);
            for (const [name, settings] of Object.entries(area.interfaces))
                if (settings) OspfChecks.iface(device, ospf, `${where}.interfaces.${name}`, name, settings, report);
        }
    }

    /** What platforms do differently when the config leaves it out: a border router's default route into a stub area or an NSSA, and a dead interval beside a hello interval. */
    static warnings(device: Device): Finding[] {
        const areas = device.routing?.ospf?.areas ?? {};
        // A virtual link joins the device to the backbone, as an interface there does.
        const backbone =
            Object.values(areas[OspfChecks.BACKBONE]?.interfaces ?? {}).some(Boolean) ||
            Boolean(areas[OspfChecks.BACKBONE]?.virtual_links?.length);
        const warn = (message: string): Finding => ({ level: "warning", device: device.name, message });
        const found: Finding[] = [];

        for (const [areaId, area] of Object.entries(areas)) {
            const where = `routing.ospf.areas.${areaId}`;
            if (backbone && area.type && area.stub_default_cost === undefined && areaId !== OspfChecks.BACKBONE)
                found.push(
                    warn(
                        `${where} is ${area.type === "stub" ? "a stub area" : "an NSSA"} without stub_default_cost, and this device is its border router. RouterOS and Junos then announce no default route into it, and other platforms one at a cost of their own. Write stub_default_cost, such as 10`
                    )
                );

            for (const [name, settings] of Object.entries(area.interfaces)) {
                const hello = settings?.hello_interval;
                if (hello !== undefined && settings?.dead_interval === undefined)
                    found.push(
                        warn(
                            `${where}.interfaces.${name} has hello_interval without dead_interval. Platforms differ in the dead interval they then use, and neighbors whose dead intervals differ never come up. Write dead_interval, such as ${hello * OspfChecks.DEAD_HELLOS}`
                        )
                    );
            }
        }

        return found;
    }

    private static within(value: number, min: number, max: number): boolean {
        return Number.isInteger(value) && value >= min && value <= max;
    }

    /** Each range is a prefix of a family OSPF runs, written once in its area, on a border router: a device in two areas or more. */
    private static ranges(device: Device, ospf: Ospf, areaId: string, area: OspfArea, report: Report): void {
        const ranges = area.ranges ?? [];
        if (!ranges.length) return;

        const where = `routing.ospf.areas.${areaId}`;
        const families = ospf.address_families ?? ["ipv4"];
        const seen = new Set<string>();
        ranges.forEach(({ prefix, advertise, cost }, index) => {
            if (cost !== undefined && !OspfChecks.within(cost, 0, OspfChecks.MAX_SUMMARY_COST))
                report(`${where}.ranges[${index}].cost is ${cost}: write a whole number from 0 to ${OspfChecks.MAX_SUMMARY_COST}`);
            if (cost !== undefined && !advertise)
                report(`${where}.ranges[${index}].cost: a range with advertise false is announced at no cost. Remove cost`);

            const at = `${where}.ranges[${index}].prefix`;
            if (!Address.isCidr(prefix)) {
                report(`${at}: '${prefix}' is not an address with a length, such as 10.1.0.0/16`);
                return;
            }
            if (Address.prefixOf(prefix) !== Address.canonical(prefix))
                report(`${at} ${prefix} has bits past its length: write ${Address.prefixOf(prefix)}`);

            const family = Address.family(prefix);
            if (!families.includes(family))
                report(
                    `${at} ${prefix} is ${family}, which OSPF doesn't route here. Add ${family} to routing.ospf.address_families, or remove the range`
                );

            const network = Address.prefixOf(prefix);
            if (seen.has(network)) report(`${at}: ${prefix} is in ${where}.ranges twice. Remove one`);
            seen.add(network);
        });

        if (OspfChecks.inAreas(ospf).length < 2)
            report(
                `${where}.ranges: ${device.name} is in one area only, so it is no border router and announces no summary. Remove ranges, or write them on the border router`
            );
    }

    /** The areas the device has an interface in. */
    private static inAreas(ospf: Ospf): string[] {
        return Object.entries(ospf.areas)
            .filter(([, area]) => Object.values(area.interfaces).some(Boolean))
            .map(([areaId]) => areaId);
    }

    /** Each virtual link is in the backbone of a border router, across a normal area the device is in, to another router (RFC 2328, section 15). */
    private static virtualLinks(device: Device, ospf: Ospf, areaId: string, area: OspfArea, report: Report): void {
        const links = area.virtual_links ?? [];
        if (!links.length) return;

        const where = `routing.ospf.areas.${areaId}.virtual_links`;
        if (areaId !== OspfChecks.BACKBONE) {
            report(`${where}: a virtual link is part of the backbone. Move it to routing.ospf.areas.${OspfChecks.BACKBONE}`);
            return;
        }
        const inAreas = OspfChecks.inAreas(ospf);
        if (inAreas.length < 2)
            report(
                `${where}: ${device.name} is in one area only, so it is no border router, and a virtual link joins two border routers. Remove virtual_links, or write them on a border router`
            );
        const own = device.routing?.router_id;
        if (!own)
            report(`${where}: the far end knows this device by its router ID. Write routing.router_id, such as the loopback's address`);

        const seen = new Set<string>();
        links.forEach(({ transit_area_id: transit, router_id: far }, index) => {
            const at = `${where}[${index}]`;
            const transitArea = ospf.areas[transit];
            if (transit === OspfChecks.BACKBONE)
                report(
                    `${at}.transit_area_id: a virtual link crosses an area other than the backbone. Write the area both border routers are in`
                );
            else if (!transitArea || !inAreas.includes(transit))
                report(
                    `${at}.transit_area_id ${transit}: ${device.name} has no interface in that area. Write an area of routing.ospf.areas that both border routers have interfaces in`
                );
            else if (transitArea.type)
                report(
                    `${at}.transit_area_id ${transit} is ${transitArea.type === "stub" ? "a stub area" : "an NSSA"}, which carries no virtual link (RFC 2328, RFC 3101). Write a normal area`
                );

            if (!Address.isValid(far) || Address.family(far) !== "ipv4")
                report(`${at}.router_id: '${far}' is not an IPv4 address. Write the far border router's router ID`);
            else if (far === own) report(`${at}.router_id ${far} is ${device.name}'s own. Write the far border router's router ID`);

            const link = `${transit} ${far}`;
            if (seen.has(link)) report(`${at}: the virtual link across ${transit} to ${far} is in ${where} twice. Remove one`);
            seen.add(link);
        });
    }

    /** One interface's settings: its timers, key, priority, and the neighbors it sends its hellos to. */
    private static iface(device: Device, ospf: Ospf, at: string, name: string, settings: OspfInterface, report: Report): void {
        const vrf = Derive.settings(device, name)?.vrf;
        if (vrf && !ospf.vrf)
            report(`${at}: ${name} routes in VRF ${vrf}, and OSPF in the main table. Write vrf: "${vrf}" in routing.ospf`);
        if (ospf.vrf && vrf !== ospf.vrf)
            report(
                `${at}: ${name} routes in ${vrf ? `VRF ${vrf}` : "the main table"}, and OSPF in VRF ${ospf.vrf}. Write vrf: "${ospf.vrf}" on ${name}, or remove it from the area`
            );

        for (const key of ["hello_interval", "dead_interval"] as const) {
            const seconds = settings[key];
            if (seconds !== undefined && !OspfChecks.within(seconds, 1, OspfChecks.MAX_INTERVAL))
                report(`${at}.${key} is ${seconds}: write a whole number of seconds from 1 to ${OspfChecks.MAX_INTERVAL}`);
        }

        const hello = settings.hello_interval ?? OspfChecks.HELLO_INTERVAL;
        const dead = settings.dead_interval;
        if (dead !== undefined && dead <= hello)
            report(
                `${at}.dead_interval ${dead} is not more than hello_interval ${hello}, so a neighbor would go down between two hellos. Write ${hello * OspfChecks.DEAD_HELLOS}, four times hello_interval`
            );

        const authentication = settings.authentication;
        if (authentication && !OspfChecks.within(authentication.key_id, 0, OspfChecks.MAX_OCTET))
            report(`${at}.authentication.key_id is ${authentication.key_id}: write a whole number from 0 to ${OspfChecks.MAX_OCTET}`);
        if (authentication && ospf.address_families?.includes("ipv6"))
            report(
                `${at}.authentication with OSPFv3: Circuit signs OSPFv2 only, and each platform signs OSPFv3 its own way. Remove authentication, or ipv6 from routing.ospf.address_families`
            );

        const network = settings.network ?? OspfChecks.DEFAULT_NETWORK;
        const priority = settings.priority;
        if (priority !== undefined && !OspfChecks.within(priority, 0, OspfChecks.MAX_OCTET))
            report(`${at}.priority is ${priority}: write a whole number from 0 to ${OspfChecks.MAX_OCTET}`);
        if (priority !== undefined && !OspfChecks.ELECTING.includes(network))
            report(`${at}.priority: no designated router is elected on a ${network} link. Remove priority`);

        OspfChecks.neighbors(device, ospf, at, name, settings, report);
    }

    /** An NBMA link lists its neighbors, and a point-to-multipoint link may. Each is an IPv4 address on one of the interface's networks. Other links find their neighbors by multicast. */
    private static neighbors(device: Device, ospf: Ospf, at: string, name: string, settings: OspfInterface, report: Report): void {
        const network = settings.network ?? OspfChecks.DEFAULT_NETWORK;
        const neighbors = settings.neighbors ?? [];
        const unicast = OspfChecks.UNICAST.includes(network);

        if (network === "non-broadcast" && !neighbors.length)
            report(
                `${at}: a non-broadcast link carries no multicast, so the device finds no neighbor there by itself. Write the address of each in neighbors`
            );
        if (!unicast && settings.neighbors)
            report(
                `${at}.neighbors: a ${network} link finds its neighbors by multicast. Remove neighbors, or write network: "non-broadcast" or "point-to-multipoint"`
            );
        if (unicast && ospf.address_families?.includes("ipv6"))
            report(
                `${at}.network ${network} with OSPFv3: Circuit runs ${network} links for OSPFv2 only. Write another network, or remove ipv6 from routing.ospf.address_families`
            );

        const addresses = (Derive.settings(device, name)?.addresses ?? []).map((entry) =>
            typeof entry === "string" ? entry : entry.address
        );
        const networks = addresses.filter((address) => Address.isCidr(address) && Address.family(address) === "ipv4");
        const seen = new Set<string>();
        neighbors.forEach((neighbor, index) => {
            const where = `${at}.neighbors[${index}]`;
            if (!Address.isValid(neighbor) || Address.family(neighbor) !== "ipv4") {
                report(`${where}: '${neighbor}' is not an IPv4 address`);
                return;
            }
            if (networks.some((address) => Address.host(address) === neighbor))
                report(`${where} ${neighbor} is ${name}'s own address. Write the neighbor's`);
            else if (!networks.some((address) => Address.contains(address, neighbor)))
                report(`${where} ${neighbor} is on no IPv4 network of ${name}. Write the neighbor's address on this link`);
            if (seen.has(neighbor)) report(`${where}: ${neighbor} is in neighbors twice. Remove one`);
            seen.add(neighbor);
        });
    }
}
