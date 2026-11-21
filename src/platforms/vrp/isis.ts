// IS-IS on VRP: one process, `isis 1`, and the VLAN interfaces that run it. The commands are from Huawei's CloudEngine command reference. A CE6855 on V200R005C00SPC800 committed the process, with no interface, and showed how it prints it (TRAPS.md).

import type { Device, Isis } from "../../model";
import type { Group } from "../line-diff";

export class VrpIsis {
    /** One process per device, as for OSPF. */
    private static readonly PROCESS = 1;

    /** `is-level` for each level capability. Both levels is the switch's default, which it does not print. */
    private static readonly LEVEL: Record<Isis["level_capability"], string | undefined> = {
        "level-1": "level-1",
        "level-2": "level-2",
        "level-1-2": undefined,
    };

    /** What leaks level 2 routes into level 1, for each family. */
    private static readonly LEAK = {
        ipv4: "import-route isis level-2 into level-1 filter-policy route-policy",
        ipv6: "ipv6 import-route isis level-2 into level-1 filter-policy route-policy",
    } as const;

    /** The process's header: `isis 1`. */
    private static readonly HEADER = /^isis \d+$/;

    /** The policies IS-IS uses: the one that picks the level 2 routes it leaks. */
    static policies(device: Device): string[] {
        const leak = device.routing?.isis?.level2_to_level1;
        return leak ? [leak.import_policy] : [];
    }

    /**
     * The process: its level, wide metrics, its NET, and the leak for each family. IPv6 shares IPv4's topology (RFC 5308), `topology standard`, unless `multi_topology` gives it its own, `topology ipv6`. The switch prints the IPv6 lines in a section of their own, after ` #`, which the read ignores.
     */
    static lines(device: Device): string[] {
        const isis = device.routing?.isis;
        if (!isis) return [];

        const level = VrpIsis.LEVEL[isis.level_capability];
        const policy = isis.level2_to_level1?.import_policy;
        const ipv4 = isis.address_families.includes("ipv4");
        const ipv6 = isis.address_families.includes("ipv6");
        const lines = [
            ...(level ? [`is-level ${level}`] : []),
            "cost-style wide",
            `network-entity ${isis.net}`,
            ...(policy && ipv4 ? [`${VrpIsis.LEAK.ipv4} ${policy}`] : []),
            ...(isis.overload_bit ? ["set-overload"] : []),
            ...(ipv6 ? [`ipv6 enable topology ${isis.multi_topology ? "ipv6" : "standard"}`] : []),
            ...(policy && ipv6 ? [`${VrpIsis.LEAK.ipv6} ${policy}`] : []),
        ];

        return [`isis ${VrpIsis.PROCESS}`, ...lines.map((line) => ` ${line}`), "#"];
    }

    /** A VLAN interface's IS-IS: the process for each family, its link type, its metric, and whether it is silent. In a topology of its own, IPv6 has a metric of its own, which the config's one metric sets too. */
    static interfaceLines(device: Device, name: string): string[] {
        const isis = device.routing?.isis;
        const settings = isis?.interfaces[name];
        if (!isis || !(name in isis.interfaces)) return [];

        const families = isis.address_families;
        const metric = settings?.metric;
        return [
            ...(families.includes("ipv4") ? [`isis enable ${VrpIsis.PROCESS}`] : []),
            ...(families.includes("ipv6") ? [`isis ipv6 enable ${VrpIsis.PROCESS}`] : []),
            ...(settings?.network === "point-to-point" ? ["isis circuit-type p2p"] : []),
            ...(metric === undefined ? [] : [`isis cost ${metric}`]),
            ...(metric !== undefined && isis.multi_topology ? [`isis ipv6 cost ${metric}`] : []),
            ...(settings?.passive ? ["isis silent"] : []),
        ];
    }

    /** The lines taken away by their keyword alone, or without the policy they name. Undefined for any other line. */
    static undo(line: string, path: readonly string[]): string | undefined {
        if (line.startsWith("isis circuit-type ")) return "undo isis circuit-type";
        if (!path[0] || !VrpIsis.HEADER.test(path[0])) return undefined;

        const leak = /^((?:ipv6 )?import-route isis level-2 into level-1) /.exec(line);
        if (leak) return `undo ${leak[1]}`;
        const keyword = /^(is-level|cost-style|ipv6 enable) /.exec(line);
        return keyword ? `undo ${keyword[1]}` : undefined;
    }

    /** A process that goes is removed once each interface has let go of it, and before the policies it used: taken out of `top`, and returned. */
    static removed(top: Group | undefined): string[] {
        const gone = top?.remove.filter((line) => VrpIsis.HEADER.test(line)) ?? [];
        if (top) top.remove = top.remove.filter((line) => !gone.includes(line));
        return gone;
    }

    /** What IS-IS can't do here yet. VRP routes on VLAN interfaces only. Authentication and BFD are not built. */
    static unsupported(device: Device): string[] {
        const isis = device.routing?.isis;
        if (!isis) return [];

        const notBuilt = "not built yet";
        const found: string[] = [];
        if (isis.authentication) found.push(`routing.isis.authentication, ${notBuilt}`);
        for (const [level, settings] of Object.entries(isis.levels ?? {}))
            if (settings?.authentication) found.push(`routing.isis.levels.${level}.authentication, ${notBuilt}`);

        for (const [name, settings] of Object.entries(isis.interfaces)) {
            const where = `routing.isis.interfaces.${name}`;
            if (!device.interfaces?.vlan_interface?.[name])
                found.push(`${where}, not a VLAN interface: the platform routes on VLAN interfaces`);
            if (settings?.bfd) found.push(`${where}.bfd, ${notBuilt}`);
        }

        return found;
    }

    /** A CE6855 committed the process with no interface. How it prints IS-IS on a VLAN interface is not known. */
    static experimental(device: Device): string[] {
        return Object.keys(device.routing?.isis?.interfaces ?? {}).map((name) => `routing.isis.interfaces.${name}`);
    }
}
