// A route-based IPsec tunnel is a phase 1 and a phase 2 of one name. The phase 1 makes the tunnel's interface, on the interface that holds its local address. The phase 2 encrypts all IPv4 routed into the tunnel's interface. A phase 2 carries one family, so a tunnel with an IPv6 address has a second one for IPv6, named after the tunnel with `-v6`.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Ipsec, IpsecEncryption, IpsecEsp, IpsecIke, IpsecIntegrity, IpsecTunnel, PolicyIpsec } from "../../model";
import { FortiOsNames } from "./names";
import type { FortiOsNode } from "./tree";
import { FortiOsTree } from "./tree";

export class FortiOsIpsec {
    /** Each encryption as a proposal starts with it. */
    private static readonly ENCRYPTION: Record<IpsecEncryption, string> = {
        "aes-128-cbc": "aes128",
        "aes-256-cbc": "aes256",
        "aes-128-gcm": "aes128gcm",
        "aes-256-gcm": "aes256gcm",
    };

    /** Each integrity algorithm and pseudorandom function as a proposal ends with it. */
    private static readonly HASH: Record<IpsecIntegrity | IpsecIke["prf"], string> = {
        "hmac-sha2-256-128": "sha256",
        "hmac-sha2-512-256": "sha512",
        "hmac-sha2-256": "sha256",
        "hmac-sha2-512": "sha512",
    };

    /** How many seconds a phase 1 and a phase 2 key live when nothing says, which `show` doesn't print. */
    static readonly DEFAULT_LIFETIME = { ike: 86_400, esp: 43_200 } as const;

    /** The fewest and most seconds a phase 1 or phase 2 key lives, `keylife` and `keylifeseconds`. */
    private static readonly LIFETIME = { min: 120, max: 172_800 } as const;

    /** A liveness check's interval and retries when nothing says, which `show` doesn't print, and the most it takes, `dpd-retryinterval` and `dpd-retrycount`. */
    private static readonly LIVENESS = { interval: 20, retries: 3, maxInterval: 3600, maxRetries: 10 } as const;

    /** What the phase 2 for IPv6 adds to the tunnel's name, as other entries of one family do. */
    private static readonly IPV6_SUFFIX = "-v6";

    /** The most characters the name of a phase 1 or a phase 2 has. */
    private static readonly MAX_NAME = 35;

    /** The NAT keepalive interval when nothing says, which `show` doesn't print, and the fewest and most seconds `keepalive` takes. */
    private static readonly KEEPALIVE = { interval: 10, min: 10, max: 900 } as const;

    static tunnels(device: Device): [string, Ipsec][] {
        return Object.entries(device.interfaces?.ipsec ?? {}).flatMap(([name, tunnel]) => (tunnel ? [[name, tunnel]] : []));
    }

