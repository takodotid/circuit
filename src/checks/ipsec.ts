import { Address } from "../core/address";
import { ServicesChecks } from "./services";
import type { Certificate, Device, IpsecEsp, IpsecIdentity, IpsecIke, IpsecTunnel, RemoteAccessSelector, TrafficSelector } from "../model";

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
    static check(where: string, tunnel: IpsecTunnel, certificates: Partial<Record<string, Certificate>>, report: Report): void {
        const local = Address.host(tunnel.local_address);
        const remote = tunnel.remote_address;
        if (Address.isValid(local) && Address.isValid(remote) && Address.family(local) !== Address.family(remote))
            report(`${where}: local_address ${local} and remote_address ${remote} differ in family`);

        IpsecChecks.authentication(where, tunnel, report);
        if (tunnel.remote_identity) IpsecChecks.identity(`${where}.remote_identity`, tunnel.remote_identity, report);
        if (tunnel.remote_identity && !tunnel.certificate)
            report(`${where}.remote_identity needs certificate and ca_certificate: the peer's certificate carries its identity`);

        IpsecChecks.keys(where, tunnel, certificates, report);
        IpsecChecks.algorithms(where, tunnel, report);

        const check = tunnel.liveness_check;
        if (check && !(Number.isInteger(check.interval) && check.interval > 0))
            report(`${where}.liveness_check.interval ${check.interval} is not a whole number of seconds above 0`);
        if (check && !(Number.isInteger(check.retries) && check.retries > 0))
            report(`${where}.liveness_check.retries ${check.retries} is not a whole number above 0`);

        const keepalive = tunnel.nat_keepalive;
        if (keepalive !== undefined && !(Number.isInteger(keepalive) && keepalive > 0))
            report(`${where}.nat_keepalive ${keepalive} is not a whole number of seconds above 0`);
    }

    /** This end's certificate with its private key, to sign with, and the CA's without one. */
    private static keys(
        where: string,
        { certificate: own, ca_certificate: ca }: { certificate?: string; ca_certificate?: string },
        certificates: Partial<Record<string, Certificate>>,
        report: Report
    ): void {
        if (own && certificates[own] && !certificates[own].private_key)
            report(`${where}.certificate ${own} has no private key to sign with. Add its private_key`);
        if (ca && certificates[ca]?.private_key)
            report(`${where}.ca_certificate ${ca} has a private key: write the CA's certificate alone, which the device only trusts`);
    }

    /** An integrity algorithm with each `cbc` encryption and none with a `gcm` one, and lifetimes in whole seconds. */
    private static algorithms(where: string, { ike, esp }: { ike: IpsecIke; esp: IpsecEsp }, report: Report): void {
        for (const [sa, algorithms] of [
            ["ike", ike],
            ["esp", esp],
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
    private static authentication(where: string, tunnel: IpsecTunnel, report: Report): void {
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

    /**
     * Each policy-based tunnel of `firewall.ipsec`: a tunnel as `check` says, with endpoints that are addresses, and at least one traffic selector. A selector's prefixes are whole prefixes of one family. No two selectors of the device take the same traffic: the model has no order, so the device could take either tunnel for it.
     */
    static policyBased(device: Device, report: Report): void {
        const taken: { where: string; selector: TrafficSelector }[] = [];

        for (const [name, tunnel] of Object.entries(device.firewall?.ipsec ?? {})) {
            if (!tunnel) continue;
            const where = `firewall.ipsec.${name}`;
            for (const key of ["local_address", "remote_address"] as const)
                if (!Address.isValid(Address.host(tunnel[key]))) report(`${where}.${key}: '${tunnel[key]}' is not an address`);
            IpsecChecks.check(where, tunnel, device.system?.certificates ?? {}, report);

            if (tunnel.traffic_selectors.length === 0)
                report(`${where}.traffic_selectors is empty: write the local_prefix and remote_prefix whose traffic the tunnel carries`);
            tunnel.traffic_selectors.forEach((selector, index) => {
                const at = `${where}.traffic_selectors[${index}]`;
                if (!IpsecChecks.selector(at, selector, report)) return;

                const same = taken.find(({ selector: other }) => IpsecChecks.overlap(selector, other));
                if (same)
                    report(
                        `${at} takes traffic that ${same.where} takes too, from ${selector.local_prefix} to ${selector.remote_prefix}: the device would send it through either. Narrow one of them`
                    );
                taken.push({ where: at, selector });
            });
        }
    }

    /**
     * Each IPsec remote access of `services.ipsec_remote_access`: an address to connect to, and a pool of IPv4 addresses that holds neither it nor another's. IPv4 DNS servers, and traffic selectors of whole IPv4 prefixes, at least one and none inside another, and none that a policy-based tunnel's takes too. Users check with RADIUS or with a CA, one of the two.
     */
    static remoteAccess(device: Device, report: Report, ip: (where: string, value: string) => void): void {
        const certificates = device.system?.certificates ?? {};
        const pools: { where: string; first: bigint; last: bigint }[] = [];

        for (const [name, access] of Object.entries(device.services?.ipsec_remote_access ?? {})) {
            if (!access) continue;
            const where = `services.ipsec_remote_access.${name}`;
            const local = Address.host(access.local_address);
            if (!Address.isValid(local)) report(`${where}.local_address: '${access.local_address}' is not an address`);

            const ipv4 = (at: string, address: string) => {
                const valid = Address.isValid(address) && Address.family(address) === "ipv4";
                if (!valid) report(`${where}.${at}: '${address}' is not an IPv4 address, such as 192.0.2.1`);
                return valid;
            };
            const [first, last] = access.pool;
            if (ipv4("pool", first) && ipv4("pool", last)) {
                const range = { where, first: Address.toNumber(first)!, last: Address.toNumber(last)! };
                if (range.first > range.last) report(`${where}.pool starts at ${first}, after its last address ${last}`);
                const own = Address.toNumber(local);
                if (own !== null && own >= range.first && own <= range.last) report(`${where}.local_address ${local} is in pool`);
                const shared = pools.find((other) => other.first <= range.last && range.first <= other.last);
                if (shared) report(`${where}.pool shares addresses with ${shared.where}.pool: give each its own`);
                pools.push(range);
                IpsecChecks.apartFromTunnels(where, access.traffic_selectors, range, device, report);
            }
            for (const server of access.dns ?? []) ipv4("dns", server);

            if (!access.traffic_selectors.length)
                report(`${where}.traffic_selectors is empty: write the local_prefix of each network clients reach`);
            access.traffic_selectors.forEach(({ local_prefix: prefix }, index) => {
                const at = `${where}.traffic_selectors[${index}].local_prefix`;
                if (!Address.isCidr(prefix) || Address.family(Address.host(prefix)) !== "ipv4")
                    report(`${at}: '${prefix}' is not an IPv4 prefix with its length, such as 198.51.100.0/24`);
                else if (Address.prefixOf(prefix) !== prefix)
                    report(`${at} ${prefix} has bits past its length: write ${Address.prefixOf(prefix)}`);
                else if (access.traffic_selectors.some((other, before) => before < index && Address.contains(other.local_prefix, prefix)))
                    report(`${at} ${prefix} is inside a selector before it: remove it`);
            });

            const radius = access.radius !== undefined;
            const ca = access.ca_certificate !== undefined;
            if (radius === ca)
                report(`${where}: write radius, for users who log in with EAP, or ca_certificate, for users with certificates`);
            if (access.radius && !access.radius.length) report(`${where}.radius is empty: write the RADIUS servers that check users`);
            if (access.radius) ServicesChecks.servers(`${where}.radius`, access.radius, report, ip);
            IpsecChecks.keys(where, access, certificates, report);
            IpsecChecks.algorithms(where, access, report);
        }
    }

    /** No remote access selector takes traffic a policy-based tunnel's takes: a local prefix that shares addresses with the tunnel's, and a pool that does with its remote prefix. */
    private static apartFromTunnels(
        where: string,
        selectors: readonly RemoteAccessSelector[],
        pool: { first: bigint; last: bigint },
        device: Device,
        report: Report
    ): void {
        for (const [name, tunnel] of Object.entries(device.firewall?.ipsec ?? {}))
            for (const selector of tunnel?.traffic_selectors ?? []) {
                if (!Address.isCidr(selector.remote_prefix) || Address.family(Address.host(selector.remote_prefix)) !== "ipv4") continue;
                const remote = Address.range(selector.remote_prefix);
                if (remote.last < pool.first || pool.last < remote.first) continue;
                const local = selectors.find(
                    ({ local_prefix: prefix }) =>
                        Address.isCidr(prefix) &&
                        (Address.contains(prefix, selector.local_prefix) || Address.contains(selector.local_prefix, prefix))
                );
                if (local)
                    report(
                        `${where}: clients from pool reach ${local.local_prefix}, and firewall.ipsec.${name} takes traffic from ${selector.local_prefix} to ${selector.remote_prefix} too. Give the pool addresses outside ${selector.remote_prefix}`
                    );
            }
    }

    /** Whether both prefixes are whole prefixes of one family, after reporting what is not. */
    private static selector(at: string, selector: TrafficSelector, report: Report): boolean {
        let whole = true;
        for (const key of ["local_prefix", "remote_prefix"] as const) {
            const prefix = selector[key];
            if (!Address.isCidr(prefix)) {
                report(`${at}.${key}: '${prefix}' is not a prefix with its length`);
                whole = false;
            } else if (Address.prefixOf(prefix) !== prefix) {
                report(`${at}.${key} ${prefix} has bits past its length: write ${Address.prefixOf(prefix)}`);
                whole = false;
            }
        }
        if (whole && Address.family(Address.host(selector.local_prefix)) !== Address.family(Address.host(selector.remote_prefix))) {
            report(`${at}: local_prefix ${selector.local_prefix} and remote_prefix ${selector.remote_prefix} differ in family`);
            whole = false;
        }
        return whole;
    }

    /** Whether some packet matches both selectors: their local prefixes share addresses, and so do their remote ones. Two prefixes share addresses when one holds the other. */
    private static overlap(one: TrafficSelector, other: TrafficSelector): boolean {
        const share = (a: string, b: string) => Address.contains(a, b) || Address.contains(b, a);
        return share(one.local_prefix, other.local_prefix) && share(one.remote_prefix, other.remote_prefix);
    }
}
