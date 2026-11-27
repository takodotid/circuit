// IS-IS on Raisecom ROS: one process, `router isis 1`, and each interface's settings on the interface. A RAX721 on ROS 6.5.2 took each line and printed it as written here, on a VLAN interface with no port, where no adjacency came up (TRAPS.md).

import { Secrets } from "../../core/secrets";
import type { Device, Isis } from "../../model";
import type { Group } from "../line-diff";

export class RaisecomRosIsis {
    static readonly PROCESS = 1;

    /** The process's header. */
    static readonly HEADER = /^router isis \d+$/;

    /** The switch's `is-type` for each of the language's levels. Both levels is its default, which it does not print. */
    private static readonly IS_TYPE: Record<Isis["level_capability"], string | undefined> = {
        "level-1": "level-1",
        "level-2": "level-2-only",
        "level-1-2": undefined,
    };

    /** The policies IS-IS uses: the one that picks the level 2 routes it leaks. */
    static policies(device: Device): string[] {
        const leak = device.routing?.isis?.level2_to_level1;
        return leak ? [leak.import_policy] : [];
    }

    /** The process: its NET, wide metrics, its levels, the overload bit, and each level's key. Then the level 2 routes it leaks into level 1, in the order the switch prints them. */
    static process(device: Device): string[] {
        const isis = device.routing?.isis;
        if (!isis) return [];

        const lines = [`net ${isis.net}`, "metric-style wide"];
        if (isis.overload_bit) lines.push("set-overload-bit");
        const level = RaisecomRosIsis.IS_TYPE[isis.level_capability];
        if (level) lines.push(`is-type ${level}`);

        // Level 1 signs its LSPs with the area's key, and level 2 with the domain's.
        const key = isis.authentication?.key;
        if (key && isis.level_capability !== "level-2") lines.push(`area-password md5 ${Secrets.marker(key)}`);
        if (key && isis.level_capability !== "level-1") lines.push(`domain-password md5 ${Secrets.marker(key)}`);

        const leak = isis.level2_to_level1;
        if (leak) lines.push(`redistribute isis ip level-2 into level-1 route-map ${leak.import_policy}`);

        return [`router isis ${RaisecomRosIsis.PROCESS}`, ...lines.map((line) => `  ${line}`), "!"];
    }

    /** An interface's IS-IS lines: it joins the process for IPv4, then its link type, metric, whether it is silent, BFD, and the key of its hellos. */
    static interfaceLines(device: Device, name: string): string[] {
        const isis = device.routing?.isis;
        if (!isis || !(name in isis.interfaces)) return [];

        const settings = isis.interfaces[name] ?? {};
        const lines = [`ip router isis ${RaisecomRosIsis.PROCESS}`];
        if (settings.network === "point-to-point") lines.push("isis network point-to-point");
        if (settings.metric !== undefined) lines.push(`isis metric ${settings.metric}`);
        if (settings.passive) lines.push("isis passive");
        if (settings.bfd) lines.push("isis bfd enable");
        if (isis.authentication) lines.push(`isis password md5 ${Secrets.marker(isis.authentication.key)}`);
        return lines;
    }

    /** Which lines of the process are one setting with two values, or undefined for another line. A device may hold several NETs, so a new one is added beside the old. */
    static head(line: string): string | undefined {
        if (line.startsWith("net ")) return line;
        return /^(area-password|domain-password|isis password|redistribute isis ip level-2 into level-1) /.exec(line)?.[1];
    }

    /** The undo of an IS-IS line that is not the line with `no` before it, or undefined. */
    static undo(line: string): string | undefined {
        // `no isis network` is incomplete, so a link type goes with the whole line.
        const keyword =
            /^(area-password|domain-password|isis password|is-type|isis metric|redistribute isis ip level-2 into level-1) /.exec(line);
        return keyword ? `no ${keyword[1]}` : undefined;
    }

    /** A process that goes is removed once each interface has let go of it: taken out of `top`, and returned. */
    static removed(top: Group | undefined): string[] {
        const gone = top?.remove.filter((line) => RaisecomRosIsis.HEADER.test(line)) ?? [];
        if (top) top.remove = top.remove.filter((line) => !gone.includes(line));
        return gone;
    }

    /** IS-IS for IPv4, on routed ports, loopbacks, and VLAN interfaces, with one key for every level. */
    static unsupported(device: Device, routesHere: (name: string) => boolean): string[] {
        const isis = device.routing?.isis;
        if (!isis) return [];

        const found: string[] = [];
        if (isis.address_families.includes("ipv6")) found.push("routing.isis.address_families ipv6, IS-IS runs for IPv4 here");
        if (isis.multi_topology) found.push("routing.isis.multi_topology, ROS 6.5.2 has none");
        if (isis.levels)
            found.push("routing.isis.levels, the switch signs an interface's hellos with one key for both levels: write authentication");

        const auth = isis.authentication;
        if (auth && auth.algorithm !== "hmac-md5")
            found.push(`routing.isis.authentication, with ${auth.algorithm}: the switch signs IS-IS with HMAC-MD5 alone`);

        for (const name of Object.keys(isis.interfaces))
            if (!routesHere(name))
                found.push(`routing.isis.interfaces.${name}, IS-IS runs on routed ports, loopbacks, and VLAN interfaces here`);

        return found;
    }
}
