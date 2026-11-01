// Circuit's built-in checks, which a network turns on by name in `checks` (`Checks` in src/config/network.ts). `same_vlan_ids` is run when the project is
// read, so it is not here.

import { Address } from "../core/address";
import type { Checks } from "../config/network";
import type { Device, Interface, Switched } from "../model";
import { Derive } from "../platforms/derive";
import type { Finding } from "../platforms/finding";
import { DeviceChecks } from "./device";

/** The built-in checks' settings, as `circuit()` takes them. */
export type NetworkChecks = Checks<string>;

/** One BGP neighbor's policies, with what it takes from its group. */
type NeighborPolicies = { name: string; address: string; role?: string; importPolicy?: string; exportPolicy?: string };

/** A route policy rule as the checks read it: a route rule, or a call, which has neither `if` nor `then`. */
type LooseRule = { if?: { prefix?: string }; then?: string; call?: string };

export class BuiltInChecks {
    /** Each check the network turns on. A name that is not one of Circuit's is the project's own, which reading the project ran. */
    static run(devices: readonly Device[], checks: NetworkChecks | undefined): Finding[] {
        if (!checks) return [];

        return [
            ...(checks.exports_end_in_reject ? BuiltInChecks.exportsEndInReject(devices) : []),
            ...(checks.imports_end_in_accept_or_reject ? BuiltInChecks.importsEndInAcceptOrReject(devices) : []),
            ...(checks.tunnels_outside_offered ? BuiltInChecks.tunnelsOutsideOffered(devices) : []),
            ...(checks.native_vlans_are_dead_ends ? BuiltInChecks.nativeVlansAreDeadEnds(devices) : []),
            ...(checks.untrusted_vlans ? BuiltInChecks.untrustedVlans(devices, checks.untrusted_vlans) : []),
        ];
    }

    /** Each BGP neighbor of a device, with the role and policies it takes from its group when it sets none. */
    static neighborPolicies(device: Device): NeighborPolicies[] {
        const bgp = device.routing?.bgp;

        return Object.entries(bgp?.neighbors ?? {}).map(([name, neighbor]) => {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;

            return {
                name,
                address: neighbor.address,
                role: neighbor.role ?? group?.role,
                importPolicy: neighbor.import_policy ?? group?.import_policy,
                exportPolicy: neighbor.export_policy ?? group?.export_policy,
            };
        });
    }

    /** A policy's rules, read loosely: a call rule is one with neither `if` nor `then`. */
    private static rulesOf(device: Device, policy: string | undefined): LooseRule[] {
        return policy ? ((device.routing?.policies?.[policy] ?? []) as readonly LooseRule[]).slice() : [];
    }

    /** The prefixes an export policy accepts by name. */
    static offered(device: Device, policy: string | undefined): string[] {
        return BuiltInChecks.rulesOf(device, policy)
            .filter((rule) => rule.then === "accept" && rule.if?.prefix)
            .map((rule) => rule.if!.prefix!);
    }

    /** The VLANs a port or LAG carries, untagged or tagged. */
    static vlansOf(port: Pick<Switched, "access_vlan" | "trunk_vlans">): string[] {
        return [port.access_vlan, ...(port.trunk_vlans ?? [])].filter((vlan): vlan is string => vlan !== undefined);
    }

    /** `exports_end_in_reject`: every BGP export ends in a reject that matches everything. An export to a neighbor whose `role` is `customer` is left out. */
    static exportsEndInReject(devices: readonly Device[]): Finding[] {
        const findings: Finding[] = [];

        for (const device of devices) {
            for (const neighbor of BuiltInChecks.neighborPolicies(device)) {
                if (neighbor.role === "customer" || !neighbor.exportPolicy) continue;

                const last = BuiltInChecks.rulesOf(device, neighbor.exportPolicy).at(-1);
                if (last?.then !== "reject" || last.if) {
                    findings.push({
                        level: "error",
                        device: device.name,
                        message: `routing.bgp.neighbors.${neighbor.name}: export_policy ${neighbor.exportPolicy} does not end in an unconditional reject`,
                    });
                }
            }
        }

        return findings;
    }

    /** `imports_end_in_accept_or_reject`: every BGP import ends in a rule that decides for every route, an accept or a reject without a match. */
    static importsEndInAcceptOrReject(devices: readonly Device[]): Finding[] {
        const findings: Finding[] = [];

        for (const device of devices) {
            for (const neighbor of BuiltInChecks.neighborPolicies(device)) {
                if (!neighbor.importPolicy) continue;

                const last = BuiltInChecks.rulesOf(device, neighbor.importPolicy).at(-1);
                if (!last?.then || last.if) {
                    findings.push({
                        level: "error",
                        device: device.name,
                        message: `routing.bgp.neighbors.${neighbor.name}: import_policy ${neighbor.importPolicy} does not end in an unconditional accept or reject`,
                    });
                }
            }
        }

        return findings;
    }

