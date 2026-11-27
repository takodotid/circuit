// DHCP servers: a global address pool for each, named after it. On V200R005 a VLAN interface takes neither `dhcp select` nor `dhcp server`, so no line ties a pool to its interface. The switch picks the pool whose network holds the interface's address, or the address of the relay a request came through. No client has asked one for an address yet, so a DHCP server is experimental.

import { Address } from "../../core/address";
import type { Device, DhcpServer, Port, VlanInterface } from "../../model";
import { LineDiff } from "../line-diff";
import type { Dialect, Group } from "../line-diff";
import { VrpRoutedPorts } from "./routed-ports";

export class VrpDhcp {
    /** The lease the switch gives when the pool sets none, one day. It is not printed. */
    private static readonly DEFAULT_LEASE_S = 86_400;

    private static readonly SECONDS_PER = { day: 86_400, hour: 3600, minute: 60 } as const;

    /** The longest lease the switch takes, 999 days, 23 hours, and 59 minutes. */
    private static readonly MAX_LEASE_S = 999 * 86_400 + 23 * 3600 + 59 * 60;

    /** The most DNS servers a pool gives. */
    private static readonly MAX_DNS = 8;

    /** The longest pool name the switch takes. */
    private static readonly NAME_LENGTH = 64;

    /** Each server's pool, in the order the switch prints its lines. */
    static blocks(device: Device): string[] {
        const lines: string[] = [];

        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
            const { addr, len } = Address.split(Address.prefixOf(server.network));
            const vrf = VrpDhcp.vlanInterface(device, server)?.vrf;
            // The VRF comes first: the switch asks before it binds a pool, and releases the addresses the pool gave.
            const body = [
                ...(vrf ? [`vpn-instance ${vrf}`] : []),
                `gateway-list ${server.gateway}`,
                `network ${addr} mask ${Address.netmask(len)}`,
                ...(server.reservations ?? []).map(
                    (reservation) => `static-bind ip-address ${reservation.address} mac-address ${VrpDhcp.mac(reservation.mac)}`
                ),
                ...VrpDhcp.excluded(server).map(([first, last]) => `excluded-ip-address ${first === last ? first : `${first} ${last}`}`),
                ...VrpDhcp.lease(server.lease_time),
                ...(server.dns?.length ? [`dns-list ${server.dns.join(" ")}`] : []),
            ];

            lines.push(`ip pool ${name}`, ...body.map((line) => ` ${line}`), "#");
        }

