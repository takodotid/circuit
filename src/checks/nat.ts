import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, NatRule, PoolNatRule } from "../model";

type Report = (message: string) => void;

/** NAT pools, which RFC 7422 maps. */
export class NatChecks {
    /**
     * A pool maps each subscriber of `if.src` to a pool address and a block of ports (RFC 7422). So both are clean IPv4 prefixes, the pool is no larger than the subscribers, and each address's blocks fit from port 1024. Two pools that share an address would give two subscribers the same ports, unless they map alike.
     */
    static check(device: Device, report: Report): void {
        const nat = device.firewall?.nat;
        const named = (rule: PoolNatRule) => `to_pool ${rule.to_pool}${rule.description ? ` (${rule.description})` : ""}`;
        const isPool = (rule: NatRule): rule is PoolNatRule => "to_pool" in rule;

        for (const rule of (nat?.destination ?? []).filter(isPool))
            report(`firewall.nat.destination, ${named(rule)}: a pool translates the source. Move the rule to firewall.nat.source.`);

        const pools = (nat?.source ?? []).filter(isPool);
        const valid: { rule: PoolNatRule; src: string }[] = [];
        const available = Derive.POOL_PORTS.max - Derive.POOL_PORTS.min + 1;

        for (const rule of pools) {
            const where = `firewall.nat.source, ${named(rule)}`;
            const src = [rule.if?.src].flat()[0];
            const clean = (field: string, prefix: string): boolean => {
                if (!Address.isCidr(prefix) || Address.family(prefix) !== "ipv4") {
                    report(`${where}: ${field} ${prefix} is not an IPv4 prefix`);
                    return false;
                }
                if (Address.prefixOf(prefix) === prefix) return true;

                report(`${where}: ${field} ${prefix} has bits past its length: write ${Address.prefixOf(prefix)}`);
                return false;
            };

            if (!src) {
                report(`${where}: write the subscribers' IPv4 prefix in if.src`);
                continue;
            }
            if (![clean("to_pool", rule.to_pool), clean("if.src", src)].every(Boolean)) continue;

            const size = rule.port_set_size;
            if (!Number.isInteger(size) || size < 1 || size > available) {
                report(`${where}: port_set_size ${size} is not a whole number from 1 to ${available}`);
                continue;
            }

            const perAddress = Derive.subscribersPerAddress(src, rule.to_pool);
            if (!perAddress) {
                const length = Address.split(src).len;
                report(
                    `${where}: the pool has more addresses than if.src ${src} has subscribers. Write a to_pool of /${length} or longer.`
                );
                continue;
            }

            if (perAddress * size > available) {
                const fits = 2 ** Math.floor(Math.log2(Math.floor(available / size)));
                const pool = `a to_pool of /${Address.split(src).len + Math.log2(fits)} or shorter`;
                report(
                    `${where}: ${perAddress} subscribers on each pool address take ${perAddress} × ${size} = ${perAddress * size} ports, more than the ${available} from ${Derive.POOL_PORTS.min} to ${Derive.POOL_PORTS.max}. Write port_set_size: ${Math.floor(available / perAddress)} or less, or ${pool}.`
                );
                continue;
            }

            valid.push({ rule, src });
        }

        // Each interface of a set makes a rule of its own, with the same pool, subscribers, and blocks.
        const mappings = [...new Map(valid.map((one) => [`${one.rule.to_pool} ${one.src} ${one.rule.port_set_size}`, one])).values()];
        mappings.forEach((a, index) => {
            for (const b of mappings.slice(index + 1)) {
                if (!Address.contains(a.rule.to_pool, b.rule.to_pool) && !Address.contains(b.rule.to_pool, a.rule.to_pool)) continue;

                report(
                    `firewall.nat.source: to_pool ${a.rule.to_pool} for ${a.src} and to_pool ${b.rule.to_pool} for ${b.src} share addresses, so two subscribers would get the same ports. Give each its own pool addresses.`
                );
            }
        });
    }
}
