import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device } from "../model";
import { ServicesChecks } from "./services";

type Report = (message: string) => void;

/** PPPoE clients (RFC 2516), each over a routed port, LAG, or VLAN interface, and the interfaces that take a /64 of a delegated prefix. */
export class PppoeClientChecks {
    /** The bits of an IPv6 address that are its interface ID, after a /64 (RFC 4291). */
    private static readonly INTERFACE_ID_BITS = 64n;

    static check(device: Device, report: Report): void {
        const delegatedTo = new Map<string, string>();

        for (const [name, client] of Object.entries(device.interfaces?.pppoe_client ?? {})) {
            if (!client) continue;
            const where = `interfaces.pppoe_client.${name}`;

            if (!client.user.trim()) report(`${where}.user is empty: write the name the provider gave you`);
            PppoeClientChecks.carrier(device, where, client.interface, report);
            PppoeClientChecks.routes(device, name, client.vrf, report);

            const { mtu } = client;
            if (mtu !== undefined && (!Number.isInteger(mtu) || mtu < ServicesChecks.MIN_MTU || mtu > ServicesChecks.PPPOE_MTU))
                report(
                    `${where}.mtu ${mtu} is not a whole number from ${ServicesChecks.MIN_MTU} to ${ServicesChecks.PPPOE_MTU}, the most RFC 2516 allows`
                );

            const delegation = client.prefix_delegation;
            if (!delegation) continue;
            const at = `${where}.prefix_delegation.interfaces`;
            const lans = Object.entries(delegation.interfaces);
            if (!lans.length) report(`${at} is empty: write the interfaces that each take a /64 of the prefix, such as { home: "::1" }`);
            PppoeClientChecks.hint(`${where}.prefix_delegation.prefix_length`, delegation.prefix_length, lans.length, report);

            for (const [lan, address] of lans) {
                if (lan === name || lan === client.interface)
                    report(`${at}.${lan} is the session's own way to the provider: give the prefix to an interface toward your hosts`);
                else if (device.interfaces?.ethernet?.[lan]?.in_lag)
                    report(`${at}.${lan} is in LAG ${device.interfaces.ethernet[lan]?.in_lag}: give the prefix to the LAG`);
                else if (PppoeClientChecks.isSwitched(device, lan))
                    report(`${at}.${lan} is switched, so it holds no address: give the prefix to the VLAN interface of its VLAN`);
                else if (Derive.settings(device, lan)?.vrf !== client.vrf)
                    report(
                        `${at}.${lan} routes in ${Derive.settings(device, lan)?.vrf ?? "the main table"}, but the session in ${client.vrf ?? "the main table"}, where the prefix's route is: put both in one VRF`
                    );
                const other = delegatedTo.get(lan);
                if (other) report(`${at}.${lan} also takes a prefix from interfaces.pppoe_client.${other}: give it one of them`);
                delegatedTo.set(lan, name);

                if (address === undefined || !PppoeClientChecks.isInterfaceId(address))
                    report(
                        `${at}.${lan}: '${address}' is not the last 64 bits of an address, such as ::1. The first 64 bits come from the prefix`
                    );
            }
        }
    }

    /** A length the prefix may have: a /64 at most, and short enough to hold a /64 for each interface that takes one. */
    private static hint(where: string, length: number | undefined, interfaces: number, report: Report): void {
        if (length === undefined) return;
        const most = Number(PppoeClientChecks.INTERFACE_ID_BITS) - Math.ceil(Math.log2(Math.max(interfaces, 1)));
        if (!Number.isInteger(length) || length < 1 || length > most)
            report(
                `${where} ${length} is not a whole number from 1 to ${most}, the longest prefix that holds a /64 for each interface listed`
            );
    }

    /** A routed port, LAG, or VLAN interface: on a switched one, the switch would take the session's frames. A port in a LAG carries it as the LAG. */
    private static carrier(device: Device, where: string, carrier: string, report: Report): void {
        const port = device.interfaces?.ethernet?.[carrier];
        if (port?.in_lag) report(`${where}.interface ${carrier} is in LAG ${port.in_lag}: write the LAG instead`);
        else if (PppoeClientChecks.isSwitched(device, carrier))
            report(
                `${where}.interface ${carrier} is switched: run the client on a routed port, or on a VLAN interface of the VLAN that reaches the provider`
            );
    }

    /** A route through the session is in the session's VRF, or the main table with the session: the session's address and its way out are there. */
    private static routes(device: Device, name: string, vrf: string | undefined, report: Report): void {
        for (const route of device.routing?.static_routes ?? []) {
            if (route.interface !== name || route.vrf === vrf) continue;
            const where = `routing.static_routes ${route.prefix}`;
            report(
                vrf
                    ? `${where} leaves through interfaces.pppoe_client.${name}, which routes in VRF ${vrf}: write vrf: "${vrf}" on the route`
                    : `${where} is in VRF ${route.vrf}, but interfaces.pppoe_client.${name} routes in the main table: write vrf: "${route.vrf}" on the client, or take vrf off the route`
            );
        }
    }

    /** A port or LAG in a VLAN: the switch takes what arrives on it. */
    private static isSwitched(device: Device, name: string): boolean {
        const holder = device.interfaces?.ethernet?.[name] ?? device.interfaces?.lag?.[name];
        return Boolean(holder?.access_vlan || holder?.trunk_vlans || holder?.qinq_vlan);
    }

    /** An IPv6 address whose first 64 bits are zero, and which is not `::` itself, the subnet's own anycast address (RFC 4291). */
    private static isInterfaceId(address: string): boolean {
        if (!Address.isValid(address) || Address.family(address) !== "ipv6" || address.includes("/")) return false;
        const value = Address.toNumber(address);
        return value !== null && value > 0n && value >> PppoeClientChecks.INTERFACE_ID_BITS === 0n;
    }
}
