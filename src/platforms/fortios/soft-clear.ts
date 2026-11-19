// After a route map, or a list it uses, changes, a FortiGate keeps what it decided on the routes it holds until a soft clear (TRAPS.md). The session stays up: the device asks the neighbor to send its routes again (RFC 2918), or sends its own again.

import type { Step } from "../platform";
import type { FortiOsNode } from "./tree";
import { FortiOsTree } from "./tree";

/** Whether the plan changes the entry of a section with this name. */
type Changed = (section: string, name: string) => boolean;

export class FortiOsSoftClear {
    /** The settings of a route map's rule that name a list, and the list's section. */
    private static readonly MAP_LISTS: Record<string, string> = {
        "match-ip-address": "router prefix-list",
        "match-ip6-address": "router prefix-list6",
        "match-as-path": "router aspath-list",
        "match-community": "router community-list",
        "set-community-delete": "router community-list",
    };

    /** A neighbor's route maps, by the direction of a soft clear. */
    private static readonly NEIGHBOR_MAPS = { in: ["route-map-in", "route-map-in6"], out: ["route-map-out", "route-map-out6"] } as const;

    /** What a neighbor's policy is called in the config, by the direction of a soft clear. */
    private static readonly POLICY_OF = { in: "import", out: "export" } as const;

    /** A soft clear of each neighbor whose route map changes, or a list its route map uses, in the direction that changes. It goes last, after every change. A new neighbor needs none. */
    static steps(want: FortiOsNode, have: FortiOsNode, changed: Changed): Step[] {
        const show: string[] = [];
        const send: string[] = [];
        const held = have.blocks.get("router bgp")?.blocks.get("neighbor")?.entries;

        for (const [address, { block }] of want.blocks.get("router bgp")?.blocks.get("neighbor")?.entries ?? []) {
            const before = held?.get(address)?.block;
            if (!before) continue;

            for (const direction of ["in", "out"] as const) {
                const clears = FortiOsSoftClear.NEIGHBOR_MAPS[direction].some((key) => {
                    const map = block.settings.get(key);
                    const old = before.settings.get(key);
                    if (map === undefined) return false;

                    const name = FortiOsTree.bare(map);
                    return old === undefined || FortiOsTree.bare(old) !== name || FortiOsSoftClear.mapChanged(want, name, changed);
                });
                if (!clears) continue;

                show.push(
                    `~ neighbor ${address}: soft clear ${direction}, for its changed ${FortiOsSoftClear.POLICY_OF[direction]} policy`
                );
                send.push(`execute router clear bgp ${address.includes(":") ? "ipv6" : "ip"} ${address} soft ${direction}`);
            }
        }

        return send.length ? [{ title: "router bgp, soft clear", show, send }] : [];
    }

    /** Whether a route map changes, or a list one of its rules names. */
    private static mapChanged(want: FortiOsNode, name: string, changed: Changed): boolean {
        if (changed("router route-map", name)) return true;

        const rules = want.blocks.get("router route-map")?.entries.get(name)?.block.blocks.get("rule")?.entries.values() ?? [];
        return [...rules].some(({ block }) =>
            Object.entries(FortiOsSoftClear.MAP_LISTS).some(([key, section]) => {
                const list = block.settings.get(key);
                return list !== undefined && changed(section, FortiOsTree.bare(list));
            })
        );
    }
}
