// IPsec remote access is a dial-up phase 1, `type dynamic` with `mode-cfg`, and its phase 2, of the entry's name (decision 227). The phase 1 makes the tunnel's interface, and an instance of it for each client.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, IpsecRemoteAccess } from "../../model";
import { FortiOsIpsec } from "./ipsec";
import { FortiOsNames } from "./names";
import type { FortiOsNode } from "./tree";
import { FortiOsTree } from "./tree";

export class FortiOsRemoteAccess {
    /** A dial-up phase 1 checks that each client is alive when it sends nothing, every 60 seconds unless set, and `show` prints both, which Circuit writes (TRAPS.md). */
    private static readonly LIVENESS = { dpd: "on-idle", interval: 60 } as const;

    /** `ipv4-dns-server1` to `3`. */
    private static readonly DNS_SERVERS = 3;

    /** The RADIUS servers of one entry, in the order the device asks them. */
    private static readonly RADIUS_ORDER = ["", "secondary-", "tertiary-"];

    /** A user group may not have a RADIUS server's name (TRAPS.md). */
    private static readonly GROUP_SUFFIX = "-users";

    /** The name of a phase 1 that makes an interface holds 15 characters, as an interface's does. */
    private static readonly MAX_NAME = 15;

    static entries(device: Device): [string, IpsecRemoteAccess][] {
        return Object.entries(device.services?.ipsec_remote_access ?? {}).flatMap(([name, access]) => (access ? [[name, access]] : []));
    }

    /**
     * Each remote access as `show` prints it. Clients prove who they are with EAP or with a certificate. The device passes EAP to a RADIUS entry of the remote access's name, through a user group. It takes a certificate its CA signed, through the `user peer` of the CA. The phase 2 takes the traffic between the selector and the client's address, which narrows what a client asks for (RFC 7296 §2.9).
     */
    static render(root: FortiOsNode, device: Device): void {
        for (const [name, access] of FortiOsRemoteAccess.entries(device)) {
            const { ike, esp } = access;
            // `type dynamic` and `mode-cfg` come first: the settings after them exist only once they are set.
            const entry = root.block("vpn ipsec phase1-interface").entry(name).set("type", "dynamic");
            entry.set("interface", FortiOsIpsec.outgoing(device, access.local_address));
            entry.set("ike-version", 2).set("local-gw", Address.host(access.local_address));
            if (ike.lifetime !== FortiOsIpsec.DEFAULT_LIFETIME.ike) entry.set("keylife", ike.lifetime);
            entry.set("authmethod", "signature");
            entry.set("peertype", access.radius ? "any" : "peer");
            entry.set("net-device", "disable").set("mode-cfg", "enable");
            (access.dns ?? []).forEach((server, index) => entry.set(`ipv4-dns-server${index + 1}`, server));
            entry.set("proposal", FortiOsIpsec.ikeProposal(ike)).set("dpd", FortiOsRemoteAccess.LIVENESS.dpd).set("dhgrp", ike.dh_group);
            if (access.radius) {
                entry.set("eap", "enable").set("eap-identity", "send-request");
                entry.set("authusrgrp", FortiOsTree.quote(FortiOsRemoteAccess.radius(root, name, access.radius)));
            }
            entry.set("certificate", FortiOsTree.quote(access.certificate));
            if (access.ca_certificate) {
                entry.set("peer", FortiOsTree.quote(access.ca_certificate));
                root.block("user peer").entry(access.ca_certificate).set("ca", FortiOsTree.quote(access.ca_certificate));
            }
            entry.set("ipv4-start-ip", access.pool[0]).set("ipv4-end-ip", access.pool[1]);
            entry.set("dpd-retryinterval", FortiOsRemoteAccess.LIVENESS.interval);
            if (access.description) entry.set("comments", FortiOsTree.quote(access.description));

            // `unsupported()` refuses more than one selector.
            const [selector] = access.traffic_selectors;
            const child = FortiOsIpsec.child(root.block("vpn ipsec phase2-interface").entry(name), name, esp);
            if (selector) child.set("src-subnet", FortiOsNames.subnet(selector.local_prefix));
        }
    }