        return lines;
    }

    /** A pool's gateway changes only once its network is gone, and the network takes the pool's addresses with it. So a pool whose gateway or network changes is removed and written again, whole. */
    static rebuild(groups: Group[], desired: string, current: string, dialect: Dialect): void {
        const had = new Set(LineDiff.entries(current, dialect).flatMap((entry) => (entry.path.length ? [] : [entry.line])));
        const wanted = LineDiff.entries(desired, dialect);

        for (const group of groups) {
            const [header, ...deeper] = group.path;
            if (!header?.startsWith("ip pool ") || deeper.length || !had.has(header)) continue;
            if (![...group.add, ...group.remove].some((line) => /^(gateway-list|network) /.test(line))) continue;

            let top = groups.find((each) => each.path.length === 0);
            if (!top) {
                top = { path: [], remove: [], add: [] };
                groups.push(top);
            }

            top.remove.push(header);
            group.remove = [];
            group.add = wanted.filter((entry) => entry.path.length === 1 && entry.path[0] === header).map((entry) => entry.line);
        }
    }

    /** What the switch can't serve as the config says. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
            const where = `services.dhcp_server.${name}`;
            const iface = VrpDhcp.vlanInterface(device, server);

            if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.length > VrpDhcp.NAME_LENGTH)
                found.push(`${where}, a pool name of letters, digits, '-', '_' and '.', ${VrpDhcp.NAME_LENGTH} characters at most`);
            if (!iface) found.push(`${where}.interface, the switch serves DHCP on VLAN interfaces and routed ports`);
            // A relay's requests carry its address, by which the switch picks the pool, as it picks a local client's by the interface's.
            else if (server.relay !== undefined && !Address.contains(server.network, server.relay))
                found.push(`${where}.relay, outside ${server.network}: the switch picks a pool by the relay's address`);
            else if (server.relay === undefined && !VrpDhcp.holdsNetwork(iface, server.network))
                found.push(`${where}.interface, which has no address in ${server.network}: the switch picks a pool by that address`);
            if ((server.dns?.length ?? 0) > VrpDhcp.MAX_DNS) found.push(`${where}.dns, ${VrpDhcp.MAX_DNS} servers at most`);
            if (server.dns?.some((resolver) => Address.family(resolver) === "ipv6"))
                found.push(`${where}.dns, IPv6, which DHCP gives no client`);

            (server.reservations ?? []).forEach((reservation, index) => {
                if (reservation.description)
                    found.push(`${where}.reservations[${index}].description, which a static binding on the switch has no place for`);
            });

            const lease = server.lease_time;
            if (lease !== undefined && (lease % VrpDhcp.SECONDS_PER.minute !== 0 || lease <= 0 || lease > VrpDhcp.MAX_LEASE_S))
                found.push(`${where}.lease_time, whole minutes up to 999 days on the platform`);
        }

        return found;
    }

    /** `lease day 0 hour 12 minute 0`, or nothing for the switch's own day. */
    private static lease(seconds: number | undefined): string[] {
        if (seconds === undefined || seconds === VrpDhcp.DEFAULT_LEASE_S) return [];

        const { day, hour, minute } = VrpDhcp.SECONDS_PER;
        const days = Math.floor(seconds / day);
        const hours = Math.floor((seconds % day) / hour);
        const minutes = Math.floor((seconds % hour) / minute);
        return [`lease day ${days} hour ${hours} minute ${minutes}`];
    }

    /** `02:00:5e:00:53:01` as the switch writes it: `0200-5e00-5301`. */
    private static mac(mac: string): string {
        const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, "");
        return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12)].join("-");
    }

    /**
     * The addresses of the network the pool does not give, as ranges: those outside `pool`. The switch keeps the gateway and every reservation out of an excluded range, refusing one that holds them, and never gives either away.
     */
    private static excluded(server: DhcpServer): [string, string][] {
        const { first: network, last: broadcast } = Address.range(Address.prefixOf(server.network));
        const [low, high] = server.pool.map((address) => Address.toNumber(address)!) as [bigint, bigint];
        const kept = [server.gateway, ...(server.reservations ?? []).map((reservation) => reservation.address)]
            .map((address) => Address.toNumber(address)!)
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        let ranges: [bigint, bigint][] = [
            [network + 1n, low - 1n],
            [high + 1n, broadcast - 1n],
        ];

        for (const address of kept) {
            ranges = ranges.flatMap(([first, last]): [bigint, bigint][] =>
                address < first || address > last
                    ? [[first, last]]
                    : [
                          [first, address - 1n],
                          [address + 1n, last],
                      ]
            );
        }

        return ranges
            .filter(([first, last]) => first <= last)
            .map(([first, last]) => [Address.fromNumber(first, "ipv4"), Address.fromNumber(last, "ipv4")]);
    }

    /** The VLAN interface or routed port the server serves on. */
    private static vlanInterface(device: Device, server: DhcpServer): VlanInterface | Port | undefined {
        return device.interfaces?.vlan_interface?.[server.interface] ?? VrpRoutedPorts.port(device, server.interface);
    }

    private static holdsNetwork(iface: VlanInterface | Port, network: string): boolean {
        return (iface.addresses ?? []).some((entry) => {
            const address = typeof entry === "string" ? entry : entry.address;
            return Address.family(address) === "ipv4" && Address.prefixOf(address) === Address.prefixOf(network);
        });
    }
}
