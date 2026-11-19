import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, Finding } from "../model";

type Report = (message: string) => void;
type Checker = (where: string, value: string) => void;

/** What a device serves to hosts: DHCP and DHCPv6 servers. */
export class ServicesChecks {
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

            const delegation = server.prefix_delegation;
            if (delegation) {
                const at = `${where}.prefix_delegation`;
                if (!Address.isCidr(delegation.pool) || Address.family(delegation.pool) !== "ipv6") {
                    report(`${at}.pool '${delegation.pool}' is not an IPv6 prefix, such as 2001:db8:100:8000::/49`);
                } else {
                    const { len } = Address.split(delegation.pool);
                    const most = Address.bits("ipv6");
                    if (Address.prefixOf(delegation.pool) !== Address.canonical(delegation.pool))
                        report(`${at}.pool ${delegation.pool} has bits past its length: write ${Address.prefixOf(delegation.pool)}`);
                    if (!Number.isInteger(delegation.prefix_length) || delegation.prefix_length <= len || delegation.prefix_length > most)
                        report(
                            `${at}.prefix_length ${delegation.prefix_length} is not a whole number from ${len + 1} to ${most}: each prefix delegated is a part of pool, a /${len}`
                        );
                }
            }

            if (server.lease_time !== undefined && (!Number.isInteger(server.lease_time) || server.lease_time <= 0))
                report(`${where}.lease_time ${server.lease_time} is not a whole number of seconds above 0`);
        }
    }
}
