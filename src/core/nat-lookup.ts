// What `circuit nat lookup` answers. It reads only the project, so it is right for a day in the past only if the config was the same then. A dynamic pool's blocks are in the device's log, not the config, so for one it says where to look.

import type { DeterministicPoolNatRule, Device, PortRange, Prefix } from "../model";
import { Address } from "./address";
import { Derive } from "./derive";

/** One subscriber of a pool address, and the ports it leaves with. */
export type NatBlock = { subscriber: string; ports: PortRange };

/** What the config says about one address, on one device. */
export type NatAnswer = {
    device: string;
    to_pool: string;
    /** The subscribers' prefix, `if.src`. */
    src: string;
    port_set_size: number;
    pool_address: string;
    /** The one subscriber, when the address was a subscriber's, or the port was given. */
    subscriber?: string;
    /** The one subscriber's ports. */
    ports?: PortRange;
    /** Every subscriber that shares the pool address, when asked for the address alone. */
    subscribers?: NatBlock[];
};

export type NatFound = {
    answers: NatAnswer[];
    /** Why an address a pool holds still has no subscriber, such as a port below 1024. */
    notes: string[];
    /** Every pool of the project, to say what exists when nothing matched. */
    pools: string[];
};

type Mapping = { device: string; rule: DeterministicPoolNatRule; src: Prefix };

export class NatLookup {
    /** How many subscribers of one pool address the text lists. */
    private static readonly LISTED = 64;

    /** Deterministic pool rules `validate` accepts: IPv4 prefixes, a pool no larger than the subscribers, and blocks that fit. One for each distinct pool, since an interface set makes a rule per interface. */
    private static mappings(devices: readonly Device[]): Mapping[] {
        const available = Derive.POOL_PORTS.max - Derive.POOL_PORTS.min + 1;
        const found = new Map<string, Mapping>();

        for (const device of devices) {
            for (const rule of device.firewall?.nat?.source ?? []) {
                if (!("to_pool" in rule) || rule.port_allocation !== "deterministic") continue;

                const src = [rule.if?.src].flat()[0];
                if (!src || !Address.isCidr(src) || !Address.isCidr(rule.to_pool)) continue;
                if (Address.family(src) !== "ipv4" || Address.family(rule.to_pool) !== "ipv4") continue;

                const perAddress = Derive.subscribersPerAddress(src, rule.to_pool);
                if (!perAddress || perAddress * rule.port_set_size > available) continue;

                found.set(`${device.name} ${rule.to_pool} ${src} ${rule.port_set_size}`, {
                    device: device.name,
                    rule,
                    src: Address.prefixOf(src),
                });
            }
        }

        return [...found.values()];
    }

    private static ports(size: number, offset: number): PortRange {
        const min = Derive.POOL_PORTS.min + offset * size;
        return { min, max: min + size - 1 };
    }

    /** The mapping of one subscriber: RFC 7422's sequential one, as `Derive.poolAddresses` lists it. */
    private static block(mapping: Mapping, subscriber: bigint): NatBlock & { pool_address: string } {
        const { rule, src } = mapping;
        const perAddress = BigInt(Derive.subscribersPerAddress(src, rule.to_pool));
        const index = subscriber - Address.range(src).first;

        return {
            pool_address: Address.fromNumber(Address.range(rule.to_pool).first + index / perAddress, "ipv4"),
            subscriber: Address.fromNumber(subscriber, "ipv4"),
            ports: NatLookup.ports(rule.port_set_size, Number(index % perAddress)),
        };
    }

    /** `1024-3039`. */
    static range(ports: PortRange): string {
        return `${ports.min}-${ports.max}`;
    }

    /** The answers as lines. A pool address alone lists its subscribers, the first `listed` of them. */
    static text(answers: readonly NatAnswer[], address: string, port: number | undefined, listed = NatLookup.LISTED): string {
        const lines: string[] = [];

        for (const answer of answers) {
            const pool = `to_pool ${answer.to_pool}`;

            if (answer.subscribers) {
                const shown = answer.subscribers.slice(0, listed);
                const more = answer.subscribers.length - shown.length;
                lines.push(
                    `${answer.device}: ${address} is shared by ${answer.subscribers.length} subscribers (${pool}, port_set_size ${answer.port_set_size})`
                );
                for (const each of shown) lines.push(`    ${each.subscriber}  ports ${NatLookup.range(each.ports)}`);
                if (more > 0) lines.push(`    and ${more} more. Give a port to find one, or use --format json for all.`);
            } else if (port !== undefined && answer.subscriber && answer.ports) {
                lines.push(
                    `${answer.device}: ${answer.pool_address}:${port} is ${answer.subscriber} (${pool}, ports ${NatLookup.range(answer.ports)})`
                );
            } else if (answer.ports) {
                lines.push(
                    `${answer.device}: ${address} leaves as ${answer.pool_address}, ports ${NatLookup.range(answer.ports)} (${pool})`
                );
            }
        }

        return `${lines.join("\n")}\n`;
    }

