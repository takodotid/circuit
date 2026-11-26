// What a VRP switch can't serve, or be reached with: PPPoE, IPsec, DHCP relays, a DNS server, logins, APIs, and its logins in a VRF.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device } from "../../model";

export class VrpServices {
    /** A CE6855 on V200R005 refused `pki realm`, and its SSL policy loads a certificate only from a file: "The file to be loaded does not exist in flash:/security/". */
    private static readonly NO_CERTIFICATES =
        "V200R005 has no PKI, and loads a certificate only from a file on the switch's flash, which Circuit does not copy there";

    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const services = device.services ?? {};

        if (device.system?.certificates) found.push(`system.certificates, ${VrpServices.NO_CERTIFICATES}`);
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

        for (const field of ["ftp", "native_protocol", "privilege_password"] as const) {
            if (management[field]) found.push(`management.${field}`);
        }
        // `http server enable` is `Too many parameters` on V200R005: `http` is the view of RESTCONF, whose view takes no `acl`.
        for (const field of ["http", "https"] as const)
            if (management[field]) found.push(`management.${field}, a CloudEngine has no web interface`);
        if (management.api)
            found.push("management.api, RESTCONF over HTTP, which no ACL guards on V200R005, so management.allow can't: not built");
        if (management.api_tls) found.push(`management.api_tls, ${VrpServices.NO_CERTIFICATES}`);

        if (management.ssh?.auth_timeout || management.ssh?.auth_retries) found.push("management.ssh.auth_timeout and auth_retries");
        return found;
    }

    /** The switch's own services in a VRF, but a login service. */
    private static inVrfs(device: Device): string[] {
        const found: string[] = [];

        // The switch binds a login service to one interface, `ssh server-source -i`, and to its VRF through it. Changing it cuts the logins of a switch under test.
        for (const { where } of Derive.serviceVrfs(device))
            if (where.startsWith("management.")) found.push(`${where}, the switch binds a login service to one interface, not to a VRF`);

        return found;
    }
}
