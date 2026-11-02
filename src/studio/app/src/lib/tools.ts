// What Studio's tools work out from the project: where an address is and how each device would reach it, and the cables that carry a VLAN from one device to another. They say what the project means, not what a device did: a route learned from BGP or OSPF is not in the project.

import type { Device } from "../../../../model";
import type { StudioData } from "../../../types";
import { Net } from "./net";

/** How one device would reach an address, in one routing table. */
export type RouteFound = {
    device: string;
    table: string;
    kind: "local" | "connected" | "static" | "none";
    prefix?: string;
    via?: string;
    through?: string;
    note?: string;
};

/** A rule that names the address. */
export type RuleFound = { device: string; where: string; rule: number; description?: string; then: string; side: string };

export type Trace = {
    held: { device: string; holder: string; address: string }[];
    routes: RouteFound[];
    rules: RuleFound[];
};

export class Tools {
    /** The addresses on a device's ports and interfaces, with the VRF each routes in. */
    private static addressesOf(device: Device): { holder: string; address: string; peer?: string; vrf?: string }[] {
        const groups = Object.values(device.interfaces ?? {}) as (
            Record<string, { addresses?: readonly unknown[]; vrf?: string } | undefined> | undefined
        )[];

        return groups.flatMap((group) =>
            Object.entries(group ?? {}).flatMap(([holder, settings]) =>
                (settings?.addresses ?? []).map((entry) =>
                    typeof entry === "string"
                        ? { holder, address: entry, ...(settings?.vrf ? { vrf: settings.vrf } : {}) }
                        : {
                              holder,
                              address: (entry as { address: string }).address,
                              peer: (entry as { peer_address: string }).peer_address,
                              ...(settings?.vrf ? { vrf: settings.vrf } : {}),
                          }
                )
            )
        );
    }

    /** Where an address is, how each device would reach it from what the project says, and every rule that names it. Undefined when the text is not one address. */
    static trace(data: StudioData, text: string): Trace | undefined {
        const target = Net.parseRange(text.trim());
        if (!target || target.first !== target.last) return undefined;
        const address = text.trim();

        const held = data.devices.flatMap((device) =>
            Tools.addressesOf(device)
                .filter((entry) => Net.sameAddress(entry.address, address))
                .map((entry) => ({ device: device.name, holder: entry.holder, address: entry.address }))
        );

        const routes: RouteFound[] = [];

        for (const device of data.devices) {
            // The longest prefix wins in each table; on a tie, the device's own address, then a connected one, then a static route by its distance.
            const best = new Map<string, RouteFound & { length: number; rank: number }>();
            const offer = (found: RouteFound & { length: number; rank: number }) => {
                const current = best.get(found.table);
                if (!current || found.length > current.length || (found.length === current.length && found.rank < current.rank))
                    best.set(found.table, found);
            };

            for (const entry of Tools.addressesOf(device)) {
                const table = entry.vrf ? `VRF ${entry.vrf}` : "main";

                if (Net.sameAddress(entry.address, address)) {
                    offer({
                        device: device.name,
                        table,
                        kind: "local",
                        prefix: entry.address,
                        through: entry.holder,
                        length: 129,
                        rank: 0,
                    });
                } else if (entry.peer && Net.sameAddress(entry.peer, address)) {
                    offer({
                        device: device.name,
                        table,
                        kind: "connected",
                        prefix: `${entry.peer}, the far end of ${entry.address}`,
                        through: entry.holder,
                        length: 128,
                        rank: 1,
                    });
                } else if (!entry.peer && Net.covers(entry.address, address)) {
                    offer({
                        device: device.name,
                        table,
                        kind: "connected",
                        prefix: entry.address,
                        through: entry.holder,
                        length: Net.lengthOf(entry.address),
                        rank: 1,
                    });
                }
            }

            for (const route of device.routing?.static_routes ?? []) {
                if (!Net.covers(route.prefix, address)) continue;

                const table = route.vrf ? `VRF ${route.vrf}` : (route.routing_table ?? "main");
                offer({
                    device: device.name,
                    table,
                    kind: "static",
                    prefix: route.prefix,
                    ...(route.next_hop ? { via: route.next_hop } : {}),
                    ...(route.interface ? { through: route.interface } : {}),
                    ...(route.blackhole ? { note: "dropped: a blackhole route" } : route.description ? { note: route.description } : {}),
                    length: Net.lengthOf(route.prefix),
                    rank: 2 + (route.distance ?? 1),
                });
            }

            if (!best.size) routes.push({ device: device.name, table: "main", kind: "none" });
            for (const { length: _length, rank: _rank, ...found } of best.values()) routes.push(found);
        }

        const rules: RuleFound[] = [];

        for (const device of data.devices) {
            const sets = (device.firewall?.address_sets ?? {}) as Record<string, readonly string[] | undefined>;
            const inSet = (name: unknown) => typeof name === "string" && (sets[name] ?? []).some((entry) => Net.covers(entry, address));
            const covers = (value: unknown) =>
                (Array.isArray(value) ? value : [value]).some((entry) => typeof entry === "string" && Net.covers(entry, address));

            const look = (
                where: string,
                list: readonly { description?: string; if?: Record<string, unknown>; then: string }[] | undefined
            ) => {
                for (const [index, rule] of (list ?? []).entries()) {
                    const match = rule.if ?? {};
                    const sides = [
                        covers(match.src) || inSet(match.src_address_set) ? "source" : "",
                        covers(match.dst) || inSet(match.dst_address_set) ? "destination" : "",
                    ].filter(Boolean);
                    if (!sides.length) continue;

                    rules.push({
                        device: device.name,
                        where,
                        rule: index + 1,
                        then: rule.then,
                        side: sides.join(" and "),
                        ...(rule.description ? { description: rule.description } : {}),
                    });
                }
            };

            for (const chain of ["input", "forward", "output"] as const) look(`filter ${chain}`, device.firewall?.filter?.[chain]?.rules);
            look("NAT source", device.firewall?.nat?.source);
            look("NAT destination", device.firewall?.nat?.destination);
            for (const [name, acl] of Object.entries(device.switching?.acls ?? {})) look(`ACL ${name}`, acl as never);
        }

        return { held, routes, rules };
    }

