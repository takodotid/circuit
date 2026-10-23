// How the platform names what the config names: ports and interfaces, prefixes, and the routing table an interface sits in.

import { Address } from "../../core/address";
import type { Device, Family } from "../../schema";
import { Catalog } from "../catalog";

type Addressed = { addresses?: readonly (string | { address: string; peer?: string })[]; vrf?: string; lag?: string };

export class FortiOsNames {
    /** The bridges a device has, in the config's order. A device with any runs in transparent mode, each bridge a forward domain numbered by its place. */
    static bridgesOf(device: Device): { name: string; members: readonly string[] }[] {
        return Object.entries(device.interfaces ?? {}).flatMap(([name, iface]) =>
            iface.type === "bridge" ? [{ name, members: iface.members }] : []
        );
    }

    /** Whether the device runs in transparent mode: it has a bridge. */
    static isTransparent(device: Device): boolean {
        return FortiOsNames.bridgesOf(device).length > 0;
    }

    /**
     * The management address of a device in transparent mode: the one IPv4 address on a port or an interface outside every bridge. The device answers on it, the platform's `manageip`, through that interface alone. Undefined when there is none, and the device is reached only through its console.
     */
    static transparentManagement(device: Device): { name: string; address: string } | undefined {
        if (!FortiOsNames.isTransparent(device)) return undefined;

        const members = new Set(FortiOsNames.bridgesOf(device).flatMap((bridge) => bridge.members));
        const holders = [...Object.entries(device.ports ?? {}), ...Object.entries(device.interfaces ?? {})] as [
            string,
            Addressed | undefined,
        ][];

        for (const [name, settings] of holders) {
            if (members.has(name)) continue;
            const address = FortiOsNames.addressesOf(settings).find((each) => Address.family(Address.host(each)) === "ipv4");
            if (address) return { name, address };
        }

        return undefined;
    }

    /** The forward domain of a VLAN interface in a bridge, or undefined. */
    static forwardDomainOf(device: Device, name: string): number | undefined {
        const index = FortiOsNames.bridgesOf(device).findIndex((bridge) => bridge.members.includes(name));
        return index < 0 ? undefined : index + 1;
    }

    /** The name the platform gives a port or an interface: a port by its spelling, any other interface by its key. */
    static nameOf(device: Device, name: string): string {
        if (device.interfaces && name in device.interfaces) return name;
        return Catalog.spell(device.platform, device.model, name);
    }

    /** A port's or an interface's settings, by its key. */
    static settingsOf(device: Device, name: string): Addressed | undefined {
        return (device.interfaces?.[name] ?? device.ports?.[name as keyof typeof device.ports]) as Addressed | undefined;
    }

    /** Every address of a port or an interface. */
    static addressesOf(settings: Addressed | undefined): string[] {
        return (settings?.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
    }

    /** An address or prefix with its length, a bare address taken as a host. */
    static withLength(value: string): string {
        return value.includes("/") ? value : `${value}/${Address.family(value) === "ipv4" ? 32 : 128}`;
    }

    /** The family of an address or prefix. */
    static familyOfPrefix(value: string): Family {
        return Address.family(Address.split(FortiOsNames.withLength(value)).addr);
    }

    /** `192.0.2.0 255.255.255.0`, how the platform writes an IPv4 prefix. */
    static subnet(prefix: string): string {
        return `${Address.host(prefix)} ${Address.netmask(Address.split(prefix).len)}`;
    }

    /** The canonical form of a prefix: its network address and length, a bare address taken as a host. */
    static network(prefix: string): string {
        return Address.prefixOf(FortiOsNames.withLength(prefix));
    }

    /** The number of a VRF on the platform: its place among the device's VRFs, the default table being 0. */
    static vrfNumber(device: Device, vrf: string | undefined): number {
        return vrf ? Object.keys(device.vrfs ?? {}).indexOf(vrf) + 1 : 0;
    }

    /** Every port and interface that routes, by key, with its settings. A LAG member routes through its LAG. */
    private static routedHolders(device: Device): [string, Addressed][] {
        const holders = [...Object.entries(device.ports ?? {}), ...Object.entries(device.interfaces ?? {})] as [
            string,
            Addressed | undefined,
        ][];
        return holders.filter((holder): holder is [string, Addressed] => holder[1] !== undefined && !holder[1].lag);
    }

    /** The interface whose own network holds an address, the most specific when several do, in one routing table. */
    static interfaceFor(device: Device, address: string, vrf?: string): string | undefined {
        let best: { name: string; length: number } | undefined;

        for (const [name, settings] of FortiOsNames.routedHolders(device)) {
            if ((settings.vrf ?? undefined) !== vrf) continue;

            for (const own of FortiOsNames.addressesOf(settings)) {
                const length = Address.split(own).len;
                const holds =
                    Address.family(Address.host(own)) === Address.family(address) && Address.contains(FortiOsNames.network(own), address);
                if (holds && length > (best?.length ?? -1)) best = { name, length };
            }
        }

        return best?.name;
    }

    /** The interface that holds an address as its own. */
    static holderOf(device: Device, address: string): string | undefined {
        return FortiOsNames.routedHolders(device).find(([, settings]) =>
            FortiOsNames.addressesOf(settings).some((own) => Address.host(own) === address)
        )?.[0];
    }

    /** Every port and interface with an address, by key, where the device's services answer. */
    static addressed(device: Device): string[] {
        return FortiOsNames.routedHolders(device)
            .filter(([, settings]) => FortiOsNames.addressesOf(settings).length > 0)
            .map(([name]) => name);
    }
}
