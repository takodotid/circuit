// DHCP servers and relays on VLAN interfaces, and SNMP trap receivers, as a RAX721 on ROS 6.5.2 took them; see TRAPS.md.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, DhcpServer } from "../../model";
import type { Entry, Group } from "../line-diff";

export class RaisecomRosServices {
    /** The longest pool name the switch takes. */
    private static readonly POOL_NAME = 16;

    /** A lease in whole minutes: 30, the switch's default, which prints nothing, to 10080. */
    private static readonly LEASE_MINUTES = { min: 30, max: 10_080, default: 30 };
    private static readonly SECONDS_PER_MINUTE = 60;

    /** A pool gives a DNS server and a secondary one. */
    private static readonly MAX_DNS = 2;

    /** The port a trap goes to unless told otherwise. It prints nothing. */
    private static readonly TRAP_PORT = 162;

    /** A DHCP server's pool, by its name. */
    static readonly POOL = /^ip dhcp server pool (\S+)$/;

    /** Turn the relay, and its Option 82, on for the whole switch. */
    static readonly RELAY = ["ip dhcp relay", "ip dhcp relay information option"];

    /** Each server's pool, as the switch prints it. A pool takes its addresses, the clients' gateway, and up to two DNS servers. */
    static pools(device: Device): string[] {
        const lines: string[] = [];

        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
            const [first, last] = server.pool;
            const [dns, secondary] = server.dns ?? [];
            lines.push(
                `ip dhcp server pool ${name}`,
                `  address ${first} ${last} mask ${Address.netmask(Address.split(server.network).len)}`,
                `  gateway ${server.gateway}`,
                ...(dns ? [`  dns-server ${dns}`] : []),
                ...(secondary ? [`  dns-server ${secondary} secondary`] : []),
                ...RaisecomRosServices.lease(server),
                "!"
            );
        }

