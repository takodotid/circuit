import { Address } from "../core/address";
import type { Device } from "../model";

type Report = (message: string) => void;

/** NAT64 rules (RFC 6146) and DNS64 (RFC 6147): each translates IPv6 hosts to IPv4, through a NAT64 prefix RFC 6052 allows. */
export class Nat64Checks {
    /** The lengths a NAT64 prefix may have (RFC 6052 §2.2). */
    private static readonly PREFIX_LENGTHS: readonly string[] = ["32", "40", "48", "56", "64", "96"];

    /** Bits 64 to 71 of an address in a NAT64 prefix are zero (RFC 6052 §2.2). A /96 holds them, so they are zero in the prefix too. */
    private static readonly ZERO_BITS = { first: 64, count: 8 } as const;

    /** An example of a NAT64 prefix in a message. */
    private static readonly WELL_KNOWN = "64:ff9b::/96";

    static check(device: Device, report: Report): void {
        const nat = device.firewall?.nat;

        (nat?.destination ?? []).forEach((rule, index) => {
            if (rule.then === "nat64")
                report(`firewall.nat.destination[${index}]: nat64 translates the source too. Move the rule to firewall.nat.source.`);
        });

        (nat?.source ?? []).forEach((rule, index) => {
            if (rule.then !== "nat64") return;

            const where = `firewall.nat.source[${index}]${rule.description ? ` (${rule.description})` : ""}`;
            const match = rule.if;
            const dst = [match?.dst].flat().filter((one) => one !== undefined);

            if (match?.dst_address_set !== undefined)
                report(
                    `${where}: nat64 takes its NAT64 prefix from if.dst. Write it there, such as ${Nat64Checks.WELL_KNOWN}, not in dst_address_set.`
                );
            if (dst.length !== 1) report(`${where}: write one NAT64 prefix in if.dst, such as ${Nat64Checks.WELL_KNOWN}.`);
            else Nat64Checks.prefix(`${where}: if.dst`, dst[0]!, report);

            if (match?.family === "ipv4") report(`${where}: nat64 translates IPv6 packets. Write family: "ipv6", or leave it out.`);
            for (const src of [match?.src].flat())
                if (src && Address.isCidr(src) && Address.family(src) === "ipv4")
                    report(`${where}: if.src ${src} is IPv4, and nat64 translates packets from IPv6 hosts. Write their IPv6 prefix.`);
        });

        const dns64 = device.services?.dns64;
        if (!dns64) return;

        if (!device.services?.dns_server)
            report("services.dns64 answers as the device's DNS server, which is off. Write services.dns_server: true beside it.");
        Nat64Checks.prefix("services.dns64: prefix", dns64.prefix, report);
    }

    /** A NAT64 prefix: IPv6, of a length RFC 6052 allows, with no bits past its length, and none of the bits it must leave zero. */
    private static prefix(where: string, prefix: string, report: Report): void {
        if (!Address.isCidr(prefix) || Address.family(prefix) !== "ipv6") {
            report(`${where} ${prefix} is not an IPv6 prefix. Write the NAT64 prefix, such as ${Nat64Checks.WELL_KNOWN}.`);
            return;
        }

        const { addr, len } = Address.split(prefix);
        if (!Nat64Checks.PREFIX_LENGTHS.includes(String(len))) {
            report(
                `${where} ${prefix}: a NAT64 prefix is a /${Nat64Checks.PREFIX_LENGTHS.join(", /")} (RFC 6052). Write one of those lengths.`
            );
            return;
        }
        if (Address.prefixOf(prefix) !== Address.canonical(prefix)) {
            report(`${where} ${prefix} has bits past its length. Write ${Address.prefixOf(prefix)}.`);
            return;
        }

        const { first, count } = Nat64Checks.ZERO_BITS;
        const shift = BigInt(Address.bits("ipv6") - first - count);
        const reserved = (Address.toNumber(addr)! >> shift) & ((1n << BigInt(count)) - 1n);
        if (len > first && reserved !== 0n)
            report(
                `${where} ${prefix}: bits ${first} to ${first + count - 1} of a NAT64 prefix are zero (RFC 6052 §2.2). Write a prefix with them zero.`
            );
    }
}
