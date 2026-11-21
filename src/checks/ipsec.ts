import { Address } from "../core/address";
import type { Certificate, Ipsec, IpsecIdentity } from "../model";

type Report = (message: string) => void;

/** An IPsec tunnel as RFC 7296, RFC 8221, and RFC 8247 allow it. */
export class IpsecChecks {
    /** An encryption that protects integrity itself (AEAD). */
    private static readonly AEAD = /-gcm$/;

    /** The keys of `remote_identity`, of which a tunnel writes one. */
    private static readonly IDENTITIES = [
        "distinguished_name",
        "fqdn",
        "email",
        "address",
    ] as const satisfies readonly (keyof IpsecIdentity)[];

    /** One attribute of a distinguished name as RFC 4514 writes it: a type, by name or OID, then `=` and a value. */
    private static readonly ATTRIBUTE = /^([A-Za-z][A-Za-z0-9-]*|\d+(\.\d+)+)=.+$/;

    /** A domain name in the preferred syntax of RFC 1035 §2.3.1: labels of letters, digits, and hyphens, split by dots. */
    private static readonly DOMAIN = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.?$/;

    /** An email address: something before one `@`, and a domain after it. */
    private static readonly EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

    /** Endpoints of one family, and one way to authenticate, with a remote identity only beside certificates. An integrity algorithm with each `cbc` encryption and none with a `gcm` one, and lifetimes and liveness checks in whole numbers. `certificates` are the device's. */
    static check(where: string, tunnel: Ipsec, certificates: Partial<Record<string, Certificate>>, report: Report): void {
        const local = Address.host(tunnel.local_address);
        const remote = tunnel.remote_address;
        if (Address.isValid(local) && Address.isValid(remote) && Address.family(local) !== Address.family(remote))
            report(`${where}: local_address ${local} and remote_address ${remote} differ in family`);

        IpsecChecks.authentication(where, tunnel, report);
        if (tunnel.remote_identity) IpsecChecks.identity(`${where}.remote_identity`, tunnel.remote_identity, report);
        if (tunnel.remote_identity && !tunnel.certificate)
            report(`${where}.remote_identity needs certificate and ca_certificate: the peer's certificate carries its identity`);

        const own = tunnel.certificate;
        if (own && certificates[own] && !certificates[own].private_key)
            report(`${where}.certificate ${own} has no private key to sign with. Add its private_key`);
        const ca = tunnel.ca_certificate;
        if (ca && certificates[ca]?.private_key)
            report(`${where}.ca_certificate ${ca} has a private key: write the CA's certificate alone, which the device only trusts`);

        for (const [sa, algorithms] of [
            ["ike", tunnel.ike],
            ["esp", tunnel.esp],
        ] as const) {
            const at = `${where}.${sa}`;
            const aead = IpsecChecks.AEAD.test(algorithms.encryption);
            if (aead && algorithms.integrity)
                report(`${at}.integrity: ${algorithms.encryption} protects integrity itself. Remove integrity`);
            if (!aead && !algorithms.integrity)
                report(`${at} has ${algorithms.encryption} without integrity. Add integrity, such as "hmac-sha2-256-128"`);
            if (!(Number.isInteger(algorithms.lifetime) && algorithms.lifetime > 0))
                report(`${at}.lifetime ${algorithms.lifetime} is not a whole number of seconds above 0`);
        }

        const check = tunnel.liveness_check;
        if (check && !(Number.isInteger(check.interval) && check.interval > 0))
            report(`${where}.liveness_check.interval ${check.interval} is not a whole number of seconds above 0`);
        if (check && !(Number.isInteger(check.retries) && check.retries > 0))
            report(`${where}.liveness_check.retries ${check.retries} is not a whole number above 0`);

        const keepalive = tunnel.nat_keepalive;
        if (keepalive !== undefined && !(Number.isInteger(keepalive) && keepalive > 0))
            report(`${where}.nat_keepalive ${keepalive} is not a whole number of seconds above 0`);
    }

    /** One of the four IKEv2 identities, written as RFC 7296 §3.5 and RFC 4514 write it. */
    private static identity(where: string, identity: IpsecIdentity, report: Report): void {
        const written = IpsecChecks.IDENTITIES.filter((kind) => identity[kind] !== undefined);
        if (written.length !== 1) {
            report(`${where} holds ${written.join(", ") || "nothing"}. Write one of ${IpsecChecks.IDENTITIES.join(", ")}`);
            return;
        }

        const { distinguished_name: name, fqdn, email, address } = identity;
        if (name !== undefined && !name.split(/(?<!\\),/).every((part) => IpsecChecks.ATTRIBUTE.test(part.trim())))
            report(
                `${where}.distinguished_name "${name}" is no name: write each attribute as type=value, split by commas, such as CN=branch-1,O=Example`
            );
        if (fqdn !== undefined && !IpsecChecks.DOMAIN.test(fqdn))
            report(`${where}.fqdn "${fqdn}" is no domain name: write labels of letters, digits, and hyphens, split by dots`);
        if (email !== undefined && !IpsecChecks.EMAIL.test(email))
            report(`${where}.email "${email}" is no email address: write it as name@domain`);
        if (address !== undefined && !Address.isValid(address)) report(`${where}.address ${address} is no IP address`);
    }

    /** A key both ends share, or a certificate with the CA that signed the peer's: one of the two, whole. */
    private static authentication(where: string, tunnel: Ipsec, report: Report): void {
        const key = tunnel.pre_shared_key !== undefined;
        const certificate = tunnel.certificate !== undefined;
        const ca = tunnel.ca_certificate !== undefined;

        if (key && (certificate || ca))
            report(`${where}: pre_shared_key and a certificate. Keep one: pre_shared_key, or certificate with ca_certificate`);
        else if (!key && !certificate && !ca)
            report(`${where} has no way to authenticate. Add pre_shared_key, or certificate with ca_certificate`);
        else if (certificate && !ca) report(`${where}.certificate needs ca_certificate: the CA that signed the peer's certificate`);
        else if (ca && !certificate) report(`${where}.ca_certificate needs certificate: this end's own, with its private key`);
    }
}
