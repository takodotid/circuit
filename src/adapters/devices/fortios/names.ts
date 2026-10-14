// How the platform names what the config names: ports and interfaces, prefixes, and the routing table an interface sits in.

import { contains, familyOf, host, netmask, network as networkOf, split } from "../../../core/addr";
import type { Device, Family } from "../../../schema";
import { spell } from "../catalog";

type Addressed = { addresses?: readonly (string | { address: string; peer?: string })[]; vrf?: string; lag?: string };

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