    /** The RADIUS servers as one entry, asked in order, with their accounting, and the user group of it the phase 1 lets in. */
    private static radius(root: FortiOsNode, name: string, servers: NonNullable<IpsecRemoteAccess["radius"]>): string {
        const entry = root.block("user radius").entry(name);
        FortiOsRemoteAccess.RADIUS_ORDER.forEach((prefix, index) => {
            const server = servers[index];
            if (!server) return;
            entry.set(`${prefix}server`, FortiOsTree.quote(server.address));
            entry.set(`${prefix}secret`, FortiOsTree.quote(Secrets.marker(server.secret_key)));
        });

        const [first] = servers;
        if (first?.auth_port !== undefined) entry.set("radius-port", first.auth_port);
        if (first?.source_address) entry.set("source-ip", FortiOsTree.quote(first.source_address));

        const accounting = entry.block("accounting-server");
        servers.forEach((server, index) => {
            const account = accounting
                .entry(index + 1)
                .set("status", "enable")
                .set("server", FortiOsTree.quote(server.address));
            account.set("secret", FortiOsTree.quote(Secrets.marker(server.secret_key)));
            // `gaps()` refuses another port (TRAPS.md).
            if (server.source_address) account.set("source-ip", FortiOsTree.quote(server.source_address));
        });

        const group = `${name}${FortiOsRemoteAccess.GROUP_SUFFIX}`;
        root.block("user group").entry(group).set("member", FortiOsTree.quote(name));
        return group;
    }

    /** What the platform can't express, or Circuit hasn't tried on it. */
    static gaps(device: Device): string[] {
        const found: string[] = [];
        const entries = FortiOsRemoteAccess.entries(device);

        for (const [name] of entries.slice(1))
            found.push(`services.ipsec_remote_access.${name}: Circuit runs one remote access on a FortiGate, as tested. Write one`);

        for (const [name, access] of entries) {
            const where = `services.ipsec_remote_access.${name}`;
            if (name.length > FortiOsRemoteAccess.MAX_NAME)
                found.push(`${where}, a name of ${FortiOsRemoteAccess.MAX_NAME} characters at most: its phase 1 makes an interface of it`);
            if (device.interfaces?.ipsec?.[name] || device.firewall?.ipsec?.[name])
                found.push(`${where}, named as another IPsec tunnel: FortiOS names the phase 1 of each after it. Give each its own name`);
            if (access.traffic_selectors.length > 1)
                found.push(
                    `${where}.traffic_selectors holds ${access.traffic_selectors.length}: one was tested on FortiOS. Write one prefix that holds them`
                );
            if ((access.dns?.length ?? 0) > FortiOsRemoteAccess.DNS_SERVERS)
                found.push(`${where}.dns, at most ${FortiOsRemoteAccess.DNS_SERVERS} on FortiOS`);
            found.push(...FortiOsIpsec.tunnelGaps(where, access, device));

            const servers = access.radius ?? [];
            if (servers.length > FortiOsRemoteAccess.RADIUS_ORDER.length)
                found.push(
                    `${where}.radius, more than ${FortiOsRemoteAccess.RADIUS_ORDER.length} servers: the platform asks at most ${FortiOsRemoteAccess.RADIUS_ORDER.length}`
                );
            const differ = (field: "source_address" | "auth_port") => new Set(servers.map((server) => server[field])).size > 1;
            if (differ("source_address"))
                found.push(`${where}.radius source_address, the platform asks every server from one address: write the same on each`);
            if (differ("auth_port"))
                found.push(`${where}.radius auth_port, the platform asks every server on one port: write the same on each`);
            servers.forEach((server, index) => {
                if (server.vrf)
                    found.push(
                        `${where}.radius[${index}].vrf, FortiOS 6.2 has no VRF setting for a RADIUS server: vrf-select comes in 7.6.1`
                    );
                if (server.acct_port !== undefined)
                    found.push(
                        `${where}.radius[${index}].acct_port, FortiOS 6.2.2 leaves an accounting server's port out of show at times, so the plan would never settle: leave it out for 1813`
                    );
            });
        }

        return found;
    }
}
