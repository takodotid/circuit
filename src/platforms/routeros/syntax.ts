import type { Device, Family, Prefix } from "../../model";

/** How RouterOS writes a value, and the lookups the render, firewall, and routing share. */
export class RouterOsSyntax {
    /** Address lists holding the prefixes BGP originates. A session reads the one of its family. */
    static readonly NETWORKS: Record<Family, string> = { ipv4: "bgp-networks-v4", ipv6: "bgp-networks-v6" };

    /** A prefix lifetime of all ones, which RFC 4861 makes forever. */
    private static readonly INFINITE_LIFETIME = 4_294_967_295;

    /** The entries of a map keyed by name, without the names whose value is left out. */
    static entries<V>(map: Readonly<Record<string, V | undefined>> | undefined): [string, V][] {
        return Object.entries(map ?? {}).flatMap(([name, value]) => (value === undefined ? [] : [[name, value] as [string, V]]));
    }

    /** A prefix set's prefixes, written as a list or as a map of named prefixes. Undefined for a set fetched from a registry. */
    static prefixesOf(device: Device, set: string): readonly Prefix[] | undefined {
        const declared = device.routing?.prefix_sets?.[set];
        if (!declared || !("prefixes" in declared)) return undefined;

        const prefixes = declared.prefixes;
        return Array.isArray(prefixes) ? prefixes : Object.values(prefixes);
    }

    /** The selector of a port by the name the platform gives it, as the export prints it: `[ find default-name=ether1 ]`. */
    static port(name: string): string {
        return `[ find default-name=${name} ]`;
    }

    /** An address reached through a VRF, as a server's address names it: `192.0.2.1@mgmt`. */
    static inVrf(address: string, vrf: string | undefined): string {
        return vrf ? `${address}@${vrf}` : address;
    }

    static yesNo(on: boolean | undefined): string {
        return on ? "yes" : "no";
    }

    /** A number in hex, as a bridge prints a priority: `0x1000`. Undefined when absent. */
    static hex(value: number | undefined): string | undefined {
        return value === undefined ? undefined : `0x${value.toString(16)}`;
    }

    /** `yes`, or nothing, so a property whose default is `no` stays at its default. */
    static yesWhen(on: boolean | undefined): "yes" | undefined {
        return on ? "yes" : undefined;
    }

    /** A prefix's lifetime as the device prints it, all ones being `infinity` (RFC 4861). Undefined when absent. */
    static lifetime(seconds: number | undefined): string | undefined {
        if (seconds === undefined) return undefined;
        return seconds === RouterOsSyntax.INFINITE_LIFETIME ? "infinity" : RouterOsSyntax.duration(seconds);
    }

    /** Seconds as the platform writes a duration: `3600` becomes `1h`, `90` becomes `1m30s`. */
    static duration(seconds: number): string {
        const units = [
            ["w", 604_800],
            ["d", 86_400],
            ["h", 3600],
            ["m", 60],
            ["s", 1],
        ] as const;
        let remaining = seconds;
        let text = "";

        for (const [unit, size] of units) {
            const count = Math.floor(remaining / size);
            if (count > 0) text += `${count}${unit}`;
            remaining %= size;
        }

        return text || "0s";
    }
}
