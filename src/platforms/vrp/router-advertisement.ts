// IPv6 router advertisements on a VRP VLAN interface (RFC 4861). A CE6855 on V200R005C00SPC800 committed them on a VLAN interface with no ports (TRAPS.md).

import { Derive } from "../../core/derive";
import type { Device, VlanInterface } from "../../model";
import { VrpPolicies } from "./policies";

export class VrpRouterAdvertisement {
    /** The most seconds between two advertisements when the config sets none. It is not printed. */
    private static readonly INTERVAL_DEFAULT = 600;

    /** A line the switch undoes by its keyword alone, or a prefix by its prefix alone. */
    private static readonly UNDONE_BY = /^(ipv6 nd ra (?:Max-interval|router-lifetime)|ipv6 nd ra prefix [0-9A-F:]+\/\d+) /;

    /**
     * The interface's advertisements, as the switch prints them. It announces each IPv6 network of the interface unless told `prefix default no-advertise`, so listed prefixes come with that line. `Max-interval` prints with a capital. The least interval is the switch's own, a third of the most.
     */
    static lines(settings: VlanInterface): string[] {
        const ra = Derive.routerAdvertisement(settings);
        if (!ra) return [];

        const lines = ra.prefixes ? ["ipv6 nd ra prefix default no-advertise"] : [];
        for (const prefix of ra.prefixes ?? []) {
            const autoconfig = prefix.disable_autoconfiguration ? " no-autoconfig" : "";
            lines.push(
                `ipv6 nd ra prefix ${VrpPolicies.spell(prefix.prefix)} ${prefix.valid_lifetime} ${prefix.preferred_lifetime}${autoconfig}`
            );
        }

        if (ra.interval !== undefined && ra.interval !== VrpRouterAdvertisement.INTERVAL_DEFAULT)
            lines.push(`ipv6 nd ra Max-interval ${ra.interval}`);
        if (ra.lifetime !== undefined) lines.push(`ipv6 nd ra router-lifetime ${ra.lifetime}`);
        lines.push("ipv6 nd ra halt disable");
        if (ra.managed) lines.push("ipv6 nd autoconfig managed-address-flag");
        if (ra.other_config) lines.push("ipv6 nd autoconfig other-flag");

        return lines;
    }

    /** What the switch can't announce: RAs anywhere but on a VLAN interface, DNS servers and search domains, and a prefix without both lifetimes. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const { name, kind, settings } of Derive.interfaces(device)) {
            const ra = Derive.routerAdvertisement(settings);
            if (!ra) continue;

            const where = `interfaces.${kind}.${name}.ipv6_ra`;
            if (kind !== "vlan_interface") {
                found.push(`${where}, on a VLAN interface only`);
                continue;
            }

            // A CE6855 on V200R005 refused `ipv6 nd ra dns-server` and `ipv6 nd ra dns-suffix` with `Unrecognized command`.
            if (ra.dns_servers) found.push(`${where}.dns_servers, V200R005 announces no DNS servers (RDNSS)`);
            if (ra.dns_search_list) found.push(`${where}.dns_search_list, V200R005 announces no search domains (DNSSL)`);
            (ra.prefixes ?? []).forEach((prefix, index) => {
                if (prefix.valid_lifetime === undefined || prefix.preferred_lifetime === undefined)
                    found.push(
                        `${where}.prefixes[${index}], the platform announces a prefix with both lifetimes: write valid_lifetime and preferred_lifetime`
                    );
            });
        }

        return found;
    }

    /** `undo ipv6 nd ra Max-interval`, and a prefix by its prefix alone. Undefined for a line the switch undoes whole. */
    static undo(line: string): string | undefined {
        const keyword = VrpRouterAdvertisement.UNDONE_BY.exec(line);
        return keyword ? `undo ${keyword[1]}` : undefined;
    }
}
