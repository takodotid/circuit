import { Address } from "../core/address";
import type { Ipsec } from "../model";

type Report = (message: string) => void;

/** An IPsec tunnel as RFC 7296, RFC 8221, and RFC 8247 allow it. */
export class IpsecChecks {
    /** An encryption that protects integrity itself (AEAD). */
    private static readonly AEAD = /-gcm$/;

    /** Endpoints of one family, an integrity algorithm with each `cbc` encryption and none with a `gcm` one, and lifetimes in whole seconds. */
    static check(where: string, tunnel: Ipsec, report: Report): void {
        const local = Address.host(tunnel.local_address);
        const remote = tunnel.remote_address;
        if (Address.isValid(local) && Address.isValid(remote) && Address.family(local) !== Address.family(remote))
            report(`${where}: local_address ${local} and remote_address ${remote} differ in family`);

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
    }
}
