import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, Finding, IP, PrefixDelegation } from "../model";

type Report = (message: string) => void;
type Checker = (where: string, value: string) => void;

/** What a device serves to hosts: DHCP, DHCPv6, and PPPoE servers. */
export class ServicesChecks {
    /** The largest packet a PPPoE session may carry (RFC 2516). */
    static readonly PPPOE_MTU = 1492;
    /** The smallest datagram every IPv4 host takes (RFC 791). */
    static readonly MIN_MTU = 576;
    /** The shortest time RFC 2869 allows between interim accounting reports, in seconds. */
    private static readonly MIN_INTERIM_SECONDS = 60;

    /** Servers a device logs in to, such as RADIUS servers: each a valid address, listed once, and sending from an address of its own family. */
    static servers(where: string, servers: readonly { address: IP; source_address?: IP }[], report: Report, ip: Checker): void {
        const seen = new Set<string>();
        servers.forEach((server, index) => {
            const at = `${where}[${index}]`;
            ip(`${at}.address`, server.address);
            if (server.source_address !== undefined) ip(`${at}.source_address`, server.source_address);
            if (!Address.isValid(server.address)) return;

            const address = Address.canonical(server.address);
            if (seen.has(address)) report(`${at}: ${server.address} is listed twice`);
            seen.add(address);

            const source = server.source_address;
            if (source && Address.isValid(source) && Address.family(source) !== Address.family(server.address))
                report(`${at}.source_address ${source} and address ${server.address} differ in family`);
        });
    }

    /** A DHCPv6 server whose interface's router advertisements don't send hosts to it: DHCPv6 gives no gateway, and hosts ask only for what the M and O flags say. */
    static warnings(device: Device): Finding[] {
        const holders = Derive.holders(device);
        const found: Finding[] = [];
        const warn = (message: string) => found.push({ level: "warning", device: device.name, message });

        for (const [name, server] of Object.entries(device.services?.dhcpv6_server ?? {})) {
            const holder = holders.find((each) => each.name === server.interface);
            if (!holder) continue;

            const where = `services.dhcpv6_server.${name}`;
            const ra = Derive.routerAdvertisement(holder.settings);
            const flag = server.pool ? "managed" : server.dns?.length && !server.prefix_delegation ? "other_config" : undefined;

            if (!ra)
                warn(
                    `${where}: ${holder.where} sends no router advertisements, so hosts find no gateway and don't ask the server. Write ipv6_ra: ${flag ? `{ ${flag}: true }` : "true"} on it`
                );
            else if (flag === "managed" && !ra.managed)
                warn(
                    `${where} gives addresses, but ${holder.where}.ipv6_ra has no managed: true, so hosts don't ask for one. Write it there`
                );
            else if (flag === "other_config" && !ra.managed && !ra.other_config)
                warn(
                    `${where} gives DNS servers, but ${holder.where}.ipv6_ra has no other_config: true, so hosts don't ask for them. Write it there`
                );
        }

        for (const [name, server] of Object.entries(device.services?.pppoe_server ?? {}))
            if (server.mtu === undefined)
                warn(
                    `services.pppoe_server.${name} has no mtu, so the platform picks one, which may be below the ${ServicesChecks.PPPOE_MTU} RFC 2516 allows. Write mtu: ${ServicesChecks.PPPOE_MTU}`
                );

        return found;
    }

    static check(device: Device, report: Report, cidr: Checker, ip: Checker): void {
        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
            const where = `services.dhcp_server.${name}`;
            cidr(where, server.network);
            if (!Address.isCidr(server.network)) continue;
            if (Address.family(server.network) === "ipv6") {
                report(`${where}.network ${server.network} is IPv6, and DHCPv6 gives no gateway: write it in services.dhcpv6_server`);
                continue;
            }

            const reserved = (server.reservations ?? []).map((reservation) => reservation.address);
            const addresses = [server.gateway, ...server.pool, ...reserved];

            for (const address of addresses) {
                if (!Address.contains(server.network, address)) report(`${where}: ${address} is outside ${server.network}`);
            }
        }

        ServicesChecks.dhcpv6(device, report);
        ServicesChecks.pppoe(device, report, ip);

        // `management.allow` may be an address set's addresses, and a set holds an address alone too.
        const allow = device.management?.allow;
        if (Array.isArray(allow)) for (const prefix of allow) if (!Address.isValid(prefix)) cidr("management.allow", prefix);

        const snmp = device.monitoring?.snmp;
        if (snmp && !snmp.community && !snmp.users) report("monitoring.snmp is on with neither a community nor a user");

        (snmp?.traps ?? []).forEach((target, index) => {
            const where = `monitoring.snmp.traps[${index}]`;
            ip(`${where}.address`, target.address);
            if (Boolean(target.community) === Boolean(target.user))
                report(`${where}: write community for version 2c, or user for version 3, not both or neither`);
        });

