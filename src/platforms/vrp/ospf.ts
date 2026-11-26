// OSPF on VRP: what it can't do, what is not tested yet, and the lines it undoes its own way. A CE6855 on V200R005C00SPC800 committed ranges, priorities, NBMA and point-to-multipoint links, and virtual links (TRAPS.md).

import type { Device, OspfAuthentication } from "../../model";

export class VrpOspf {
    /** `ospf authentication-mode` for each algorithm the platform has. */
    static readonly AUTH: Partial<Record<OspfAuthentication["algorithm"], string>> = { md5: "md5", "hmac-sha-256": "hmac-sha256" };

    /** What OSPF can't do here. */
    static unsupported(device: Device): string[] {
        const ospf = device.routing?.ospf;
        if (!ospf) return [];

        const found: string[] = [];
        if (ospf.address_families?.includes("ipv6")) found.push("routing.ospf for IPv6");

        for (const [areaId, area] of Object.entries(ospf.areas))
            for (const [name, settings] of Object.entries(area.interfaces)) {
                const where = `routing.ospf.areas.${areaId}.interfaces.${name}`;
                if (settings?.network === "point-to-multipoint" && settings.neighbors)
                    found.push(
                        `${where}.neighbors on a point-to-multipoint link: the platform sends its hellos there by multicast, as \`peer\` is for NBMA links, and V200R005 has no \`p2mp-peer\``
                    );

                // A CE6855 refused `ospf network-type broadcast` on a tunnel: "can not be run on tunnel interfaces".
                const pointToPoint = device.interfaces?.gre?.[name] ?? device.interfaces?.loopback?.[name];
                if (pointToPoint && settings?.network && settings.network !== "point-to-point")
                    found.push(
                        `${where}.network ${settings.network}, the switch runs OSPF on a tunnel or a loopback as point-to-point only`
                    );

                const authentication = settings?.authentication;
                if (authentication && !VrpOspf.AUTH[authentication.algorithm])
                    found.push(
                        `${where}.authentication.algorithm ${authentication.algorithm}, the platform signs OSPF with md5 or hmac-sha-256`
                    );
                if (authentication?.key_id === 0) found.push(`${where}.authentication.key_id 0, the platform numbers keys from 1`);
            }

        return found;
    }

    /** Built from Huawei's documentation and not tested on a switch (decision 114): area types, timers, and authentication. */
    static experimental(device: Device): string[] {
        const found: string[] = [];

        for (const [areaId, area] of Object.entries(device.routing?.ospf?.areas ?? {})) {
            const where = `routing.ospf.areas.${areaId}`;
            for (const key of ["type", "no_summaries", "stub_default_cost"] as const)
                if (area[key] !== undefined) found.push(`${where}.${key}`);

            for (const [name, settings] of Object.entries(area.interfaces)) {
                for (const key of ["hello_interval", "dead_interval", "authentication"] as const) {
                    if (settings?.[key] !== undefined) found.push(`${where}.interfaces.${name}.${key}`);
                }
            }
        }

        return found;
    }

    /** Each passive interface, and each source of redistributed routes, is a setting of its own: a new one leaves the others in place. Undefined for any other line. */
    static head(line: string): string | undefined {
        return /^(silent-interface \S+|import-route (direct|static))$/.test(line) ? line : undefined;
    }

    /** A range is undone by its address and mask, without its options, and the process by its number, without its router ID or VRF. Undefined for any other line. */
    static undo(line: string): string | undefined {
        const summary = /^abr-summary \S+ \S+/.exec(line);
        if (summary) return `undo ${summary[0]}`;
        const process = /^ospf \d+(?= (?:router-id|vpn-instance) )/.exec(line);
        return process ? `undo ${process[0]}` : undefined;
    }
}
