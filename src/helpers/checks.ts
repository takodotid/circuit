import { Address } from "../core/address";
import type { Check, Finding } from "../core/define";
import { Bgp } from "./bgp";

/** Where traffic from outside, before anything filters it, may go. Every VLAN not listed as untrusted is trusted, so a VLAN added later is protected without being listed. */
export type TrustBoundary = {
    /** VLANs carrying traffic straight from outside: transits, exchanges, an ISP handoff. */
    untrusted: readonly string[];
    /** The devices that filter: the only ones that may give an untrusted VLAN an address, and the only ones a port carrying both kinds may face. */
    routers: readonly string[];
    /**
     * Links between two switches that may carry both kinds, each named by its two devices: a site's switch extended to another building, with an exchange's VLAN and its own management on one cable. Neither end gives an untrusted VLAN an address.
     */
    extended?: readonly (readonly [string, string])[];
};

/** Checks for `checks` in `defineNetwork`, and helpers for checks of your own. */
export class Checks {
    /**
     * Every BGP export ends in a reject that matches everything, so nothing leaves by accident. An export to a neighbor whose `role` is `customer` is left out: sending a customer everything you know is what it pays for, and cannot leak a route to the rest of the internet.
     */
    static readonly exportsEndInReject: Check = (devices) => {
        const findings: Finding[] = [];

        for (const device of devices) {
            for (const neighbor of Bgp.neighborPolicies(device)) {
                if (neighbor.role === "customer") continue;

                const last = neighbor.export ? device.policies?.[neighbor.export]?.at(-1) : undefined;

                if (neighbor.export && (last?.action !== "reject" || last.match)) {
                    findings.push({
                        level: "error",
                        device: device.name,
                        message: `${neighbor.name}: export ${neighbor.export} does not end in an unconditional reject`,
                    });
                }
            }
        }

        return findings;
    };

    /** A GRE or VXLAN tunnel's local address is outside what the neighbors over it are offered, or their replies route back into the tunnel. */
    static readonly tunnelsOutsideOffered: Check = (devices) => {
        const findings: Finding[] = [];

        for (const device of devices) {
            for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
                if (iface.type !== "gre" && iface.type !== "vxlan") continue;

                const subnets = (iface.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

                for (const neighbor of Bgp.neighborPolicies(device)) {
                    if (!subnets.some((subnet) => Address.contains(subnet, neighbor.address))) continue;

                    for (const prefix of Bgp.offered(device, neighbor.export)) {
                        if (Address.contains(prefix, iface.local)) {
                            findings.push({
                                level: "error",
                                device: device.name,
                                message: `${name} is sourced from ${iface.local}, inside ${prefix}, which ${neighbor.name} is offered`,
                            });
                        }
                    }
                }
            }
        }

        return findings;
    };

    /** The VLANs a port carries, untagged or tagged. */
    static vlansOf(port: { access_vlan?: string; trunk_vlans?: readonly string[] }): string[] {
        return [port.access_vlan, ...(port.trunk_vlans ?? [])].filter((vlan): vlan is string => vlan !== undefined);
    }

    /** A check: traffic from outside reaches your own VLANs only through a router. A port or LAG carrying an untrusted VLAN beside any other is on a router or faces one, and only a router gives an untrusted VLAN an address. */
    static trustBoundary(boundary: TrustBoundary): Check {
        return (devices) => {
            const untrusted = new Set(boundary.untrusted);
            const routers = new Set(boundary.routers);
            const extended = (a: string, b: string) =>
                (boundary.extended ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
            const findings: Finding[] = [];

            for (const device of devices) {
                const isRouter = routers.has(device.name);
                const ports = Object.entries(device.ports ?? {}).flatMap(([name, port]) => (port ? [{ name, port }] : []));

                // What carries VLANs: a port on its own, or a LAG, which faces whatever its members link to.
                const carriers = [
                    ...ports
                        .filter(({ port }) => !port.lag)
                        .map(({ name, port }) => ({
                            what: `port ${name}`,
                            carried: Checks.vlansOf(port),
                            faces: port.link ? [port.link.device] : [],
                        })),
                    ...Object.entries(device.interfaces ?? {}).flatMap(([name, iface]) =>
                        iface.type === "lag"
                            ? [
                                  {
                                      what: `LAG ${name}`,
                                      carried: Checks.vlansOf(iface),
                                      faces: ports
                                          .filter(({ port }) => port.lag === name && port.link)
                                          .map(({ port }) => port.link!.device),
                                  },
                              ]
                            : []
                    ),
                ];

                for (const { what, carried, faces } of carriers) {
                    const mixes = carried.some((vlan) => untrusted.has(vlan)) && carried.some((vlan) => !untrusted.has(vlan));
                    const facesRouter = isRouter || faces.some((name) => routers.has(name));
                    const isExtension = faces.length > 0 && faces.every((name) => extended(device.name, name));

                    if (mixes && !facesRouter && !isExtension) {
                        findings.push({
                            level: "error",
                            device: device.name,
                            message: `${what} carries an untrusted VLAN beside a trusted one and does not face a router`,
                        });
                    }
                }

                if (isRouter) continue;

                for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
                    if (iface.type === "vlan" && untrusted.has(iface.vlan)) {
                        findings.push({
                            level: "error",
                            device: device.name,
                            message: `interface ${name} puts an address on untrusted VLAN ${iface.vlan}; only a router may`,
                        });
                    }
                }
            }

            return findings;
        };
    }
}
