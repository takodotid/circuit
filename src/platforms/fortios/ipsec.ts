// A route-based IPsec tunnel is a phase 1 and a phase 2 of one name. The phase 1 makes the tunnel's interface, on the interface that holds its local address. The phase 2 encrypts everything routed into the tunnel's interface.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Ipsec, IpsecEncryption, IpsecEsp, IpsecIke, IpsecIntegrity } from "../../model";
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
    private static readonly DEFAULT_LIFETIME = { ike: 86_400, esp: 43_200 } as const;

    /** The fewest and most seconds a phase 1 or phase 2 key lives, `keylife` and `keylifeseconds`. */
    private static readonly LIFETIME = { min: 120, max: 172_800 } as const;

    /** A liveness check's interval and retries when nothing says, which `show` doesn't print, and the most it takes, `dpd-retryinterval` and `dpd-retrycount`. */
    private static readonly LIVENESS = { interval: 20, retries: 3, maxInterval: 3600, maxRetries: 10 } as const;

    static tunnels(device: Device): [string, Ipsec][] {
        return Object.entries(device.interfaces?.ipsec ?? {}).flatMap(([name, tunnel]) => (tunnel ? [[name, tunnel]] : []));
    }

    /** A tunnel with certificates takes the peer's only when its CA signed it, through an entry of `user peer` named after the CA. `peertype any` would take any peer. */
    static render(phase1: FortiOsNode, phase2: FortiOsNode, peers: FortiOsNode, device: Device): void {
        for (const [name, tunnel] of FortiOsIpsec.tunnels(device)) {
            const outgoing = FortiOsNames.holderOf(device, Address.host(tunnel.local_address));
            const ipv6 = Address.family(tunnel.remote_address) === "ipv6";
            const { ike, esp, liveness_check: check } = tunnel;

            // The version, the family, and the way to authenticate come first: the settings after them exist only once they are set. A new tunnel takes any peer ID and makes no kernel device of its own, and prints both (TRAPS.md).
            const entry = phase1.entry(name).set("interface", outgoing ? FortiOsTree.quote(FortiOsNames.of(device, outgoing)) : '""');
            if (ipv6) entry.set("ip-version", 6);
            entry.set("ike-version", 2).set(ipv6 ? "local-gw6" : "local-gw", Address.host(tunnel.local_address));
            if (tunnel.certificate) entry.set("authmethod", "signature");
            if (ike.lifetime !== FortiOsIpsec.DEFAULT_LIFETIME.ike) entry.set("keylife", ike.lifetime);
            entry
                .set("peertype", tunnel.ca_certificate ? "peer" : "any")
                .set("net-device", "disable")
                .set("proposal", FortiOsIpsec.ikeProposal(ike));
            if (check) entry.set("dpd", "on-idle");
            if (tunnel.nat_traversal === "always") entry.set("nattraversal", "forced");
            entry.set("dhgrp", ike.dh_group).set(ipv6 ? "remote-gw6" : "remote-gw", tunnel.remote_address);
            if (tunnel.pre_shared_key) entry.set("psksecret", FortiOsTree.quote(Secrets.marker(tunnel.pre_shared_key)));
            if (tunnel.certificate) entry.set("certificate", FortiOsTree.quote(tunnel.certificate));
            if (tunnel.ca_certificate) {
                entry.set("peer", FortiOsTree.quote(tunnel.ca_certificate));
                peers.entry(tunnel.ca_certificate).set("ca", FortiOsTree.quote(tunnel.ca_certificate));
            }
            if (check && check.retries !== FortiOsIpsec.LIVENESS.retries) entry.set("dpd-retrycount", check.retries);
            if (check && check.interval !== FortiOsIpsec.LIVENESS.interval) entry.set("dpd-retryinterval", check.interval);

            const child = phase2.entry(name).set("phase1name", FortiOsTree.quote(name)).set("proposal", FortiOsIpsec.espProposal(esp));
            if (esp.pfs_group) child.set("dhgrp", esp.pfs_group);
            else child.set("pfs", "disable");
            if (esp.lifetime !== FortiOsIpsec.DEFAULT_LIFETIME.esp) child.set("keylifeseconds", esp.lifetime);
        }
    }

    /** What the platform can't express. A phase 1 proposal has one hash for integrity and the pseudorandom function. A key lives 120 to 172800 seconds. A liveness check waits up to 3600 seconds and retries up to 10 times. The tunnel's interface holds one IPv4 address, with its peer. */
    static gaps(device: Device): string[] {
        const found: string[] = [];

        for (const [name, tunnel] of FortiOsIpsec.tunnels(device)) {
            const where = `interfaces.ipsec.${name}`;
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
                if (lifetime < min || lifetime > max)
                    found.push(`${where}.${sa}.lifetime ${lifetime}, the platform takes ${min} to ${max}`);
            }

            const { maxInterval, maxRetries } = FortiOsIpsec.LIVENESS;
            if ((tunnel.liveness_check?.interval ?? 0) > maxInterval)
                found.push(`${where}.liveness_check.interval ${tunnel.liveness_check?.interval}, the platform takes up to ${maxInterval}`);
            if ((tunnel.liveness_check?.retries ?? 0) > maxRetries)
                found.push(`${where}.liveness_check.retries ${tunnel.liveness_check?.retries}, the platform takes up to ${maxRetries}`);

            const addresses = tunnel.addresses ?? [];
            const ipv4 = addresses.filter((entry) => Address.family(typeof entry === "string" ? entry : entry.address) === "ipv4");
            if (ipv4.some((entry) => typeof entry === "string"))
                found.push(`${where}.addresses, an IPv4 address on a tunnel takes its peer`);
            if (ipv4.length > 1) found.push(`${where}.addresses, one IPv4 address`);
            if (ipv4.length < addresses.length) found.push(`${where}.addresses, IPv6 in the tunnel, which is not built yet`);
        }

        return found;
    }

    /** A `gcm` encryption with its pseudorandom function, or a `cbc` one with its hash. */
    private static ikeProposal(ike: IpsecIke): string {
        const encryption = FortiOsIpsec.ENCRYPTION[ike.encryption];
        return ike.integrity ? `${encryption}-${FortiOsIpsec.HASH[ike.integrity]}` : `${encryption}-prf${FortiOsIpsec.HASH[ike.prf]}`;
    }

    /** A `gcm` encryption alone, or a `cbc` one with its hash. */
    private static espProposal(esp: IpsecEsp): string {
        const encryption = FortiOsIpsec.ENCRYPTION[esp.encryption];
        return esp.integrity ? `${encryption}-${FortiOsIpsec.HASH[esp.integrity]}` : encryption;
    }
}
