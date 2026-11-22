// A policy-based IPsec tunnel is a profile with the IKE SA's algorithms, a proposal with the ESP SA's, a peer, and its identity, all of the tunnel's name. A policy for each traffic selector names the peer and the proposal.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device, DhGroup, IpsecEncryption, IpsecIntegrity, PolicyIpsec } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

export class RouterOsIpsec {
    /** Each CBC encryption as a profile names it. The IKE daemon has no AES-GCM: a profile with it is a syntax error (TRAPS.md). */
    private static readonly IKE_ENCRYPTION: Partial<Record<IpsecEncryption, string>> = {
        "aes-128-cbc": "aes-128",
        "aes-256-cbc": "aes-256",
    };

    /** Each integrity algorithm and pseudorandom function by the hash a profile or a proposal names. */
    private static readonly HASH: Record<IpsecIntegrity | "hmac-sha2-256" | "hmac-sha2-512", string> = {
        "hmac-sha2-256-128": "sha256",
        "hmac-sha2-512-256": "sha512",
        "hmac-sha2-256": "sha256",
        "hmac-sha2-512": "sha512",
    };

    /** Each Diffie-Hellman group by the name a profile and a proposal give it. */
    private static readonly DH_GROUP: Record<DhGroup, string> = {
        14: "modp2048",
        15: "modp3072",
        16: "modp4096",
        19: "ecp256",
        20: "ecp384",
        21: "ecp521",
    };

    /** The profile and the proposal every RouterOS has, which a tunnel's own can't be named. */
    private static readonly BUILT_IN = "default";

    static tunnels(device: Device): [string, PolicyIpsec][] {
        return RouterOsSyntax.entries(device.firewall?.ipsec);
    }

    /**
     * Each tunnel as the export prints it. The peer starts IKEv2 from `local_address`. A policy's `peer` gives its SA's ends, and `tunnel=yes` makes it tunnel mode. A proposal with AES-GCM takes `auth-algorithms=""`: without it, RouterOS refuses it. `dpd-interval=disable-dpd` turns liveness checks off, and the IKE SA is still made again at its lifetime (TRAPS.md).
     */
    static render(render: RouterOsRender, device: Device): void {
        for (const [name, tunnel] of RouterOsIpsec.tunnels(device)) {
            const { ike, esp } = tunnel;
            render.add("/ip ipsec profile", "add", {
                "dh-group": RouterOsIpsec.DH_GROUP[ike.dh_group],
                "dpd-interval": tunnel.liveness_check === false && "disable-dpd",
                "enc-algorithm": RouterOsIpsec.IKE_ENCRYPTION[ike.encryption],
                "hash-algorithm": ike.integrity && RouterOsIpsec.HASH[ike.integrity],
                lifetime: RouterOsSyntax.duration(ike.lifetime),
                name,
                "prf-algorithm": RouterOsIpsec.HASH[ike.prf],
            });
            render.add("/ip ipsec proposal", "add", {
                "auth-algorithms": esp.integrity ? RouterOsIpsec.HASH[esp.integrity] : "",
                "enc-algorithms": esp.encryption,
                lifetime: RouterOsSyntax.duration(esp.lifetime),
                name,
                "pfs-group": esp.pfs_group ? RouterOsIpsec.DH_GROUP[esp.pfs_group] : "none",
            });

            const remote = tunnel.remote_address;
            const length = Address.bits(Address.family(remote));
            render.add("/ip ipsec peer", "add", {
                address: `${Address.canonical(remote)}/${length}`,
                comment: tunnel.description,
                "exchange-mode": "ike2",
                "local-address": Address.canonical(tunnel.local_address),
                name,
                profile: name,
            });
            render.add(
                "/ip ipsec identity",
                "add",
                tunnel.certificate
                    ? { "auth-method": "digital-signature", certificate: tunnel.certificate, peer: name }
                    : { peer: name, secret: tunnel.pre_shared_key && Secrets.marker(tunnel.pre_shared_key) }
            );

            for (const selector of tunnel.traffic_selectors)
                render.add("/ip ipsec policy", "add", {
                    "dst-address": Address.canonical(selector.remote_prefix),
                    peer: name,
                    proposal: name,
                    "src-address": Address.canonical(selector.local_prefix),
                    tunnel: "yes",
                });
        }
    }

    /**
     * What RouterOS 7.24 can't express. Its IKE daemon has no AES-GCM, and runs in the main table only. It takes a peer's certificate that any certificate it holds signed, not only `ca_certificate` (TRAPS.md).
     */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const holders = Derive.holders(device);

        for (const [name, tunnel] of RouterOsIpsec.tunnels(device)) {
            const where = `firewall.ipsec.${name}`;
            if (name === RouterOsIpsec.BUILT_IN)
                found.push(`${where}: the name of RouterOS's own IPsec profile and proposal, which the tunnel's take. Write another name`);
            if (!RouterOsIpsec.IKE_ENCRYPTION[tunnel.ike.encryption])
                found.push(
                    `${where}.ike.encryption ${tunnel.ike.encryption}: RouterOS's IKE has no AES-GCM. Write aes-128-cbc or aes-256-cbc, with integrity`
                );

            const local = Address.host(tunnel.local_address);
            const holder = holders.find(({ settings }) =>
                (settings.addresses ?? []).some((entry) => Address.host(typeof entry === "string" ? entry : entry.address) === local)
            );
            if (!holder) found.push(`${where}.local_address ${local}: no port or interface of the device holds it`);
            else if (holder.settings.vrf)
                found.push(
                    `${where}.local_address ${local}, on ${holder.where} in VRF ${holder.settings.vrf}: RouterOS runs IKE in the main table only (TRAPS.md)`
                );

            if (tunnel.certificate) found.push(...RouterOsIpsec.caGaps(where, tunnel.ca_certificate, device));
        }

        return found;
    }

    /** A tunnel with certificates takes a peer's certificate that any certificate RouterOS holds signed (TRAPS.md). So `ca_certificate` must be the device's only certificate without a private key, which the device holds. */
    private static caGaps(where: string, ca: string | undefined, device: Device): string[] {
        const certificates = Object.entries(device.system?.certificates ?? {});
        if (!ca) return [`${where}.ca_certificate is left out: RouterOS needs the CA that signed the peer's certificate`];
        if (!device.system?.certificates?.[ca])
            return [`${where}.ca_certificate ${ca}: no certificate of system.certificates has that name`];

        const others = certificates.filter(([other, certificate]) => other !== ca && certificate && !certificate.private_key);
        if (!others.length) return [];
        return [
            `${where}.ca_certificate ${ca}: RouterOS takes a peer's certificate that any certificate it holds signed, and it holds ${others.map(([other]) => other).join(", ")} too. Keep ${ca} the only certificate without a private key`,
        ];
    }
}
