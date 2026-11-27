// IS-IS on VRP: one process, `isis 1`, and the VLAN interfaces and routed ports that run it. The commands are from Huawei's CloudEngine command reference. A CE6855 on V200R005C00SPC800 committed the process, VLAN interfaces that run it, its keys, and BFD, and showed how it prints them (TRAPS.md).

import { Secrets } from "../../core/secrets";
import type { Device, Isis, IsisAuthentication } from "../../model";
import type { Group } from "../line-diff";
import { VrpRoutedPorts } from "./routed-ports";

/** A level the device runs. */
type Level = 1 | 2;

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

    /** Each algorithm the platform signs with. V200R005 has no HMAC-SHA-1: the CE6855 refused `hmac-sha1`. */
    static readonly AUTH: Partial<Record<IsisAuthentication["algorithm"], string>> = { "hmac-md5": "md5", "hmac-sha-256": "hmac-sha256" };

    /** The process's line that signs a level's LSPs and sequence number packets: level 1's area, and level 2's domain. */
    private static readonly LEVEL_AUTH: Record<Level, string> = { 1: "area-authentication-mode", 2: "domain-authentication-mode" };

    /** The process's header: `isis 1`. */
    private static readonly HEADER = /^isis \d+$/;

    /** The policies IS-IS uses: the one that picks the level 2 routes it leaks. */
    static policies(device: Device): string[] {
        const leak = device.routing?.isis?.level2_to_level1;
        return leak ? [leak.import_policy] : [];
    }

    /**
     * The process: its level, wide metrics, its NET, each level's key, and the leak for each family. IPv6 shares IPv4's topology (RFC 5308), `topology standard`, unless `multi_topology` gives it its own, `topology ipv6`. The switch prints the IPv6 lines in a section of their own, after ` #`, which the read ignores.
     */
    static lines(device: Device): string[] {
        const isis = device.routing?.isis;
        if (!isis) return [];

        const level = VrpIsis.LEVEL[isis.level_capability];
        const policy = isis.level2_to_level1?.import_policy;
        const ipv4 = isis.address_families.includes("ipv4");
        const ipv6 = isis.address_families.includes("ipv6");
        const keys = Object.entries(VrpIsis.keys(isis)).map(
            ([at, key]) => `${VrpIsis.LEVEL_AUTH[Number(at) as Level]} ${VrpIsis.signed(key)}`
        );
        const lines = [
            ...(level ? [`is-level ${level}`] : []),
            "cost-style wide",
            `network-entity ${isis.net}`,
            ...keys,
            ...(policy && ipv4 ? [`${VrpIsis.LEAK.ipv4} ${policy}`] : []),
            ...(isis.overload_bit ? ["set-overload"] : []),
            ...(ipv6 ? [`ipv6 enable topology ${isis.multi_topology ? "ipv6" : "standard"}`] : []),
            ...(policy && ipv6 ? [`${VrpIsis.LEAK.ipv6} ${policy}`] : []),
        ];

        return [`isis ${VrpIsis.PROCESS}`, ...lines.map((line) => ` ${line}`), "#"];
    }

    /**
     * A VLAN interface's IS-IS: the process for each family, its link type, its metric, whether it is silent, the key of its hellos, and BFD with `bfd`, the device's timers. In a topology of its own, IPv6 has a metric of its own, which the config's one metric sets too. A hello is signed with the key of its level, or with the one key when both levels have it.
     */
    static interfaceLines(device: Device, name: string, bfd: readonly string[]): string[] {
        const isis = device.routing?.isis;
        const settings = isis?.interfaces[name];
        if (!isis || !(name in isis.interfaces)) return [];

        const families = isis.address_families;
        const metric = settings?.metric;
        const keys = Object.entries(VrpIsis.keys(isis)).map(([level, key]) => [level, VrpIsis.signed(key)] as const);
        const oneKey = new Set(keys.map(([, signed]) => signed)).size === 1;
        const hellos = oneKey
            ? [`isis authentication-mode ${keys[0]![1]}`]
            : keys.map(([level, signed]) => `isis authentication-mode ${signed} level-${level}`);

        return [
            ...(families.includes("ipv4") ? [`isis enable ${VrpIsis.PROCESS}`] : []),
            ...(families.includes("ipv6") ? [`isis ipv6 enable ${VrpIsis.PROCESS}`] : []),
            ...(settings?.network === "point-to-point" ? ["isis circuit-type p2p"] : []),
            ...(metric === undefined ? [] : [`isis cost ${metric}`]),
            ...(metric !== undefined && isis.multi_topology ? [`isis ipv6 cost ${metric}`] : []),
            ...(settings?.passive ? ["isis silent"] : []),
            ...(keys.length ? hellos : []),
            ...(settings?.bfd ? ["isis bfd enable", ...bfd] : []),
        ];
    }

    /** Whether a VLAN interface runs IS-IS for IPv6, which the switch takes only once IPv6 is on there. */
    static runsIpv6(device: Device, name: string): boolean {
        const isis = device.routing?.isis;
        return Boolean(isis && name in isis.interfaces && isis.address_families.includes("ipv6"));
    }

    /** Whether any interface runs BFD for IS-IS. */
    static wantsBfd(device: Device): boolean {
        return Object.values(device.routing?.isis?.interfaces ?? {}).some((settings) => settings?.bfd);
    }

    /** Each level the device runs that has a key: the level's own, or the device's one key. */
    private static keys(isis: Isis): Partial<Record<Level, IsisAuthentication>> {
        const runs: Record<Level, boolean> = { 1: isis.level_capability !== "level-2", 2: isis.level_capability !== "level-1" };
        const keys: Partial<Record<Level, IsisAuthentication>> = {};

        for (const level of [1, 2] as const) {
            const key = isis.levels?.[level]?.authentication ?? isis.authentication;
            if (runs[level] && key && VrpIsis.AUTH[key.algorithm]) keys[level] = key;
        }

        return keys;
    }

    /** A key as the platform writes it: its algorithm, the key ID that HMAC-SHA-256 carries, and the key. */
    private static signed(key: IsisAuthentication): string {
        const id = key.key_id === undefined ? "" : ` key-id ${key.key_id}`;
        return `${VrpIsis.AUTH[key.algorithm]}${id} cipher ${Secrets.marker(key.key)}`;
    }

    /** A hello's key is one setting for each level, and a level's key one setting of the process: a new one is sent over the old. Undefined for any other line. */
    static head(line: string): string | undefined {
        const hello = /^isis authentication-mode .*?( level-\d)?$/.exec(line);
        if (hello) return `isis authentication-mode${hello[1] ?? ""}`;
        return /^(area|domain)-authentication-mode /.exec(line)?.[0].trim();
    }

    /** The lines taken away by their keyword alone, or without the policy they name. Undefined for any other line. */
    static undo(line: string, path: readonly string[]): string | undefined {
        if (line.startsWith("isis circuit-type ")) return "undo isis circuit-type";
        const hello = /^isis authentication-mode .*?( level-\d)?$/.exec(line);
        if (hello) return `undo isis authentication-mode${hello[1] ?? ""}`;
        if (!path[0] || !VrpIsis.HEADER.test(path[0])) return undefined;

        const leak = /^((?:ipv6 )?import-route isis level-2 into level-1) /.exec(line);
        if (leak) return `undo ${leak[1]}`;
        const keyword = /^(is-level|cost-style|ipv6 enable|area-authentication-mode|domain-authentication-mode) /.exec(line);
        return keyword ? `undo ${keyword[1]}` : undefined;
    }

    /** A process that goes is removed once each interface has let go of it, and before the policies it used: taken out of `top`, and returned. */
    static removed(top: Group | undefined): string[] {
        const gone = top?.remove.filter((line) => VrpIsis.HEADER.test(line)) ?? [];
        if (top) top.remove = top.remove.filter((line) => !gone.includes(line));
        return gone;
    }

    /** What IS-IS can't do here. VRP runs it on VLAN interfaces and routed ports, signs with HMAC-MD5 or HMAC-SHA-256, and sends one hello for both levels on a point-to-point link. */
    static unsupported(device: Device): string[] {
        const isis = device.routing?.isis;
        if (!isis) return [];

        const found: string[] = [];
        const keys = [
            ["routing.isis.authentication", isis.authentication],
            ["routing.isis.levels.1.authentication", isis.levels?.[1]?.authentication],
            ["routing.isis.levels.2.authentication", isis.levels?.[2]?.authentication],
        ] as const;
        for (const [where, key] of keys)
            if (key && !VrpIsis.AUTH[key.algorithm])
                found.push(`${where}.algorithm ${key.algorithm}, the platform signs IS-IS with hmac-md5 or hmac-sha-256`);

        const signed = new Set(Object.values(VrpIsis.keys(isis)).map((key) => VrpIsis.signed(key)));
        for (const [name, settings] of Object.entries(isis.interfaces)) {
            const where = `routing.isis.interfaces.${name}`;
            if (!device.interfaces?.vlan_interface?.[name] && !VrpRoutedPorts.port(device, name))
                found.push(`${where}, neither a VLAN interface nor a routed port: the platform runs IS-IS on those`);
            if (settings?.network === "point-to-point" && signed.size > 1)
                found.push(
                    `${where}.network point-to-point with a key for each level: the platform signs the one hello it sends there for both levels with one key. Write routing.isis.authentication`
                );
        }

        return found;
    }
}
