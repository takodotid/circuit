// IPsec remote access is a pool, a profile, a proposal, a mode config, a policy group, a passive peer, and its identity, all of the entry's name. The group holds a policy template for each traffic selector, from which IKE makes each client's policy.

import { Address } from "../../core/address";
import type { Device, IpsecRemoteAccess } from "../../model";
import { RouterOsIpsec } from "./ipsec";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

export class RouterOsRemoteAccess {
    /** The RADIUS servers' service for IPsec's EAP. */
    private static readonly SERVICE = "ipsec";

    /** The mode config every RouterOS has, which a remote access can't be named. */
    private static readonly REQUEST_ONLY = "request-only";

    /** The length a client's address takes, as one host alone (RFC 7296 §3.15.1). */
    private static readonly HOST_LENGTH = 32;

    static entries(device: Device): [string, IpsecRemoteAccess][] {
        return RouterOsSyntax.entries(device.services?.ipsec_remote_access);
    }

    /**
     * Each remote access as the export prints it. The peer waits for clients on `local_address`, and its identity gives each one the mode config. RouterOS narrows what a client asks to `split-include` alone. It takes any address a template holds as a client's own, so the templates hold the pool exactly (TRAPS.md).
     */
    static render(render: RouterOsRender, device: Device): void {
        for (const [name, access] of RouterOsRemoteAccess.entries(device)) {
            const [first, last] = access.pool;
            const selectors = access.traffic_selectors.map((selector) => selector.local_prefix);
            render.add("/ip pool", "add", { name, ranges: `${first}-${last}` });
            render.add("/ip ipsec profile", "add", RouterOsIpsec.profile(name, access.ike));
            render.add("/ip ipsec proposal", "add", RouterOsIpsec.proposal(name, access.esp));
            // Without `system-dns=no`, the clients get the router's own DNS servers.
            render.add("/ip ipsec mode-config", "add", {
                "address-pool": name,
                "address-prefix-length": RouterOsRemoteAccess.HOST_LENGTH,
                name,
                "split-include": selectors.join(","),
                "static-dns": access.dns?.join(","),
                "system-dns": "no",
            });
            render.add("/ip ipsec policy group", "add", { name });

            const pool = Address.prefixesBetween(Address.toNumber(first)!, Address.toNumber(last)!, "ipv4");
            for (const local of selectors)
                for (const clients of pool)
                    render.add("/ip ipsec policy", "add", {
                        "dst-address": clients,
                        group: name,
                        proposal: name,
                        "src-address": local,
                        template: "yes",
                    });

            render.add("/ip ipsec peer", "add", {
                comment: access.description,
                "exchange-mode": "ike2",
                "local-address": Address.canonical(access.local_address),
                name,
                passive: "yes",
                profile: name,
            });
            render.add("/ip ipsec identity", "add", {
                "auth-method": access.radius ? "eap-radius" : "digital-signature",
                certificate: access.certificate,
                "generate-policy": "port-strict",
                "mode-config": name,
                peer: name,
                "policy-template-group": name,
            });
            if (access.radius) render.radius(access.radius, RouterOsRemoteAccess.SERVICE);
        }
    }

    /** What RouterOS 7.24 can't express, and names its other entries take. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const entries = RouterOsRemoteAccess.entries(device);

        for (const [name] of entries.slice(1))
            found.push(`services.ipsec_remote_access.${name}: Circuit runs one remote access on a RouterOS router, as tested. Write one`);
        // A flow on the fast path skips IPsec's policies, so what goes to a client would leave in the clear (MikroTik's manual, Packet Flow).
        const fastPath = Object.values(device.firewall?.filter ?? {}).some((chain) => chain?.rules?.some((rule) => rule.fast_path));
        if (fastPath && entries.length)
            found.push("services.ipsec_remote_access beside a fast_path rule, whose flows skip IPsec's policies: take fast_path off");

        for (const [name, access] of entries) {
            const where = `services.ipsec_remote_access.${name}`;
            if (name === RouterOsIpsec.BUILT_IN || name === RouterOsRemoteAccess.REQUEST_ONLY)
                found.push(`${where}: the name of an IPsec entry RouterOS has itself, which the remote access's take. Write another name`);
            if (device.firewall?.ipsec?.[name])
                found.push(
                    `${where}, named as firewall.ipsec.${name}: RouterOS names the IPsec entries of each after it. Give each its own name`
                );
            for (const group of ["dhcp_server", "pppoe_server"] as const)
                if (device.services?.[group]?.[name])
                    found.push(
                        `${where}, named as services.${group}.${name}: RouterOS names the address pool of each after it. Give each its own name`
                    );

            found.push(...RouterOsIpsec.ikeGaps(where, access.ike), ...RouterOsIpsec.localGaps(where, access.local_address, device));
            if (!access.radius) found.push(...RouterOsIpsec.caGaps(where, access.ca_certificate, device));
        }

        return found;
    }
}