    /**
     * A tunnel with certificates takes the peer's only when its CA signed it, through an entry of `user peer` named after the CA. `peertype any` would take any peer. With a `remote_identity`, the entry is the tunnel's own, named after it, and holds the subject too. `subject-match value` makes the VDOM's every peer match each attribute of its subject whole: `substring`, the default, would take `CN=branch-10` for `CN=branch-1` (TRAPS.md).
     */
    static render(phase1: FortiOsNode, phase2: FortiOsNode, peers: FortiOsNode, certificates: FortiOsNode, device: Device): void {
        if (FortiOsIpsec.tunnels(device).some(([, tunnel]) => tunnel.remote_identity)) certificates.set("subject-match", "value");

        for (const [name, tunnel] of FortiOsIpsec.tunnels(device)) {
            const ipv6 = Address.family(tunnel.remote_address) === "ipv6";
            const { ike, esp } = tunnel;
            const check = tunnel.liveness_check || undefined;

            // The version, the family, and the way to authenticate come first: the settings after them exist only once they are set. A new tunnel takes any peer ID and makes no kernel device of its own, and prints both (TRAPS.md).
            const entry = phase1.entry(name).set("interface", FortiOsIpsec.outgoing(device, tunnel.local_address));
            if (ipv6) entry.set("ip-version", 6);
            entry.set("ike-version", 2).set(ipv6 ? "local-gw6" : "local-gw", Address.host(tunnel.local_address));
            if (tunnel.certificate) entry.set("authmethod", "signature");
            if (ike.lifetime !== FortiOsIpsec.DEFAULT_LIFETIME.ike) entry.set("keylife", ike.lifetime);
            entry
                .set("peertype", tunnel.ca_certificate ? "peer" : "any")
                .set("net-device", "disable")
                .set("proposal", FortiOsIpsec.ikeProposal(ike));
            if (check) entry.set("dpd", "on-idle");
            if (tunnel.liveness_check === false) entry.set("dpd", "disable");
            if (tunnel.nat_traversal === "always") entry.set("nattraversal", "forced");
            // The interval exists only while NAT traversal is `enable`, the default (TRAPS.md).
            const keepalive = tunnel.nat_keepalive;
            if (keepalive !== undefined && keepalive !== FortiOsIpsec.KEEPALIVE.interval) entry.set("keepalive", keepalive);
            entry.set("dhgrp", ike.dh_group).set(ipv6 ? "remote-gw6" : "remote-gw", tunnel.remote_address);
            FortiOsIpsec.credentials(entry, peers, name, tunnel, tunnel.remote_identity?.distinguished_name);
            if (check && check.retries !== FortiOsIpsec.LIVENESS.retries) entry.set("dpd-retrycount", check.retries);
            if (check && check.interval !== FortiOsIpsec.LIVENESS.interval) entry.set("dpd-retryinterval", check.interval);

            FortiOsIpsec.child(phase2.entry(name), name, esp);
            // Its selectors are every IPv6 address both ways, `::/0`, which `show` doesn't print.
            if (FortiOsIpsec.carriesIpv6(tunnel))
                FortiOsIpsec.child(phase2.entry(`${name}${FortiOsIpsec.IPV6_SUFFIX}`), name, esp)
                    .set("src-addr-type", "subnet6")
                    .set("dst-addr-type", "subnet6");
        }
    }

    /**
     * The tunnel's key, or its certificate and the `user peer` that takes the peer's: named after the CA, or after the tunnel when it checks the peer's subject too.
     */
    private static credentials(entry: FortiOsNode, peers: FortiOsNode, name: string, tunnel: IpsecTunnel, subject?: string): void {
        if (tunnel.pre_shared_key) entry.set("psksecret", FortiOsTree.quote(Secrets.marker(tunnel.pre_shared_key)));
        if (tunnel.certificate) entry.set("certificate", FortiOsTree.quote(tunnel.certificate));
        if (!tunnel.ca_certificate) return;

        const peer = subject === undefined ? tunnel.ca_certificate : name;
        entry.set("peer", FortiOsTree.quote(peer));
        peers.entry(peer).set("ca", FortiOsTree.quote(tunnel.ca_certificate));
        if (subject !== undefined) peers.entry(peer).set("subject", FortiOsTree.quote(subject));
    }

    /** The interface that holds a tunnel's local address, which IKE and ESP leave from. */
    static outgoing(device: Device, local: string): string {
        const holder = FortiOsNames.holderOf(device, Address.host(local));
        return holder ? FortiOsTree.quote(FortiOsNames.of(device, holder)) : '""';
    }

    static policyTunnels(device: Device): [string, PolicyIpsec][] {
        return Object.entries(device.firewall?.ipsec ?? {}).flatMap(([name, tunnel]) => (tunnel ? [[name, tunnel]] : []));
    }

    /** The phase 2 of a policy-based tunnel's selector, by its place among them. */
    private static selectorName(name: string, index: number): string {
        return `${name}-${index + 1}`;
    }

