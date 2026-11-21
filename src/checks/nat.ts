import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, NatRule, PoolNatRule } from "../model";

type Report = (message: string) => void;

/** One pool rule `validate` takes, with what tells it apart from another rule on the same pool. */
type Mapping = { rule: PoolNatRule; label: string; key: string };

/** NAT pools: deterministic ones, which RFC 7422 maps, and dynamic ones, which hand out blocks of ports. */
export class NatChecks {
    private static readonly ALLOCATIONS: readonly string[] = ["deterministic", "dynamic"] satisfies PoolNatRule["port_allocation"][];

    /**
     * A pool is a clean IPv4 prefix, and each subscriber's ports fit from port 1024. A deterministic pool maps each subscriber of `if.src` to a pool address and a block (RFC 7422), so `if.src` is a clean IPv4 prefix no smaller than the pool. Two pools that share an address would give two subscribers the same ports, unless they are one pool.
     */
    static check(device: Device, report: Report): void {
        const nat = device.firewall?.nat;
        const named = (rule: PoolNatRule) => `to_pool ${rule.to_pool}${rule.description ? ` (${rule.description})` : ""}`;
        const isPool = (rule: NatRule): rule is PoolNatRule => "to_pool" in rule;

        for (const rule of (nat?.destination ?? []).filter(isPool))
            report(`firewall.nat.destination, ${named(rule)}: a pool translates the source. Move the rule to firewall.nat.source.`);

        const valid: Mapping[] = [];

        for (const rule of (nat?.source ?? []).filter(isPool)) {
            const where = `firewall.nat.source, ${named(rule)}`;
            if (!NatChecks.ALLOCATIONS.includes(rule.port_allocation)) {
                report(`${where}: write port_allocation: "deterministic" or "dynamic", how each subscriber gets its ports`);
                continue;
            }
            const mapping =
                rule.port_allocation === "dynamic" ? NatChecks.dynamic(rule, where, report) : NatChecks.deterministic(rule, where, report);
            if (mapping) valid.push(mapping);
        }

        // Each interface of a set makes a rule of its own, with the same pool and ports.
        const mappings = [...new Map(valid.map((one) => [one.key, one])).values()];
        mappings.forEach((a, index) => {
            for (const b of mappings.slice(index + 1)) {
                if (!Address.contains(a.rule.to_pool, b.rule.to_pool) && !Address.contains(b.rule.to_pool, a.rule.to_pool)) continue;

                const fix =
                    a.rule.port_allocation === "dynamic" && b.rule.port_allocation === "dynamic" && a.rule.to_pool === b.rule.to_pool
                        ? "Write the same port_set_size, port_sets_per_subscriber, and port_set_timeout in both, or give each its own pool addresses."
                        : "Give each its own pool addresses.";
                report(
                    `firewall.nat.source: ${a.label} and ${b.label} share addresses, so two subscribers would get the same ports. ${fix}`
                );
            }
        });
    }

    /** A prefix with no bits past its length, and IPv4, as a pool and its subscribers must be. */
    private static clean(where: string, field: string, prefix: string, report: Report): boolean {
        if (!Address.isCidr(prefix) || Address.family(prefix) !== "ipv4") {
            report(`${where}: ${field} ${prefix} is not an IPv4 prefix`);
            return false;
        }
        if (Address.prefixOf(prefix) === prefix) return true;

        report(`${where}: ${field} ${prefix} has bits past its length: write ${Address.prefixOf(prefix)}`);
        return false;
    }

    /** Whether `value` is a whole number from `min` to `max`, and says so when it is not. */
    private static whole(where: string, field: string, value: number, max: number, report: Report): boolean {
        if (Number.isInteger(value) && value >= 1 && value <= max) return true;

        report(`${where}: ${field} ${value} is not a whole number from 1 to ${max}`);
        return false;
    }

    private static deterministic(rule: PoolNatRule, where: string, report: Report): Mapping | undefined {
        const available = Derive.POOL_PORTS.max - Derive.POOL_PORTS.min + 1;
        const src = [rule.if?.src].flat()[0];

        if (rule.port_sets_per_subscriber !== undefined)
            report(`${where}: a deterministic pool gives each subscriber one block. Remove port_sets_per_subscriber.`);
        if (rule.port_set_timeout !== undefined)
            report(`${where}: a deterministic pool keeps each subscriber's block for good. Remove port_set_timeout.`);
        if (!src) {
            report(`${where}: write the subscribers' IPv4 prefix in if.src`);
            return undefined;
        }
        const clean = [NatChecks.clean(where, "to_pool", rule.to_pool, report), NatChecks.clean(where, "if.src", src, report)];
        if (!clean.every(Boolean)) return undefined;

        const size = rule.port_set_size;
        if (!NatChecks.whole(where, "port_set_size", size, available, report)) return undefined;

        const perAddress = Derive.subscribersPerAddress(src, rule.to_pool);
        if (!perAddress) {
            const length = Address.split(src).len;
            report(`${where}: the pool has more addresses than if.src ${src} has subscribers. Write a to_pool of /${length} or longer.`);
            return undefined;
        }

        if (perAddress * size > available) {
            const fits = 2 ** Math.floor(Math.log2(Math.floor(available / size)));
            const pool = `a to_pool of /${Address.split(src).len + Math.log2(fits)} or shorter`;
            report(
                `${where}: ${perAddress} subscribers on each pool address take ${perAddress} × ${size} = ${perAddress * size} ports, more than the ${available} from ${Derive.POOL_PORTS.min} to ${Derive.POOL_PORTS.max}. Write port_set_size: ${Math.floor(available / perAddress)} or less, or ${pool}.`
            );
            return undefined;
        }

        return { rule, label: `to_pool ${rule.to_pool} for ${src}`, key: `${rule.to_pool} ${src} ${size}` };
    }

    /** A dynamic pool: its subscribers come and go, so only one subscriber's blocks must fit on a pool address. */
    private static dynamic(rule: PoolNatRule, where: string, report: Report): Mapping | undefined {
        const available = Derive.POOL_PORTS.max - Derive.POOL_PORTS.min + 1;
        const size = rule.port_set_size;
        const sets = rule.port_sets_per_subscriber;
        const timeout = rule.port_set_timeout;

        if (!NatChecks.clean(where, "to_pool", rule.to_pool, report)) return undefined;
        if (timeout !== undefined && !(Number.isInteger(timeout) && timeout > 0)) {
            report(`${where}: port_set_timeout ${timeout} is not a whole number of seconds above 0`);
            return undefined;
        }
        if (sets === undefined) {
            report(`${where}: write port_sets_per_subscriber, the most blocks one subscriber holds at once`);
            return undefined;
        }
        const whole = [
            NatChecks.whole(where, "port_set_size", size, available, report),
            NatChecks.whole(where, "port_sets_per_subscriber", sets, available, report),
        ];
        if (!whole.every(Boolean)) return undefined;

        if (size * sets > available) {
            report(
                `${where}: one subscriber's ${sets} blocks of ${size} ports take ${size * sets} ports, more than the ${available} from ${Derive.POOL_PORTS.min} to ${Derive.POOL_PORTS.max} on its pool address. Write port_sets_per_subscriber: ${Math.floor(available / size)} or less.`
            );
            return undefined;
        }

        return {
            rule,
            label: `to_pool ${rule.to_pool}, dynamic, ${sets} × ${size} ports${timeout === undefined ? "" : `, port_set_timeout ${timeout}`}`,
            key: `${rule.to_pool} dynamic ${size} ${sets} ${timeout}`,
        };
    }
}
