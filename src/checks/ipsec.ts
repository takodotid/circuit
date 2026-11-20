import { Address } from "../core/address";
import type { Certificate, Ipsec } from "../model";

type Report = (message: string) => void;

/** An IPsec tunnel as RFC 7296, RFC 8221, and RFC 8247 allow it. */
export class IpsecChecks {
    /** An encryption that protects integrity itself (AEAD). */
    private static readonly AEAD = /-gcm$/;

    /** Endpoints of one family, one way to authenticate, an integrity algorithm with each `cbc` encryption and none with a `gcm` one, and lifetimes and liveness checks in whole numbers. `certificates` are the device's. */
    static check(where: string, tunnel: Ipsec, certificates: Partial<Record<string, Certificate>>, report: Report): void {
        const local = Address.host(tunnel.local_address);
        const remote = tunnel.remote_address;
        if (Address.isValid(local) && Address.isValid(remote) && Address.family(local) !== Address.family(remote))
            report(`${where}: local_address ${local} and remote_address ${remote} differ in family`);

        IpsecChecks.authentication(where, tunnel, report);

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