    /**
     * A policy-based tunnel is a phase 1 that makes no interface, and a phase 2 for each selector, IPv4 only on 6.2 (TRAPS.md). A new phase 1 prints `peertype any`. `FortiOsFirewall` writes a policy for each selector, which sends its traffic into the tunnel.
     */
    static renderPolicyBased(phase1: FortiOsNode, phase2: FortiOsNode, peers: FortiOsNode, device: Device): void {
        for (const [name, tunnel] of FortiOsIpsec.policyTunnels(device)) {
            const { ike, esp } = tunnel;
            const entry = phase1.entry(name).set("interface", FortiOsIpsec.outgoing(device, tunnel.local_address));
            entry.set("ike-version", 2).set("local-gw", Address.host(tunnel.local_address));
            if (tunnel.certificate) entry.set("authmethod", "signature");
            if (ike.lifetime !== FortiOsIpsec.DEFAULT_LIFETIME.ike) entry.set("keylife", ike.lifetime);
            entry.set("peertype", tunnel.ca_certificate ? "peer" : "any").set("proposal", FortiOsIpsec.ikeProposal(ike));
            if (tunnel.liveness_check === false) entry.set("dpd", "disable");
            entry.set("dhgrp", ike.dh_group).set("remote-gw", tunnel.remote_address);
            FortiOsIpsec.credentials(entry, peers, name, tunnel);

            tunnel.traffic_selectors.forEach((selector, index) =>
                FortiOsIpsec.child(phase2.entry(FortiOsIpsec.selectorName(name, index)), name, esp)
                    .set("src-subnet", FortiOsNames.subnet(selector.local_prefix))
                    .set("dst-subnet", FortiOsNames.subnet(selector.remote_prefix))
            );
        }
    }

    /**
     * The ports and interfaces a selector's local traffic arrives on: those whose network holds its local prefix or lies inside it, and those a static route inside it leaves through. The policy that sends the traffic into the tunnel names them, as 6.2 takes no `any` there (TRAPS.md).
     */
    static inward(device: Device, prefix: string): string[] {
        const overlaps = (network: string) => Address.contains(prefix, network) || Address.contains(network, prefix);
        const found = FortiOsNames.addressed(device).filter((name) =>
            FortiOsNames.addressesOf(FortiOsNames.settingsOf(device, name)).some((address) => overlaps(FortiOsNames.network(address)))
        );

        for (const route of device.routing?.static_routes ?? []) {
            if (!Address.contains(prefix, route.prefix)) continue;
            const via = route.interface ?? (route.next_hop ? FortiOsNames.interfaceFor(device, route.next_hop, route.vrf) : undefined);
            if (via && !found.includes(via)) found.push(via);
        }

        return found;
    }

    /** A phase 2 of the phase 1 `name`, with the ESP SA's algorithms. */
    static child(entry: FortiOsNode, name: string, esp: IpsecEsp): FortiOsNode {
        entry.set("phase1name", FortiOsTree.quote(name)).set("proposal", FortiOsIpsec.espProposal(esp));
        if (esp.pfs_group) entry.set("dhgrp", esp.pfs_group);
        else entry.set("pfs", "disable");
        if (esp.lifetime !== FortiOsIpsec.DEFAULT_LIFETIME.esp) entry.set("keylifeseconds", esp.lifetime);
        return entry;
    }

    /** A tunnel carries IPv6 when its interface has an IPv6 address. */
    private static carriesIpv6(tunnel: Ipsec): boolean {
        return FortiOsIpsec.ofFamily(tunnel, "ipv6").length > 0;
    }

    /** The tunnel's addresses of one family. */
    private static ofFamily(tunnel: Ipsec, family: "ipv4" | "ipv6"): NonNullable<Ipsec["addresses"]>[number][] {
        return (tunnel.addresses ?? []).filter(
            (entry) => Address.family(Address.host(typeof entry === "string" ? entry : entry.address)) === family
        );
    }