        const flow = device.monitoring?.flow_export;
        for (const key of ["active_timeout", "idle_timeout"] as const) {
            const seconds = flow?.[key];
            if (seconds === undefined) continue;

            const where = `monitoring.flow_export.${key}`;
            if (!Number.isInteger(seconds) || seconds < 1) report(`${where} ${seconds}: write a whole number of seconds, from 1`);
            if (flow?.protocol === "sflow")
                report(`${where}: sFlow sends packet samples, not flows. Remove it, or export netflow-v9 or ipfix`);
        }
    }

    /** One server per interface, giving something: addresses in a network of its interface, prefixes from a pool, or DNS servers. */
    private static dhcpv6(device: Device, report: Report): void {
        const isIpv6 = (address: string) => Address.isValid(address) && Address.family(address) === "ipv6";
        const serverOf = new Map<string, string>();

        for (const [name, server] of Object.entries(device.services?.dhcpv6_server ?? {})) {
            const where = `services.dhcpv6_server.${name}`;
            const other = serverOf.get(server.interface);
            if (other) report(`${where} and services.dhcpv6_server.${other} both answer on ${server.interface}: write one server for it`);
            serverOf.set(server.interface, name);

            if (!server.pool && !server.prefix_delegation && !server.dns?.length)
                report(`${where} gives nothing: write pool, prefix_delegation, or dns`);

            for (const address of [...(server.pool ?? []), ...(server.dns ?? [])]) {
                if (!isIpv6(address)) report(`${where}: '${address}' is not an IPv6 address, such as 2001:db8:100:20::1000`);
            }

            if (server.pool?.every(isIpv6)) {
                const [first, last] = server.pool;
                const networks = Derive.ipv6Networks(Derive.settings(device, server.interface) ?? {});
                if (Address.toNumber(first)! > Address.toNumber(last)!)
                    report(`${where}.pool starts at ${first}, after its last address ${last}`);
                else if (!networks.length)
                    report(`${where}.pool: ${server.interface} has no IPv6 address. Give it one in a network that holds the pool`);
                else if (!Derive.dhcpv6Network(device, server))
                    report(
                        `${where}.pool ${first} to ${last} is in no IPv6 network of ${server.interface}: write addresses from one of ${networks.join(", ")}`
                    );
            }

            if (server.prefix_delegation) ServicesChecks.delegation(`${where}.prefix_delegation`, server.prefix_delegation, report);

            if (server.lease_time !== undefined && (!Number.isInteger(server.lease_time) || server.lease_time <= 0))
                report(`${where}.lease_time ${server.lease_time} is not a whole number of seconds above 0`);
        }
    }

    /** Prefixes to delegate: an IPv6 prefix, written without bits past its length, and each prefix delegated a part of it. */
    private static delegation(at: string, delegation: PrefixDelegation, report: Report): void {
        if (!Address.isCidr(delegation.pool) || Address.family(delegation.pool) !== "ipv6") {
            report(`${at}.pool '${delegation.pool}' is not an IPv6 prefix, such as 2001:db8:100:8000::/49`);
            return;
        }

        const { len } = Address.split(delegation.pool);
        const most = Address.bits("ipv6");
        if (Address.prefixOf(delegation.pool) !== Address.canonical(delegation.pool))
            report(`${at}.pool ${delegation.pool} has bits past its length: write ${Address.prefixOf(delegation.pool)}`);
        if (!Number.isInteger(delegation.prefix_length) || delegation.prefix_length <= len || delegation.prefix_length > most)
            report(
                `${at}.prefix_length ${delegation.prefix_length} is not a whole number from ${len + 1} to ${most}: each prefix delegated is a part of pool, a /${len}`
            );
    }

    /** Each PPPoE server answers on some interface, as the only one there with its service name, and gives IPv4 addresses from a pool that holds no address of its own. */
    private static pppoe(device: Device, report: Report, ip: Checker): void {
        const isIpv4 = (address: string) => Address.isValid(address) && Address.family(address) === "ipv4";
        const answering = new Map<string, string>();

        for (const [name, server] of Object.entries(device.services?.pppoe_server ?? {})) {
            const where = `services.pppoe_server.${name}`;
            if (!server.interfaces.length) report(`${where}.interfaces is empty: write the ports or interfaces subscribers connect on`);

            const service = server.service_name ?? "";
            for (const iface of server.interfaces) {
                const other = answering.get(`${iface} ${service}`);
                if (other) report(`${where} and services.pppoe_server.${other} both answer on ${iface}: give each its own service_name`);
                answering.set(`${iface} ${service}`, name);
            }

            for (const [at, address] of [
                ["local_address", server.local_address],
                ...server.pool.map((address) => ["pool", address] as const),
                ...(server.dns ?? []).map((address) => ["dns", address] as const),
            ] as const)
                if (!isIpv4(address)) report(`${where}.${at}: '${address}' is not an IPv4 address, such as 192.0.2.1`);

            const [first, last] = server.pool.map((address) => (isIpv4(address) ? Address.toNumber(address)! : null));
            const local = isIpv4(server.local_address) ? Address.toNumber(server.local_address)! : null;
            if (first !== null && first !== undefined && last !== null && last !== undefined) {
                if (first > last) report(`${where}.pool starts at ${server.pool[0]}, after its last address ${server.pool[1]}`);
                else if (local !== null && local >= first && local <= last)
                    report(`${where}.local_address ${server.local_address} is in pool: write a pool without it`);
            }

            const { mtu, acct_interim_interval: interval } = server;
            if (mtu !== undefined && (!Number.isInteger(mtu) || mtu < ServicesChecks.MIN_MTU || mtu > ServicesChecks.PPPOE_MTU))
                report(
                    `${where}.mtu ${mtu} is not a whole number from ${ServicesChecks.MIN_MTU} to ${ServicesChecks.PPPOE_MTU}, the most RFC 2516 allows`
                );
            if (interval !== undefined && (!Number.isInteger(interval) || interval < ServicesChecks.MIN_INTERIM_SECONDS))
                report(
                    `${where}.acct_interim_interval ${interval} is not a whole number of seconds from ${ServicesChecks.MIN_INTERIM_SECONDS}, the least RFC 2869 allows`
                );

            if (!server.radius.length) report(`${where}.radius is empty: write the RADIUS servers that check subscribers`);
            ServicesChecks.servers(`${where}.radius`, server.radius, report, ip);
            if (server.prefix_delegation) ServicesChecks.delegation(`${where}.prefix_delegation`, server.prefix_delegation, report);
        }
    }
}
