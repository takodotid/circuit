// DHCPv6 servers on VRP (RFC 9915): a pool for each, named after it, which its VLAN interface serves with `dhcpv6 server`. A CE6855 on V200R005C00SPC800 committed them on a VLAN interface with no ports (TRAPS.md).

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device, Dhcpv6Server } from "../../model";
import type { Group } from "../line-diff";
import { VrpPolicies } from "./policies";

export class VrpDhcpv6 {
    /** A pool name the switch takes: it refused one with a `-` (`Wrong parameter`). */
    private static readonly NAME = /^[A-Za-z0-9_]+$/;

    /** The longest pool name the switch takes. */
    private static readonly NAME_LENGTH = 31;

    /** The lifetimes the switch takes, in seconds. */
    private static readonly LIFETIME_S = { min: 60, max: 8_640_000 };

    /** The most addresses a pool leaves out: a CE6855 refused more, "It is up to the max number 1024". */
    private static readonly EXCLUDED = 1024n;

    /** The longest prefix of a pool: a CE6855 refused a /128, "None valid address is available". */
    private static readonly LONGEST = 127;

    /** A line of a pool that holds one of its values, so a new one is added beside it and the old one undone. */
    private static readonly LISTED = /^(excluded-address|dns-server) /;

    /**
     * Each server's pool: the smallest prefix that holds `pool`, with the lease as both lifetimes and the addresses outside `pool` excluded, then the DNS servers. A pool without `pool` gives DNS servers alone. The switch prints addresses in capitals.
     */
    static blocks(device: Device): string[] {
        const lines: string[] = [];

        for (const [name, server] of Object.entries(device.services?.dhcpv6_server ?? {})) {
            const body: string[] = [];

            if (server.pool) {
                const { prefix, excluded } = VrpDhcpv6.addresses(server.pool);
                const lease = server.lease_time;
                const lifetimes = lease === undefined ? "" : ` life-time ${lease} ${lease}`;
                body.push(`address prefix ${prefix}${lifetimes}`);
                for (const [first, last] of excluded) body.push(`excluded-address ${first === last ? first : `${first} to ${last}`}`);
            }

            for (const resolver of server.dns ?? []) body.push(`dns-server ${VrpPolicies.spell(resolver)}`);
            lines.push(`dhcpv6 pool ${name}`, ...body.map((line) => ` ${line}`), "#");
        }

        return lines;
    }

    /** `dhcpv6 server <pool>` for the server on this VLAN interface. */
    static interfaceLines(device: Device, iface: string): string[] {
        return Object.entries(device.services?.dhcpv6_server ?? {})
            .filter(([, server]) => server.interface === iface)
            .map(([name]) => `dhcpv6 server ${name}`);
    }

    /** Whether the device serves DHCPv6, which `dhcpv6 enable` turns on. */
    static serves(device: Device): boolean {
        return Object.keys(device.services?.dhcpv6_server ?? {}).length > 0;
    }

    /** What the switch can't serve as the config says. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const servers = Object.entries(device.services?.dhcpv6_server ?? {});
        const { min, max } = VrpDhcpv6.LIFETIME_S;

        for (const [name, server] of servers) {
            const where = `services.dhcpv6_server.${name}`;

            if (!VrpDhcpv6.NAME.test(name) || name.length > VrpDhcpv6.NAME_LENGTH)
                found.push(
                    `${where}, a pool name of letters, digits, and '_', ${VrpDhcpv6.NAME_LENGTH} characters at most: the switch refuses a '-'`
                );
            if (!device.interfaces?.vlan_interface?.[server.interface])
                found.push(`${where}.interface, the switch serves DHCPv6 on VLAN interfaces`);
            if (server.pool && Derive.dhcpv6Network(device, server)) {
                const { prefix, excluded } = VrpDhcpv6.addresses(server.pool);
                const left = excluded.reduce((sum, [first, last]) => sum + Address.toNumber(last)! - Address.toNumber(first)! + 1n, 0n);
                if (left > VrpDhcpv6.EXCLUDED)
                    found.push(
                        `${where}.pool, which leaves ${left} addresses of ${prefix} out: the switch gives the addresses of one prefix, and leaves ${VrpDhcpv6.EXCLUDED} out at most. Write a pool that fills a prefix, or nearly`
                    );
            }
            // A CE6855 on V200R005 refused `prefix-delegation` in a pool with `Unrecognized command`.
            if (server.prefix_delegation) found.push(`${where}.prefix_delegation, V200R005 delegates no prefixes`);

            const lease = server.lease_time;
            if (lease !== undefined && !server.pool) found.push(`${where}.lease_time without pool, which the switch gives no lifetime`);
            if (lease !== undefined && !(Number.isInteger(lease) && lease >= min && lease <= max))
                found.push(`${where}.lease_time, whole seconds from ${min} to ${max} on the platform`);
        }

        return found;
    }

    /** The undo of a pool's line: its range by the network alone, and each listed value by itself. Undefined for any other line. */
    static undo(line: string, path: readonly string[]): string | undefined {
        if (!path[0]?.startsWith("dhcpv6 pool ")) return undefined;

        const range = /^address prefix (\S+)/.exec(line);
        if (range) return `undo address prefix ${range[1]}`;
        return VrpDhcpv6.LISTED.test(line) ? `undo ${line}` : undefined;
    }

    /** A pool's lines each hold one value. Its prefix takes new lifetimes in place, but a new prefix overlaps the old one, which goes first. */
    static head(line: string): string | undefined {
        if (VrpDhcpv6.LISTED.test(line)) return line;
        return /^address prefix \S+/.exec(line)?.[0];
    }

    /** A pool's old prefix is undone after the addresses it excluded. */
    static order(groups: Group[]): void {
        for (const group of groups) {
            if (group.path.length !== 1 || !group.path[0]!.startsWith("dhcpv6 pool ")) continue;
            const prefixes = group.remove.filter((line) => line.startsWith("address prefix "));
            group.remove = [...group.remove.filter((line) => !prefixes.includes(line)), ...prefixes];
        }
    }

    /** The smallest prefix that holds `pool`, a /127 at the longest, and the addresses in it outside `pool`, as ranges, in the switch's spelling. */
    private static addresses(pool: NonNullable<Dhcpv6Server["pool"]>): { prefix: string; excluded: [string, string][] } {
        const [low, high] = pool.map((address) => Address.toNumber(address)!) as [bigint, bigint];
        const bits = Address.bits("ipv6");
        let length = VrpDhcpv6.LONGEST;
        while (length > 0 && low >> BigInt(bits - length) !== high >> BigInt(bits - length)) length--;

        const size = 1n << BigInt(bits - length);
        const first = (low / size) * size;
        const ranges: [bigint, bigint][] = [
            [first, low - 1n],
            [high + 1n, first + size - 1n],
        ];
        const spell = (value: bigint) => VrpPolicies.spell(Address.fromNumber(value, "ipv6"));

        return {
            prefix: `${spell(first)}/${length}`,
            excluded: ranges.filter(([from, to]) => from <= to).map(([from, to]) => [spell(from), spell(to)]),
        };
    }
}
