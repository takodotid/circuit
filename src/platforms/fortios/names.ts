import { Address } from "../../core/address";
import type { Device, Family } from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import type { NamedInterface } from "../../core/derive";

type Addressed = { addresses?: readonly (string | { address: string; peer_address?: string })[]; vrf?: string; in_lag?: string };

export class FortiOsNames {
    /** In the config's order, since each bridge is a forward domain numbered by its place. */
    static bridgesOf(device: Device): { name: string; members: readonly string[] }[] {
        return Object.entries(device.interfaces?.bridge ?? {}).flatMap(([name, bridge]) =>
            bridge ? [{ name, members: bridge.member_interfaces }] : []
        );
    }

    static isTunnel(device: Device, name: string): boolean {
        return Boolean(device.interfaces?.gre?.[name] ?? device.interfaces?.vxlan?.[name] ?? device.interfaces?.ipsec?.[name]);
    }

    /** A bridge needs transparent mode. */
    static isTransparent(device: Device): boolean {
        return FortiOsNames.bridgesOf(device).length > 0;
    }

    /** The one IPv4 address on a port or interface outside every bridge, the platform's `manageip`. The device answers on it through that interface alone. Without one, only the console reaches the device. */
    static transparentManagement(device: Device): { name: string; address: string } | undefined {
        if (!FortiOsNames.isTransparent(device)) return undefined;

        const members = new Set(FortiOsNames.bridgesOf(device).flatMap((bridge) => bridge.members));
        for (const [name, settings] of FortiOsNames.holders(device)) {
            if (members.has(name)) continue;
            const address = FortiOsNames.addressesOf(settings).find((each) => Address.family(Address.host(each)) === "ipv4");
            if (address) return { name, address };
        }

        return undefined;
    }

    static forwardDomainOf(device: Device, name: string): number | undefined {
        const index = FortiOsNames.bridgesOf(device).findIndex((bridge) => bridge.members.includes(name));
        return index === -1 ? undefined : index + 1;
    }

    /** The name the platform gives a port or an interface: a port by its spelling, any other interface by its key. */
    static of(device: Device, name: string): string {
        if (FortiOsNames.interfacesOf(device).some((entry) => entry.name === name)) return name;

        return Catalog.spell(device.platform, device.model, name);
    }

    static settingsOf(device: Device, name: string): Addressed | undefined {
        return Derive.settings(device, name);
    }

    /** Every interface that is not a port, in the config's order. Where an order shows on the device, such as the interfaces NTP answers on, it is this one. */
    static interfacesOf(device: Device): NamedInterface[] {
        return Object.entries(device.interfaces ?? {}).flatMap(([kind, group]) =>
            kind === "ethernet"
                ? []
                : Object.entries((group ?? {}) as Record<string, NamedInterface["settings"] | undefined>).flatMap(([name, settings]) =>
                      settings ? [{ name, kind: kind as NamedInterface["kind"], settings }] : []
                  )
        );
    }

    private static holders(device: Device): [string, Addressed][] {
        return [
            ...Derive.ports(device),
            ...FortiOsNames.interfacesOf(device).map(({ name, settings }) => [name, settings] as [string, Addressed]),
        ];
    }

    /** The sources `management.allow` names: its prefixes, or the members of the address set it uses. */
    static allowed(device: Device): readonly string[] {
        const allow = device.management?.allow;
        if (typeof allow !== "string") return allow ?? [];

        return device.firewall?.address_sets?.[allow] ?? [];
    }

    /** Circuit writes a list out as one rule per value before the platform reads it, and `unsupported()` refuses a list left with several. */
    static single<T>(value: T | readonly T[] | undefined): T | undefined {
        return Array.isArray(value) ? (value as readonly T[])[0] : (value as T | undefined);
    }

    static addressesOf(settings: Addressed | undefined): string[] {
        return (settings?.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
    }

    /** An address or prefix with its length, a bare address taken as a host. */
    static withLength(value: string): string {
        return value.includes("/") ? value : `${value}/${Address.family(value) === "ipv4" ? 32 : 128}`;
    }

    static familyOfPrefix(value: string): Family {
        return Address.family(Address.split(FortiOsNames.withLength(value)).addr);
    }

    /** `192.0.2.0 255.255.255.0`, how the platform writes an IPv4 prefix. */
    static subnet(prefix: string): string {
        return `${Address.host(prefix)} ${Address.netmask(Address.split(prefix).len)}`;
    }

    /** A prefix's network address and length, a bare address taken as a host. */
    static network(prefix: string): string {
        return Address.prefixOf(FortiOsNames.withLength(prefix));
    }

    /** The number of a VRF on the platform: its place among the device's VRFs, the default table being 0. */
    static vrfNumber(device: Device, vrf: string | undefined): number {
        return vrf ? Object.keys(device.routing?.vrfs ?? {}).indexOf(vrf) + 1 : 0;
    }

    /** A LAG member routes through its LAG, so it is left out. */
    private static routedHolders(device: Device): [string, Addressed][] {
        return FortiOsNames.holders(device).filter(([, settings]) => !settings.in_lag);
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
