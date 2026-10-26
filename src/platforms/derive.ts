// Values more than one adapter derives from a device in the same way.

import { Address } from "../core/address";
import type { Device } from "../schema";

/** A feature a platform renders once proved on one of its devices. */
export type ProvedFeature =
    "bfd-timers" | "static-route-bfd" | "multihop-bfd" | "alarm-severity" | "mac-limit" | "ethertype-filter" | "management-vdom";

export class Derive {
    /** Each LAG's number: its own `id`, or its position among the device's LAGs. */
    static lagIds(device: Device): Map<string, number> {
        const numbers = new Map<string, number>();
        let position = 0;

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "lag") continue;

            position++;
            numbers.set(name, iface.id ?? position);
        }

        return numbers;
    }

    /** The IPv4 networks of a port's or an interface's addresses. */
    static ipv4Networks(device: Device, iface: string): string[] {
        const settings = device.interfaces?.[iface] ?? device.ports?.[iface as keyof typeof device.ports];
        const addresses = (settings?.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

        return addresses.filter((address) => Address.family(address) === "ipv4").map((address) => Address.prefixOf(address));
    }

    /** Fields a platform renders only once they are proved on one of its devices. */
    private static readonly UNPROVED_PORT_FIELDS = ["mac_limit", "ethertypes"] as const;

    /** Fields a platform refuses until it has proved them on a device. A platform names the ones it has proved, and the rest are refused. */
    static unproved(device: Device, proved: readonly ProvedFeature[] = []): string[] {
        const found: string[] = [];
        const routing = device.routing;
        const unproved = "not proved on a device yet";
        const has = (feature: ProvedFeature) => proved.includes(feature);

        if (routing?.bfd && !has("bfd-timers")) found.push(`routing.bfd, BFD timers are ${unproved}`);
        if (device.vdoms && !has("management-vdom")) found.push(`vdoms, a management VDOM is ${unproved}`);

        for (const route of routing?.static ?? []) {
            if (route.bfd && !has("static-route-bfd"))
                found.push(`routing.static ${route.prefix} bfd, BFD on a static route is ${unproved}`);
        }

        const bgp = routing?.bgp;

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;
            const bfd = neighbor.bfd ?? group?.bfd;
            const multihop = neighbor.multihop ?? group?.multihop;

            if (bfd && multihop && !has("multihop-bfd"))
                found.push(`routing.bgp.neighbors.${name}.bfd, BFD on a multihop session is ${unproved}`);
        }

        if (!has("alarm-severity")) {
            for (const name of Object.keys(device.system?.alarms ?? {})) {
                found.push(`system.alarms.${name}, an alarm's severity is ${unproved}`);
            }
        }

        const holders = [
            ...Object.entries(device.ports ?? {}).map(([name, settings]) => ({ where: `ports.${name}`, settings })),
            ...Object.entries(device.interfaces ?? {}).map(([name, settings]) => ({
                where: `interfaces.${name}`,
                settings: settings.type === "lag" ? settings : undefined,
            })),
        ];

        for (const { where, settings } of holders) {
            for (const field of Derive.UNPROVED_PORT_FIELDS) {
                const feature = field === "mac_limit" ? "mac-limit" : "ethertype-filter";
                if (settings?.[field] !== undefined && !has(feature)) found.push(`${where}.${field}, ${unproved}`);
            }
        }

        return found;
    }

    /** Services the switch platforms run. Each takes its sources from `management.allow`, on the protocol's own port. */
    private static readonly SWITCH_SERVICES = ["ssh", "telnet", "snmp"] as const;

    /** Fields neither switch platform, VRP nor Raisecom ROS, expresses: a service's own sources or port, a user's description or keys, the IP stack's host settings, a point-to-point address, and offload per interface. `ownSources` names the services a platform gives their own sources. */
    static switchUnsupported(device: Device, ownSources: readonly ("ssh" | "telnet" | "snmp")[] = []): string[] {
        const found: string[] = [];

        for (const service of Derive.SWITCH_SERVICES) {
            const settings = device.management?.[service];
            if (settings?.allow && !ownSources.includes(service))
                found.push(`management.${service}.allow, every service takes management.allow`);
            if (settings?.port) found.push(`management.${service}.port`);
        }

        for (const [name, user] of Object.entries(device.users ?? {})) {
            if (user.description) found.push(`users.${name}.description`);
            if (user.ssh_keys?.length) found.push(`users.${name}.ssh_keys`);
        }

        if (device.system?.ip) found.push("system.ip");

        for (const [name, port] of Object.entries(device.ports ?? {})) {
            if (port?.hardware_offload !== undefined) found.push(`ports.${name}.hardware_offload`);
        }

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.addresses?.some((entry) => typeof entry !== "string")) found.push(`interfaces.${name}.addresses with a peer`);
            if (iface.hardware_offload !== undefined) found.push(`interfaces.${name}.hardware_offload`);
        }

        return found;
    }
}
