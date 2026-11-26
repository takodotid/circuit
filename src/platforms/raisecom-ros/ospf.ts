// OSPF on Raisecom ROS: one process, `router ospf 1`, its networks and areas, and each interface's settings on the interface. A RAX721 on ROS 6.5.2 showed which commands it has and how it prints them.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device, OspfInterface } from "../../model";

export class RaisecomRosOspf {
    static readonly PROCESS = 1;

    /** A router's priority unless set, which the switch does not print. */
    private static readonly PRIORITY = 1;

    /** The hello interval of a link unless set, which the switch does not print: an NBMA link's is longer. Its dead interval is four hellos unless set. */
    private static readonly HELLO = 10;
    private static readonly NBMA_HELLO = 30;
    private static readonly HELLOS_PER_DEAD = 4;

    /** The key IDs an MD5 key takes. */
    static readonly KEY_ID = { min: 1, max: 255 };

    /** What tako-mmr-01 took, printed, and planned empty, but never removed one by one: the switch restarted before the removal reached them. */
    static experimental(device: Device): string[] {
        const found: string[] = [];

        for (const [areaId, area] of Object.entries(device.routing?.ospf?.areas ?? {})) {
            const where = `routing.ospf.areas.${areaId}`;
            for (const key of ["type", "no_summaries", "stub_default_cost", "ranges"] as const)
                if (area[key] !== undefined) found.push(`${where}.${key}`);

            for (const [name, settings] of Object.entries(area.interfaces)) {
                for (const key of ["hello_interval", "dead_interval", "priority", "neighbors", "authentication"] as const)
                    if (settings?.[key] !== undefined) found.push(`${where}.interfaces.${name}.${key}`);
                if (settings?.network === "non-broadcast") found.push(`${where}.interfaces.${name}.network`);
            }
        }

        return found;
    }

    /** The OSPF settings of an interface, from the area that holds it. */
    static settingsOf(device: Device, name: string): OspfInterface | undefined {
        return Object.values(device.routing?.ospf?.areas ?? {}).find((area) => area.interfaces[name])?.interfaces[name];
    }

    /** An interface's OSPF lines. The network type comes first: a new one sets the timers back to its own. */
    static interfaceLines(device: Device, name: string): string[] {
        const settings = RaisecomRosOspf.settingsOf(device, name);
        // A loopback forms no adjacency, and takes no OSPF setting: `unsupported()` refuses any.
        if (!settings || device.interfaces?.loopback?.[name]) return [];

        const lines: string[] = [];
        const nbma = settings.network === "non-broadcast";
        if (settings.network === "point-to-point") lines.push("ip ospf network ptp");
        if (nbma) lines.push("ip ospf network non-broadcast");

        // The switch prints a hello interval other than the link's own, and a dead interval other than four hellos.
        const hello = settings.hello_interval ?? (nbma ? RaisecomRosOspf.NBMA_HELLO : RaisecomRosOspf.HELLO);
        if (settings.hello_interval !== undefined && hello !== (nbma ? RaisecomRosOspf.NBMA_HELLO : RaisecomRosOspf.HELLO))
            lines.push(`ip ospf hello-interval ${hello}`);
        if (settings.dead_interval !== undefined && settings.dead_interval !== hello * RaisecomRosOspf.HELLOS_PER_DEAD)
            lines.push(`ip ospf dead-interval ${settings.dead_interval}`);

        if (settings.cost !== undefined) lines.push(`ip ospf cost ${settings.cost}`);
        if (settings.priority !== undefined && settings.priority !== RaisecomRosOspf.PRIORITY)
            lines.push(`ip ospf priority ${settings.priority}`);

        const auth = settings.authentication;
        if (auth) lines.push("ip ospf authentication md5", `ip ospf authentication-key md5 ${auth.key_id} 0 ${Secrets.marker(auth.key)}`);

        if (settings.passive) lines.push("ip ospf passive-interface enable");
        if (settings.bfd) lines.push("ip ospf bfd");
        return lines;
    }

    /** The process: its networks by area, each area's type and ranges, the neighbors of its NBMA links, and what it redistributes. */
    static process(device: Device): string[] {
        const ospf = device.routing?.ospf;
        if (!ospf) return [];

        const routerId = device.routing?.router_id;
        const lines = [
            `router ospf ${RaisecomRosOspf.PROCESS}${ospf.vrf ? ` vrf ${ospf.vrf}` : ""}${routerId ? ` router-id ${routerId}` : ""}`,
        ];

        for (const [areaId, area] of Object.entries(ospf.areas)) {
            for (const [iface, settings] of Object.entries(area.interfaces)) {
                if (!settings) continue;
                for (const prefix of Derive.ipv4Networks(device, iface))
                    lines.push(`network ${Address.host(prefix)} ${Address.wildcard(Address.split(prefix).len)} area ${areaId}`);
            }

            if (area.type) lines.push(`area ${areaId} ${area.type}${area.no_summaries ? " no-summary" : ""}`);
            if (area.stub_default_cost !== undefined) lines.push(`area ${areaId} default-cost ${area.stub_default_cost}`);
            for (const range of area.ranges ?? []) {
                const { addr, len } = Address.split(range.prefix);
                if (Address.family(addr) === "ipv4")
                    lines.push(`area ${areaId} range ${addr} ${Address.netmask(len)}${range.advertise ? "" : " not-advertise"}`);
            }
            for (const settings of Object.values(area.interfaces))
                for (const neighbor of settings?.neighbors ?? []) lines.push(`neighbor ${neighbor}`);
        }

        for (const source of ospf.redistribute ?? []) lines.push(`redistribute ${source}`);
        return [...lines, "!"];
    }
}