    /** Dynamic pools that hold `address`: the config can't say who had it, only the device's log of its blocks can. */
    private static dynamic(devices: readonly Device[], address: string): { notes: string[]; pools: string[] } {
        const notes: string[] = [];
        const pools: string[] = [];

        for (const device of devices) {
            for (const rule of device.firewall?.nat?.source ?? []) {
                if (!("to_pool" in rule) || rule.port_allocation !== "dynamic" || !Address.isCidr(rule.to_pool)) continue;

                const pool = `${device.name}: to_pool ${rule.to_pool}, dynamic`;
                if (!pools.includes(pool)) pools.push(pool);
                if (!Address.contains(rule.to_pool, address)) continue;

                const note = `${device.name}: ${address} is in to_pool ${rule.to_pool}, which gives blocks of ports as subscribers need them, so the config can't say who had it. Find the address and port in the device's log of the blocks it gave, at the time of the report.`;
                if (!notes.includes(note)) notes.push(note);
            }
        }

        return { notes, pools };
    }

    /** Where `address` is in the pools: as a subscriber, or as a pool address, with or without a port. */
    static find(devices: readonly Device[], address: string, port?: number): NatFound {
        const mappings = NatLookup.mappings(devices);
        const dynamic = NatLookup.dynamic(devices, address);
        const answers: NatAnswer[] = [];
        const notes: string[] = [...dynamic.notes];
        const value = Address.toNumber(address) ?? 0n;

        for (const mapping of mappings) {
            const { device, rule, src } = mapping;
            const base = { device, to_pool: rule.to_pool, src, port_set_size: rule.port_set_size };

            if (Address.contains(src, address)) {
                if (port !== undefined) {
                    notes.push(`${device}: ${address} is a subscriber of ${src}, not a pool address. Leave the port out.`);
                    continue;
                }

                const one = NatLookup.block(mapping, value);
                answers.push({ ...base, pool_address: one.pool_address, subscriber: one.subscriber, ports: one.ports });
                continue;
            }

            if (!Address.contains(rule.to_pool, address)) continue;

            const perAddress = Derive.subscribersPerAddress(src, rule.to_pool);
            const first = Address.range(src).first + (value - Address.range(rule.to_pool).first) * BigInt(perAddress);

            if (port === undefined) {
                const subscribers = Array.from({ length: perAddress }, (_, offset) => NatLookup.block(mapping, first + BigInt(offset)));
                answers.push({
                    ...base,
                    pool_address: address,
                    subscribers: subscribers.map(({ subscriber, ports }) => ({ subscriber, ports })),
                });
                continue;
            }

            const where = `${device}: ${address} is in to_pool ${rule.to_pool}, but port ${port}`;
            const last = NatLookup.ports(rule.port_set_size, perAddress - 1).max;
            const blocks = `The blocks run from ${Derive.POOL_PORTS.min} to ${last}.`;

            if (port < Derive.POOL_PORTS.min) {
                notes.push(`${where} is below ${Derive.POOL_PORTS.min}, so no block holds it. ${blocks}`);
                continue;
            }
            if (port > last) {
                notes.push(`${where} is past the last block. ${blocks}`);
                continue;
            }

            const offset = Math.floor((port - Derive.POOL_PORTS.min) / rule.port_set_size);
            const one = NatLookup.block(mapping, first + BigInt(offset));
            answers.push({ ...base, pool_address: address, subscriber: one.subscriber, ports: one.ports });
        }

        const pools = [
            ...new Set(mappings.map(({ device, rule, src }) => `${device}: to_pool ${rule.to_pool} for ${src}`)),
            ...dynamic.pools,
        ];
        return { answers, notes, pools };
    }
}
