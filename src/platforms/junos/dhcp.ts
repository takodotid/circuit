import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device } from "../../model";

/** What Junos takes of DHCP and DHCPv6 servers and relays, and what is only from its documentation. */
export class JunosDhcp {
    /** A server on an interface in a VRF, and one for a relay's clients, only passed `commit check`. Option 82 on a relay is from Juniper's reference, not tried on a QFX5100. */
    static experimental(device: Device): string[] {
        const found: string[] = [];
        for (const group of ["dhcp_server", "dhcpv6_server"] as const)
            for (const [name, server] of Object.entries(device.services?.[group] ?? {}))
                if (Derive.settings(device, server.interface)?.vrf) found.push(`services.${group}.${name}.interface`);
        for (const [name, relay] of Object.entries(device.services?.dhcp_relay ?? {}))
            if (relay.relay_agent_information) found.push(`services.dhcp_relay.${name}.relay_agent_information`);
        // A server for a relay's clients passed `commit check` only, and no relayed request reached it.
        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {}))
            if (server.relay !== undefined) found.push(`services.dhcp_server.${name}.relay`);
        return found;
    }

    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const services = device.services ?? {};
        const relayed = new Set(Object.values(services.dhcp_relay ?? {}).map((relay) => relay.interface));

        for (const [name, server] of Object.entries(services.dhcp_server ?? {})) {
            // The device refuses a relay and a server on one interface: `Interface irb.10 already configured`.
            if (relayed.has(server.interface)) found.push(`services.dhcp_server.${name}.interface, which a DHCP relay also uses`);

            if (Derive.settings(device, server.interface)?.vrf) found.push(`services.dhcp_server.${name}.interface, which routes in a VRF`);
            if (server.relay !== undefined && !Address.contains(server.network, server.relay))
                found.push(
                    `services.dhcp_server.${name}.relay ${server.relay}, outside network ${server.network}: Junos picks the pool whose network holds the relay's address, so write the network the relay is in`
                );
        }

        for (const [name, server] of Object.entries(services.dhcpv6_server ?? {})) {
            const where = `services.dhcpv6_server.${name}`;
            if (Derive.settings(device, server.interface)?.vrf) found.push(`${where}.interface, which routes in a VRF`);
            if (!server.pool && !server.prefix_delegation && server.dns?.length)
                found.push(
                    `${where} without pool or prefix_delegation: Junos takes the DNS servers it gives from a pool's settings. Write pool or prefix_delegation, or announce the DNS servers in ipv6_ra.dns_servers`
                );
        }

        for (const [name, relay] of Object.entries(services.dhcp_relay ?? {})) {
            if (relay.servers.some((server) => Address.family(server) === "ipv6")) found.push(`services.dhcp_relay.${name}.servers, IPv6`);
        }
        for (const where of Derive.radiusLeases(device)) found.push(`${where}, a lease checked by RADIUS, not built for Junos`);
        return found;
    }
}