        return lines;
    }

    /** Each reservation, a static binding to its server's pool, which exists before it. */
    static reservations(device: Device): string[] {
        return Object.entries(device.services?.dhcp_server ?? {}).flatMap(([name, server]) =>
            (server.reservations ?? []).map(
                (reservation) => `ip dhcp static-bind ${reservation.address} ${RaisecomRosServices.mac(reservation.mac)} ${name}`
            )
        );
    }

    /** A VLAN interface's DHCP lines: it serves from the pool that holds its network, or relays to its servers. */
    static interfaceLines(device: Device, name: string): string[] {
        const serves = Object.values(device.services?.dhcp_server ?? {}).some((server) => server.interface === name);
        const relays = Object.values(device.services?.dhcp_relay ?? {}).filter((relay) => relay.interface === name);

        return [
            ...(serves ? ["ip dhcp server"] : []),
            ...(relays.length ? ["ip dhcp relay"] : []),
            ...relays.flatMap((relay) => relay.servers.map((server) => `ip dhcp relay target-ip ${server}`)),
        ];
    }

    /** The switch's relay, and Option 82 when a relay adds it, sent once the interfaces relay. */
    static relayGlobal(device: Device): string[] {
        const relays = Object.values(device.services?.dhcp_relay ?? {});
        if (!relays.length) return [];
        return relays.some((relay) => relay.relay_agent_information) ? RaisecomRosServices.RELAY : [RaisecomRosServices.RELAY[0]!];
    }

    /** Each trap receiver: a user of version 3, which signs and encrypts each trap, or a community of version 2c. */
    static trapHosts(device: Device): string[] {
        return (device.monitoring?.snmp?.traps ?? []).map((target) => {
            const who = target.user
                ? `version 3 authpriv ${target.user}`
                : `version 2c ${target.community ? Secrets.marker(target.community) : ""}`;
            const port = target.port !== undefined && target.port !== RaisecomRosServices.TRAP_PORT ? ` udpport ${target.port}` : "";
            // The switch prints an IPv6 receiver in capitals.
            const address = Address.family(target.address) === "ipv6" ? Address.canonical(target.address).toUpperCase() : target.address;
            return `snmp-server host ${address} ${who}${port}`;
        });
    }

    /** The reservations bound to a pool, among a config's entries. */
    static binds(entries: readonly Entry[], pool: string): string[] {
        return entries
            .filter((entry) => !entry.path.length && entry.line.startsWith("ip dhcp static-bind ") && entry.line.endsWith(` ${pool}`))
            .map((entry) => entry.line);
    }

    /**
     * Takes the reservations out of the top level, to be sent once the pools they name exist. A pool with a reservation refuses any change, `Please delete the static bind of the pool`, so a changed pool's reservations go in its own step, and every one it keeps comes back after.
     */
    static reservationSteps(groups: Group[], existing: readonly Entry[], wanted: readonly Entry[]): string[] {
        const reservations: string[] = [];
        const top = groups.find((group) => !group.path.length);

        if (top) {
            reservations.push(...top.add.filter((line) => line.startsWith("ip dhcp static-bind ")));
            top.add = top.add.filter((line) => !line.startsWith("ip dhcp static-bind "));
        }

        for (const pool of groups.flatMap((group) => RaisecomRosServices.POOL.exec(group.path[0] ?? "")?.[1] ?? [])) {
            const released = RaisecomRosServices.binds(existing, pool);
            if (top) top.remove = top.remove.filter((line) => !released.includes(line));
            for (const line of RaisecomRosServices.binds(wanted, pool)) if (!reservations.includes(line)) reservations.push(line);
        }

        return reservations;
    }

    /** No client asked the server for an address, and the relay's switch-wide line was only parsed, as it may take DHCP from every VLAN. */
    static experimental(device: Device): string[] {
        const found: string[] = [];
        for (const name of Object.keys(device.services?.dhcp_server ?? {})) found.push(`services.dhcp_server.${name}`);
        for (const name of Object.keys(device.services?.dhcp_relay ?? {})) found.push(`services.dhcp_relay.${name}`);
        return found;
    }

    /** What the switch's DHCP and traps can't hold, or what was tried on a VLAN interface alone. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const vlanInterface = (name: string) => device.interfaces?.vlan_interface?.[name];

        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
            const where = `services.dhcp_server.${name}`;
            found.push(...RaisecomRosServices.server(where, name, server));
            if (!vlanInterface(server.interface)) found.push(`${where}.interface ${server.interface}, tested on a VLAN interface alone`);
            else if (vlanInterface(server.interface)?.vrf) found.push(`${where}.interface ${server.interface}, in a VRF: not tried`);
        }

        for (const [name, relay] of Object.entries(device.services?.dhcp_relay ?? {})) {
            const where = `services.dhcp_relay.${name}`;
            if (!vlanInterface(relay.interface)) found.push(`${where}.interface ${relay.interface}, tested on a VLAN interface alone`);
            else if (vlanInterface(relay.interface)?.vrf) found.push(`${where}.interface ${relay.interface}, in a VRF: not tried`);
            for (const server of relay.servers)
                if (Address.family(server) === "ipv6") found.push(`${where}.servers ${server}, the switch relays to IPv4 servers here`);
        }

        // An interface here holds IPv4 addresses alone.
        for (const name of Object.keys(device.services?.dhcpv6_server ?? {}))
            found.push(`services.dhcpv6_server.${name}, an interface here holds IPv4 addresses alone`);

        for (const [index, target] of (device.monitoring?.snmp?.traps ?? []).entries())
            if (!target.user && !target.community) found.push(`monitoring.snmp.traps[${index}], write community or user`);

        return found;
    }

    private static server(where: string, name: string, server: DhcpServer): string[] {
        const found: string[] = [];
        if (name.length > RaisecomRosServices.POOL_NAME || /\s/.test(name))
            found.push(`${where}, a pool name takes ${RaisecomRosServices.POOL_NAME} characters at most, without spaces`);
        if ((server.dns?.length ?? 0) > RaisecomRosServices.MAX_DNS)
            found.push(`${where}.dns, a pool gives ${RaisecomRosServices.MAX_DNS} DNS servers at most`);
        if (server.relay) found.push(`${where}.relay, a server for a relay's clients is not tried here`);
        if (server.radius || server.acct_interim_interval !== undefined) found.push(`${where}.radius, the switch asks no RADIUS server`);

        const seconds = server.lease_time;
        const { min, max } = RaisecomRosServices.LEASE_MINUTES;
        if (seconds !== undefined) {
            const minutes = seconds / RaisecomRosServices.SECONDS_PER_MINUTE;
            if (!Number.isInteger(minutes) || minutes < min || minutes > max)
                found.push(
                    `${where}.lease_time ${seconds}, the switch takes whole minutes from ${min} to ${max}: ${min * RaisecomRosServices.SECONDS_PER_MINUTE} to ${max * RaisecomRosServices.SECONDS_PER_MINUTE} seconds`
                );
        }

        return found;
    }

    /** A lease in minutes. The switch's default prints nothing. */
    private static lease(server: DhcpServer): string[] {
        if (server.lease_time === undefined) return [];
        const minutes = server.lease_time / RaisecomRosServices.SECONDS_PER_MINUTE;
        return minutes === RaisecomRosServices.LEASE_MINUTES.default ? [] : [`  lease expired ${minutes}`];
    }

    /** `02:00:5e:00:53:01` as the switch writes it: `0200.5e00.5301`. */
    private static mac(mac: string): string {
        const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, "");
        return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12)].join(".");
    }
}
