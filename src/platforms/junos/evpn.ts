import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device, EvpnVxlan } from "../../model";
import { JunosBgp } from "./bgp";
import type { JunosStatements } from "./statements";

/**
 * EVPN over VXLAN in the default switch, as Juniper documents it for a QFX5100: a VTEP that bridges its VXLAN segments and routes none. The default switch is one EVPN instance with one route distinguisher, so `unsupported()` takes one segment.
 */
export class JunosEvpn {
    /** IANA's VXLAN port (RFC 7348), which the switch sends to. */
    private static readonly PORT = 4789;

    /** The largest AS a route distinguisher or target names without `L`: the switch prints a larger one as `4200000000L:351` (TRAPS.md). */
    private static readonly MAX_TWO_BYTE_AS = 65_535;

    /** The VTEP's source is a loopback unit: `Prefix must be lo` otherwise. Circuit takes the main one. */
    private static readonly VTEP_SOURCE = "lo0.0";

    static render(out: JunosStatements, device: Device): void {
        const [segment] = Derive.evpnVxlans(device);
        if (!segment) return;

        const [, vxlan] = segment;
        out.set("protocols evpn encapsulation vxlan");
        // Each broadcast goes to every far VTEP, one copy each, as Juniper's examples write it.
        out.set("protocols evpn multicast-mode ingress-replication");
        out.set("protocols evpn extended-vni-list", vxlan.vni);
        out.set("switch-options vtep-source-interface", JunosEvpn.VTEP_SOURCE);
        out.set("switch-options route-distinguisher", JunosEvpn.value(vxlan.evpn.route_distinguisher));
        JunosEvpn.targets(out, vxlan);
        out.set(`vlans ${vxlan.access_vlan} vxlan vni`, vxlan.vni);
    }

    /** The switch takes one import and one export target, and prints one the two share as one. */
    private static targets(out: JunosStatements, vxlan: EvpnVxlan): void {
        const [imported] = vxlan.evpn.route_targets.import ?? [];
        const [exported] = vxlan.evpn.route_targets.export ?? [];

        if (imported && imported === exported) {
            out.set("switch-options vrf-target", `target:${JunosEvpn.value(imported)}`);
            return;
        }

        if (imported) out.set("switch-options vrf-target import", `target:${JunosEvpn.value(imported)}`);
        if (exported) out.set("switch-options vrf-target export", `target:${JunosEvpn.value(exported)}`);
    }

    /** A route distinguisher or target as the switch prints it: an AS above 65535 with `L` after it. */
    private static value(text: string): string {
        const [administrator, number] = text.split(":");
        const large = /^\d+$/.test(administrator!) && Number(administrator) > JunosEvpn.MAX_TWO_BYTE_AS;
        return large ? `${administrator}L:${number}` : text;
    }

    /**
     * One segment, from the main loopback's one IPv4 address, on a VLAN that no VLAN interface routes. One import and one export target, each needed. What the switch has no place for: another UDP port, a MAC address, and a description. What was not tried: a private VLAN, a QinQ VLAN, and a prefix limit with EVPN routes.
     */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const segments = Derive.evpnVxlans(device);

        for (const [name] of segments.slice(1))
            found.push(
                `interfaces.vxlan.${name}, a second segment: Junos runs EVPN in a QFX5100's default switch, one instance with one route distinguisher. Write one segment`
            );

        const loopback = Object.values(device.interfaces?.loopback ?? {}).find((settings) => settings && !settings.vrf);
        const ipv4 = (loopback?.addresses ?? [])
            .map((entry) => Address.host(typeof entry === "string" ? entry : entry.address))
            .filter((address) => Address.family(address) === "ipv4");

        for (const [name, vxlan] of segments) {
            const at = `interfaces.vxlan.${name}`;
            const local = Address.host(vxlan.local_address);
            if (ipv4.length !== 1 || ipv4[0] !== local)
                found.push(
                    `${at}.local_address ${local}: Junos sends VXLAN from its main loopback, ${JunosEvpn.VTEP_SOURCE}. Write that loopback's address, its one IPv4 address`
                );
            if (vxlan.port !== undefined && vxlan.port !== JunosEvpn.PORT)
                found.push(`${at}.port ${vxlan.port}: a Junos VLAN takes no UDP port for VXLAN. Write ${JunosEvpn.PORT}, or remove port`);
            if (vxlan.mac) found.push(`${at}.mac, which only RouterOS sets for now`);
            if (vxlan.description) found.push(`${at}.description: Junos has no description for a segment. Describe its VLAN`);

            // Without one of them, `commit check` fails: `vrf-import or vrf-target must be configured for evpn instance default-switch`.
            for (const way of ["import", "export"] as const) {
                const count = vxlan.evpn.route_targets[way]?.length ?? 0;
                if (count > 1) found.push(`${at}.evpn.route_targets.${way}, more than one: Junos's vrf-target takes one ${way} target`);
                if (!count) found.push(`${at}.evpn.route_targets.${way}, absent: Junos's default switch needs one ${way} target. Write it`);
            }

            const vlan = vxlan.access_vlan;
            for (const [iface, settings] of Object.entries(device.interfaces?.vlan_interface ?? {}))
                if (settings?.vlan === vlan)
                    found.push(
                        `interfaces.vlan_interface.${iface}, on segment ${name}'s VLAN: Juniper documents a QFX5100 as a VTEP that bridges a VXLAN and routes none`
                    );
            if (device.switching?.vlans?.[vlan]?.private_vlan)
                found.push(`${at}.access_vlan ${vlan}, a private VLAN, not tried with EVPN on Junos`);
            if (Derive.switchedHolders(device).some(({ settings }) => settings.qinq_vlan === vlan))
                found.push(`${at}.access_vlan ${vlan}, a QinQ VLAN, not tried with EVPN on Junos`);
        }

        for (const [name, neighbor] of Object.entries(device.routing?.bgp?.neighbors ?? {})) {
            if (!neighbor) continue;
            const settings = JunosBgp.settingsOf(device, neighbor);
            if (Derive.carriesEvpn(settings) && settings.max_prefixes !== undefined)
                found.push(`routing.bgp.neighbors.${name}.max_prefixes, with EVPN routes: not built for Junos yet`);
        }

        return found;
    }
}