    /** What a tunnel of either kind can't have: a local address no interface holds, a hash for integrity other than the pseudorandom function's, or a key's lifetime out of range. */
    static tunnelGaps(where: string, tunnel: Pick<IpsecTunnel, "ike" | "esp" | "local_address">, device: Device): string[] {
        const found: string[] = [];
        const { ike, esp } = tunnel;

        if (!FortiOsNames.holderOf(device, Address.host(tunnel.local_address)))
            found.push(`${where}.local_address, no interface holds ${Address.host(tunnel.local_address)}`);
        if (ike.integrity && FortiOsIpsec.HASH[ike.integrity] !== FortiOsIpsec.HASH[ike.prf])
            found.push(`${where}.ike.prf ${ike.prf} with integrity ${ike.integrity}: the platform uses one hash for both`);

        for (const [sa, lifetime] of [
            ["ike", ike.lifetime],
            ["esp", esp.lifetime],
        ] as const) {
            const { min, max } = FortiOsIpsec.LIFETIME;
            if (lifetime < min || lifetime > max) found.push(`${where}.${sa}.lifetime ${lifetime}, the platform takes ${min} to ${max}`);
        }

        return found;
    }

    /**
     * What a policy-based tunnel can't have on 6.2: IPv6, whose phase 1 takes no `ip-version 6`, phase 2 no `subnet6`, and `firewall policy6` no `action ipsec` (TRAPS.md). A local prefix that no interface leads to, which the tunnel's policy can't name. A name too long for its phase 2s.
     */
    private static policyGaps(device: Device): string[] {
        const found: string[] = [];

        for (const [name, tunnel] of FortiOsIpsec.policyTunnels(device)) {
            const where = `firewall.ipsec.${name}`;
            found.push(...FortiOsIpsec.tunnelGaps(where, tunnel, device));

            for (const key of ["local_address", "remote_address"] as const)
                if (Address.family(Address.host(tunnel[key])) === "ipv6")
                    found.push(
                        `${where}.${key}, IPv6: a FortiOS 6.2 policy-based tunnel runs over IPv4 only. Write a route-based tunnel in interfaces.ipsec`
                    );

            tunnel.traffic_selectors.forEach((selector, index) => {
                const at = `${where}.traffic_selectors[${index}]`;
                if (FortiOsNames.familyOfPrefix(selector.local_prefix) === "ipv6") {
                    found.push(
                        `${at}, IPv6: a FortiOS 6.2 policy-based tunnel carries IPv4 only. Write a route-based tunnel in interfaces.ipsec`
                    );
                    return;
                }
                if (!FortiOsIpsec.inward(device, selector.local_prefix).length)
                    found.push(
                        `${at}.local_prefix ${selector.local_prefix}: no interface has a network in it or holding it, and no static route inside it leaves through one. FortiOS's policy for the tunnel names the interfaces this traffic arrives on`
                    );
            });

            const longest = FortiOsIpsec.selectorName(name, tunnel.traffic_selectors.length - 1);
            if (longest.length > FortiOsIpsec.MAX_NAME)
                found.push(
                    `${where}, a name of ${name.length} characters: its last phase 2, ${longest}, passes the ${FortiOsIpsec.MAX_NAME} the platform takes`
                );
        }

        return found;
    }