    /** `tunnels_outside_offered`: a GRE or VXLAN tunnel's local address is outside what the neighbors over it are offered, or their replies route back into the tunnel. */
    static tunnelsOutsideOffered(devices: readonly Device[]): Finding[] {
        const findings: Finding[] = [];

        for (const device of devices) {
            const tunnels = Derive.interfaces(device).filter(({ kind }) => kind === "gre" || kind === "vxlan");

            for (const { name, kind, settings } of tunnels) {
                const local = (settings as Extract<Interface, { local_address: string }>).local_address;
                const subnets = (settings.addresses ?? []).map(DeviceChecks.addressOf);

                for (const neighbor of BuiltInChecks.neighborPolicies(device)) {
                    if (!subnets.some((subnet) => Address.contains(subnet, neighbor.address))) continue;

                    for (const prefix of BuiltInChecks.offered(device, neighbor.exportPolicy)) {
                        if (Address.contains(prefix, local)) {
                            findings.push({
                                level: "error",
                                device: device.name,
                                message: `interfaces.${kind}.${name} is sourced from ${local}, inside ${prefix}, which routing.bgp.neighbors.${neighbor.name} is offered`,
                            });
                        }
                    }
                }
            }
        }

        return findings;
    }

    /**
     * `native_vlans_are_dead_ends`: a native VLAN is native on one trunk (a port or a LAG) of a device at most, and never an access VLAN or a tagged VLAN
     * anywhere on that device.
     */
    static nativeVlansAreDeadEnds(devices: readonly Device[]): Finding[] {
        const findings: Finding[] = [];

        for (const device of devices) {
            const carriers = [
                ...Derive.ports(device).map(([name, port]) => ({ where: `interfaces.ethernet.${name}`, settings: port as Switched })),
                ...Object.entries(device.interfaces?.lag ?? {}).flatMap(([name, lag]) =>
                    lag ? [{ where: `interfaces.lag.${name}`, settings: lag as Switched }] : []
                ),
            ];

            const nativeOn = new Map<string, string[]>();
            for (const { where, settings } of carriers) {
                if (settings.native_vlan) nativeOn.set(settings.native_vlan, [...(nativeOn.get(settings.native_vlan) ?? []), where]);
            }

            for (const [vlan, trunks] of nativeOn) {
                const report = (message: string) =>
                    findings.push({ level: "error", device: device.name, message: `native VLAN ${vlan} ${message}` });

                if (trunks.length > 1) report(`is native on ${trunks.join(", ")}: give each trunk its own`);

                const members = carriers.filter(({ settings }) => BuiltInChecks.vlansOf(settings).includes(vlan));
                for (const { where } of members) report(`is also an access or tagged VLAN on ${where}`);
            }
        }

        return findings;
    }

    /**
     * `untrusted_vlans`: traffic from outside reaches your own VLANs only through a filtering device. A port or LAG carrying an untrusted VLAN beside any other
     * is on a filtering device or faces one, and only a filtering device gives an untrusted VLAN an address. The untrusted VLANs are those written
     * `untrusted: true` on any device.
     */
    static untrustedVlans(devices: readonly Device[], settings: NonNullable<NetworkChecks["untrusted_vlans"]>): Finding[] {
        const untrusted = new Set(
            devices.flatMap((device) =>
                Object.entries(device.switching?.vlans ?? {}).flatMap(([name, vlan]) => (vlan?.untrusted === true ? [name] : []))
            )
        );
        const filtering = new Set<string>(settings.filtering_devices);
        const mixed = (a: string, b: string) => (settings.mixed_links ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
        const findings: Finding[] = [];

        for (const device of devices) {
            const filters = filtering.has(device.name);

            // What carries VLANs: a port on its own, or a LAG, which faces whatever its members link to.
            const ports = Derive.ports(device);
            const carriers = [
                ...ports
                    .filter(([, port]) => !port.in_lag)
                    .map(([name, port]) => ({
                        where: `interfaces.ethernet.${name}`,
                        settings: port as Switched,
                        faces: port.link ? [port.link.device] : [],
                    })),
                ...Object.entries(device.interfaces?.lag ?? {}).flatMap(([name, lag]) =>
                    lag
                        ? [
                              {
                                  where: `interfaces.lag.${name}`,
                                  settings: lag as Switched,
                                  faces: ports.filter(([, port]) => port.in_lag === name && port.link).map(([, port]) => port.link!.device),
                              },
                          ]
                        : []
                ),
            ];

            for (const { where, settings: carrier, faces } of carriers) {
                const carried = BuiltInChecks.vlansOf(carrier);
                const mixes = carried.some((vlan) => untrusted.has(vlan)) && carried.some((vlan) => !untrusted.has(vlan));
                const facesFilter = filters || faces.some((name) => filtering.has(name));
                const isMixedLink = faces.length > 0 && faces.every((name) => mixed(device.name, name));

                if (mixes && !facesFilter && !isMixedLink) {
                    findings.push({
                        level: "error",
                        device: device.name,
                        message: `${where} carries an untrusted VLAN beside a trusted one and does not face one of filtering_devices`,
                    });
                }
            }

            if (filters) continue;

            for (const [name, vlanInterface] of Object.entries(device.interfaces?.vlan_interface ?? {})) {
                if (vlanInterface && untrusted.has(vlanInterface.vlan)) {
                    findings.push({
                        level: "error",
                        device: device.name,
                        message: `interfaces.vlan_interface.${name} puts an address on untrusted VLAN ${vlanInterface.vlan}; only one of filtering_devices may`,
                    });
                }
            }
        }

        return findings;
    }
}
