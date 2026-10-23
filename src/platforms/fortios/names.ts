// How the platform names what the config names: ports and interfaces, prefixes, and the routing table an interface sits in.

import { contains, familyOf, host, netmask, network as networkOf, split } from "../../core/addr";
import type { Device, Family } from "../../schema";
import { spell } from "../catalog";

type Addressed = { addresses?: readonly (string | { address: string; peer?: string })[]; vrf?: string; lag?: string };

/** The bridges a device has, in the config's order. A device with any runs in transparent mode, each bridge a forward domain numbered by its place. */
export function bridgesOf(device: Device): { name: string; members: readonly string[] }[] {
    return Object.entries(device.interfaces ?? {}).flatMap(([name, iface]) =>
        iface.type === "bridge" ? [{ name, members: iface.members }] : []
    );
}

/** Whether the device runs in transparent mode: it has a bridge. */
export const isTransparent = (device: Device) => bridgesOf(device).length > 0;

/**
 * The management address of a device in transparent mode: the one IPv4 address on a port or an interface outside every bridge. The device answers on it, the platform's `manageip`, through that interface alone. Undefined when there is none, and the device is reached only through its console.
 */
export function transparentManagement(device: Device): { name: string; address: string } | undefined {
    if (!isTransparent(device)) return undefined;

    const members = new Set(bridgesOf(device).flatMap((bridge) => bridge.members));
    const holders = [...Object.entries(device.ports ?? {}), ...Object.entries(device.interfaces ?? {})] as [
        string,
        Addressed | undefined,
    ][];

    for (const [name, settings] of holders) {
        if (members.has(name)) continue;
        const address = addressesOf(settings).find((each) => familyOf(host(each)) === "ipv4");
        if (address) return { name, address };
    }

    return undefined;
}

/** The forward domain of a VLAN interface in a bridge, or undefined. */
export function forwardDomainOf(device: Device, name: string): number | undefined {
    const index = bridgesOf(device).findIndex((bridge) => bridge.members.includes(name));
    return index < 0 ? undefined : index + 1;
}

/** The name the platform gives a port or an interface: a port by its spelling, any other interface by its key. */
export function nameOf(device: Device, name: string): string {
    if (device.interfaces && name in device.interfaces) return name;
    return spell(device.platform, device.model, name);
}

/** A port's or an interface's settings, by its key. */
export function settingsOf(device: Device, name: string): Addressed | undefined {
    return (device.interfaces?.[name] ?? device.ports?.[name as keyof typeof device.ports]) as Addressed | undefined;
}

/** Every address of a port or an interface. */
export function addressesOf(settings: Addressed | undefined): string[] {
    return (settings?.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
}

/** An address or prefix with its length, a bare address taken as a host. */
export const withLength = (value: string) => (value.includes("/") ? value : `${value}/${familyOf(value) === "ipv4" ? 32 : 128}`);

/** The family of an address or prefix. */
export const familyOfPrefix = (value: string): Family => familyOf(split(withLength(value)).addr);

/** `192.0.2.0 255.255.255.0`, how the platform writes an IPv4 prefix. */
export const subnet = (prefix: string) => `${host(prefix)} ${netmask(split(prefix).len)}`;

/** The canonical form of a prefix: its network address and length, a bare address taken as a host. */
export const network = (prefix: string) => networkOf(withLength(prefix));

/** The number of a VRF on the platform: its place among the device's VRFs, the default table being 0. */
export function vrfNumber(device: Device, vrf: string | undefined): number {
    return vrf ? Object.keys(device.vrfs ?? {}).indexOf(vrf) + 1 : 0;
}

/** Every port and interface that routes, by key, with its settings. A LAG member routes through its LAG. */
function routedHolders(device: Device): [string, Addressed][] {
    const holders = [...Object.entries(device.ports ?? {}), ...Object.entries(device.interfaces ?? {})] as [
        string,
        Addressed | undefined,
    ][];
    return holders.filter((holder): holder is [string, Addressed] => holder[1] !== undefined && !holder[1].lag);
}

/** The interface whose own network holds an address, the most specific when several do, in one routing table. */
export function interfaceFor(device: Device, address: string, vrf?: string): string | undefined {
    let best: { name: string; length: number } | undefined;

    for (const [name, settings] of routedHolders(device)) {
        if ((settings.vrf ?? undefined) !== vrf) continue;

        for (const own of addressesOf(settings)) {
            const length = split(own).len;
            const holds = familyOf(host(own)) === familyOf(address) && contains(network(own), address);
            if (holds && length > (best?.length ?? -1)) best = { name, length };
        }
    }

    return best?.name;
}

/** The interface that holds an address as its own. */
export function holderOf(device: Device, address: string): string | undefined {
    return routedHolders(device).find(([, settings]) => addressesOf(settings).some((own) => host(own) === address))?.[0];
}

/** Every port and interface with an address, by key, where the device's services answer. */
export function addressed(device: Device): string[] {
    return routedHolders(device)
        .filter(([, settings]) => addressesOf(settings).length > 0)
        .map(([name]) => name);
}