    /**
     * What the platform can't express. A phase 1 proposal has one hash for integrity and the pseudorandom function. A key lives 120 to 172800 seconds. A liveness check waits up to 3600 seconds and retries up to 10 times. A NAT keepalive goes every 10 to 900 seconds, never with NAT traversal forced. The tunnel's interface holds one IPv4 address, with its peer, and one IPv6 address.
     */
    static gaps(device: Device): string[] {
        const found: string[] = FortiOsIpsec.policyGaps(device);

        for (const [name, tunnel] of FortiOsIpsec.tunnels(device)) {
            const where = `interfaces.ipsec.${name}`;
            found.push(...FortiOsIpsec.tunnelGaps(where, tunnel, device));

            const { maxInterval, maxRetries } = FortiOsIpsec.LIVENESS;
            const check = tunnel.liveness_check || undefined;
            if (check && check.interval > maxInterval)
                found.push(`${where}.liveness_check.interval ${check.interval}, the platform takes up to ${maxInterval}`);
            if (check && check.retries > maxRetries)
                found.push(`${where}.liveness_check.retries ${check.retries}, the platform takes up to ${maxRetries}`);

            const keepalive = tunnel.nat_keepalive;
            const { min, max } = FortiOsIpsec.KEEPALIVE;
            if (keepalive !== undefined && (keepalive < min || keepalive > max))
                found.push(`${where}.nat_keepalive ${keepalive}, the platform takes ${min} to ${max}`);
            if (keepalive !== undefined && tunnel.nat_traversal === "always")
                found.push(
                    `${where}.nat_keepalive with nat_traversal always: the platform has no keepalive interval while ESP always goes in UDP`
                );

            found.push(...FortiOsIpsec.identityGaps(where, name, tunnel, device));

            const ipv4 = FortiOsIpsec.ofFamily(tunnel, "ipv4");
            const ipv6 = FortiOsIpsec.ofFamily(tunnel, "ipv6");
            if (ipv4.some((entry) => typeof entry === "string"))
                found.push(`${where}.addresses, an IPv4 address on a tunnel takes its peer`);
            if (ipv4.length > 1) found.push(`${where}.addresses, one IPv4 address`);
            // The tunnel's interface has no IPv6 peer, `remote-ip6`.
            if (ipv6.some((entry) => typeof entry !== "string")) found.push(`${where}.addresses, a peer on an IPv6 address`);
            if (ipv6.length > 1) found.push(`${where}.addresses, one IPv6 address`);
            const ipv6Child = `${name}${FortiOsIpsec.IPV6_SUFFIX}`;
            if (ipv6.length > 0 && device.interfaces?.ipsec?.[ipv6Child])
                found.push(
                    `${where}.addresses, IPv6 in the tunnel while another tunnel is named ${ipv6Child}, which its phase 2 for IPv6 takes`
                );
        }

        return found;
    }

    /** A tunnel whose `remote_identity` the platform can't check: a `user peer` matches a certificate's subject, never its subject alternative names (TRAPS.md). Its entry is named after the tunnel, which a CA's entry for another tunnel may hold already. */
    private static identityGaps(where: string, name: string, tunnel: Ipsec, device: Device): string[] {
        const identity = tunnel.remote_identity;
        if (!identity) return [];

        const found: string[] = [];
        for (const kind of ["fqdn", "email", "address"] as const)
            if (identity[kind] !== undefined)
                found.push(
                    `${where}.remote_identity.${kind}, which RFC 4945 finds in a certificate's subject alternative names: the platform matches the subject alone, so write distinguished_name`
                );

        const sharedWithCa = FortiOsIpsec.tunnels(device).some(([, other]) => other.ca_certificate === name && !other.remote_identity);
        if (sharedWithCa)
            found.push(
                `${where}.remote_identity, as the tunnel's user peer, named ${name}, is the one of the CA ${name} too: rename the tunnel`
            );
        return found;
    }

    /** A `gcm` encryption with its pseudorandom function, or a `cbc` one with its hash. */
    static ikeProposal(ike: IpsecIke): string {
        const encryption = FortiOsIpsec.ENCRYPTION[ike.encryption];
        return ike.integrity ? `${encryption}-${FortiOsIpsec.HASH[ike.integrity]}` : `${encryption}-prf${FortiOsIpsec.HASH[ike.prf]}`;
    }

    /** A `gcm` encryption alone, or a `cbc` one with its hash. */
    private static espProposal(esp: IpsecEsp): string {
        const encryption = FortiOsIpsec.ENCRYPTION[esp.encryption];
        return esp.integrity ? `${encryption}-${FortiOsIpsec.HASH[esp.integrity]}` : encryption;
    }
}
