// What a VRP plan removes only after the steps that let go of it: the switch refuses each while something still uses it. What a CE6855 on V200R005C00SPC800 refused is in TRAPS.md.

import type { Group } from "../line-diff";
import type { Step } from "../platform";

/** Removals of one kind, taken out of the top level into a step of their own. */
type Kind = { title: string; takes: RegExp };

export class VrpRemovals {
    /** What goes after the ports and interfaces. A LAG goes once its members have left it: before, "the trunk has member interfaces". An ACL goes once no service is bound to it, and a DHCPv6 pool once its VLAN interface lets go of it. */
    private static readonly AFTER_INTERFACES: readonly Kind[] = [
        { title: "LAGs no longer used", takes: /^interface Eth-Trunk\d+$/ },
        { title: "ACLs no longer used", takes: /^acl (number \d+|(ipv6 )?name \S+ advance)$/ },
        { title: "DHCPv6 pools no longer used", takes: /^dhcpv6 pool / },
    ];

    /** What goes after MPLS: a loopback, whose address may be the LSR ID. Before, "Cannot delete this interface because the primary IP address of this interface is used as MPLS LSR ID". */
    private static readonly AFTER_MPLS: readonly Kind[] = [{ title: "Loopbacks no longer used", takes: /^interface LoopBack\d+$/ }];

    /** The steps that remove each kind, taken out of the top level: those that go after the ports and interfaces, and those that go after MPLS. */
    static taken(top: Group | undefined, undo: (line: string) => string): { afterInterfaces: Step[]; afterMpls: Step[] } {
        const take = (kinds: readonly Kind[]): Step[] =>
            kinds.flatMap(({ title, takes }) => {
                const gone = top?.remove.filter((line) => takes.test(line)) ?? [];
                if (top) top.remove = top.remove.filter((line) => !takes.test(line));
                return gone.length ? [{ title, show: gone.map((line) => `- ${line}`), send: gone.map((line) => undo(line)) }] : [];
            });

        return { afterInterfaces: take(VrpRemovals.AFTER_INTERFACES), afterMpls: take(VrpRemovals.AFTER_MPLS) };
    }
}
