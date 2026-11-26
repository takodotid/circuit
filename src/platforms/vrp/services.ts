// What a VRP switch can't serve, or be reached with: PPPoE, IPsec, DHCP relays, a DNS server, logins, APIs, and its own services in a VRF.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device } from "../../model";

export class VrpServices {
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const services = device.services ?? {};

        if (services.pppoe_server)
            found.push("services.pppoe_server, VRP serves PPPoE subscribers on NE routers (BRAS) only, which Circuit does not support");
        if (services.ipsec_remote_access)
            found.push("services.ipsec_remote_access, IPsec: a CloudEngine switch does not encrypt the traffic it forwards");

        for (const [name, relay] of Object.entries(services.dhcp_relay ?? {})) {
            if (!device.interfaces?.vlan_interface?.[relay.interface])
                found.push(`services.dhcp_relay.${name}.interface, relays run on VLAN interfaces`);
            if (relay.servers.some((server) => Address.family(server) === "ipv6")) found.push(`services.dhcp_relay.${name}.servers, IPv6`);
            // A CE6855 on V200R005 refused `dhcp option82 insert enable` and `dhcp relay information enable` on a relay's VLAN interface.
            if (relay.relay_agent_information)
                found.push(`services.dhcp_relay.${name}.relay_agent_information, V200R005 adds no Option 82 where it relays`);
        }

        // A CE6855 on V200R005 refused `dns proxy enable` and `dns relay enable`.
        if (services.dns_server) found.push("services.dns_server, a CloudEngine answers no DNS queries for others");
        if (services.dns64) found.push("services.dns64, which needs services.dns_server");

        return [...found, ...VrpServices.management(device), ...VrpServices.inVrfs(device)];
    }

    /** The ways in the switch has no setting for. */
    private static management(device: Device): string[] {
        const management = device.management ?? {};
        const found: string[] = [];

        for (const field of ["http", "https", "api", "api_tls", "ftp", "native_protocol", "privilege_password"] as const) {
            if (management[field]) found.push(`management.${field}`);
        }

        if (management.ssh?.auth_timeout || management.ssh?.auth_retries) found.push("management.ssh.auth_timeout and auth_retries");
        return found;
    }

    /** The switch's own services in a VRF, which are not built yet. */
    private static inVrfs(device: Device): string[] {
        return Derive.serviceVrfs(device).map(({ where }) => `${where}, not built yet`);
    }
}