    /** Whether a port, or the LAG it is in, carries a VLAN. */
    private static carries(device: Device | undefined, portName: string, vlan: string): boolean {
        const port = device?.interfaces?.ethernet?.[portName];
        if (!port || !device) return false;

        const carrier = port.in_lag ? device.interfaces?.lag?.[port.in_lag] : port;
        return carrier?.access_vlan === vlan || carrier?.native_vlan === vlan || Boolean(carrier?.trunk_vlans?.includes(vlan));
    }

    /** The fewest cables that carry a VLAN from one device to another, at both ends of each. Undefined when no path carries it. */
    static vlanPath(
        data: StudioData,
        vlan: string,
        from: string,
        to: string
    ): { device: string; port: string; farDevice: string; farPort: string }[] | undefined {
        const byName = new Map(data.devices.map((device) => [device.name, device]));
        const hops = data.cables
            .filter(
                (cable) =>
                    Tools.carries(byName.get(cable.device), cable.port, vlan) &&
                    Tools.carries(byName.get(cable.farDevice), cable.farPort, vlan)
            )
            .flatMap((cable) => [cable, { device: cable.farDevice, port: cable.farPort, farDevice: cable.device, farPort: cable.port }]);

        const came = new Map<string, (typeof hops)[number] | null>([[from, null]]);
        const queue = [from];

        while (queue.length) {
            const here = queue.shift()!;
            if (here === to) break;

            for (const hop of hops.filter((candidate) => candidate.device === here)) {
                if (came.has(hop.farDevice)) continue;
                came.set(hop.farDevice, hop);
                queue.push(hop.farDevice);
            }
        }

        if (!came.has(to)) return undefined;

        const path: { device: string; port: string; farDevice: string; farPort: string }[] = [];
        for (let hop = came.get(to); hop; hop = came.get(hop.device)) {
            path.unshift({ device: hop.device, port: hop.port, farDevice: hop.farDevice, farPort: hop.farPort });
        }
        return path;
    }
}
