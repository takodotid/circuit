import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import type { Device, VlanInterface } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** The tags the bridge and the VLAN interfaces use: the bridge's one TPID (IEEE 802.1ad), and a VLAN interface on another for an inner tag (QinQ). */
export class RouterOsVlanTags {
    /** The bridge every switched port joins. One per device, so one TPID for all of them. */
    static readonly BRIDGE = "bridge";

    /** IEEE 802.1ad's service tag, the TPID the bridge's `ether-type` takes beside 802.1Q's. */
    private static readonly SERVICE_TAG = "0x88a8";

    /** What the router has not been tried with on an 802.1ad bridge. */
    private static readonly UNTESTED = "not tested on a bridge with tpid 0x88a8 yet";

    /** Interface names the render or RouterOS itself holds: the bridge, and RouterOS 7's own loopback, `lo` (TRAPS.md). */
    private static readonly RESERVED: Partial<Record<string, string>> = {
        [RouterOsVlanTags.BRIDGE]: "the bridge of the switched ports",
        lo: "RouterOS's own loopback",
    };

    /** The bridge's TPID, when it is 802.1ad's. It is one for every port of the bridge, so `unsupported()` wants it on each switched port and LAG. */
    static tpid(device: Device): typeof RouterOsVlanTags.SERVICE_TAG | undefined {
        const serviceTag = Derive.switchedHolders(device).some(({ settings }) => settings.tpid === RouterOsVlanTags.SERVICE_TAG);
        return serviceTag ? RouterOsVlanTags.SERVICE_TAG : undefined;
    }

    /**
     * Each VLAN interface is a VLAN interface on the bridge, with `use-service-tag` on an 802.1ad bridge, or it would take no frame (TRAPS.md). One with an inner VLAN is a VLAN interface on its outer VLAN's. That is the plain VLAN interface of the VLAN, or else one the render makes, named after the VLAN. The outer ones go first, since the inner ones are on them.
     */
    static render(render: RouterOsRender, device: Device): void {
        const serviceTag = RouterOsSyntax.yesWhen(RouterOsVlanTags.tpid(device) !== undefined);
        const declared = RouterOsSyntax.entries(device.interfaces?.vlan_interface);
        const plain = declared.filter(([, iface]) => iface.inner_vlan_id === undefined);
        const inner = declared.filter(([, iface]) => iface.inner_vlan_id !== undefined);
        const bridge = RouterOsVlanTags.BRIDGE;

        for (const [name, iface] of plain) RouterOsVlanTags.vlanInterface(render, device, name, iface, bridge, serviceTag);

        for (const vlan of RouterOsVlanTags.madeOuter(device))
            render.add("/interface vlan", "add", {
                interface: bridge,
                name: vlan,
                "use-service-tag": serviceTag,
                "vlan-id": render.vlanId(vlan),
            });

        for (const [name, iface] of inner)
            RouterOsVlanTags.vlanInterface(render, device, name, iface, RouterOsVlanTags.outerOf(device, iface.vlan), undefined);
    }

    /**
     * When the device offloads, a VLAN interface that opts out is routed in software, so the firewall applies. Every VLAN interface on the bridge has the bridge's MAC. One with a MAC of its own is a MACVLAN on the VLAN interface. The MACVLAN takes the configured name, so its addresses and the rules naming it land on it.
     */
    private static vlanInterface(
        render: RouterOsRender,
        device: Device,
        name: string,
        iface: VlanInterface,
        on: string,
        serviceTag: string | undefined
    ): void {
        const softwareOnly = device.system?.hardware_offload && iface.hardware_offload === false;
        const vlanName = iface.mac ? RouterOsVlanTags.underMacvlan(name) : name;

        render.add("/interface vlan", "add", {
            comment: iface.description,
            interface: on,
            "l3-hw-offloading": softwareOnly ? "no" : undefined,
            mtu: iface.mtu,
            name: vlanName,
            "use-service-tag": serviceTag,
            "vlan-id": iface.inner_vlan_id ?? render.vlanId(iface.vlan),
        });

        if (iface.mac) {
            render.add("/interface macvlan", "add", {
                comment: iface.description,
                interface: vlanName,
                "mac-address": iface.mac.toUpperCase(),
                mtu: iface.mtu,
                name,
            });
        }
    }

    /** The name of the VLAN interface under one with a MAC of its own, which takes the configured name itself. */
    private static underMacvlan(name: string): string {
        return `${name}-vlan`;
    }

    /** The VLAN interface of a VLAN's outer tag: its plain VLAN interface, or the one named after the VLAN. */
    private static outerOf(device: Device, vlan: string): string {
        const found = RouterOsSyntax.entries(device.interfaces?.vlan_interface).find(
            ([, iface]) => iface.vlan === vlan && iface.inner_vlan_id === undefined
        );
        if (!found) return vlan;

        const [name, iface] = found;
        return iface.mac ? RouterOsVlanTags.underMacvlan(name) : name;
    }

    /** The VLANs with an inner VLAN interface and no plain one, whose outer VLAN interface the render makes. */
    static madeOuter(device: Device): string[] {
        const declared = RouterOsSyntax.entries(device.interfaces?.vlan_interface).map(([, iface]) => iface);
        const outer = new Set(declared.filter((iface) => iface.inner_vlan_id !== undefined).map((iface) => iface.vlan));
        for (const iface of declared) if (iface.inner_vlan_id === undefined) outer.delete(iface.vlan);
        return [...outer];
    }

    /** What the router can't build: QinQ beside snooping, VLAN translation, and a TPID for some switched ports only. What is untested on an 802.1ad bridge. An inner VLAN interface with a MAC, or without a free name for its outer one. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const field of ["dhcp_snooping", "ra_guard"] as const)
            for (const { where, settings } of device.switching?.[field] ? Derive.switchedHolders(device) : [])
                if (settings.qinq_vlan) found.push(`${where}.qinq_vlan beside switching.${field}, which the platform runs on every VLAN`);
        // A switch rule changes a VLAN ID as a frame comes in only, and exactly between two ports only.
        for (const { where, settings } of Derive.switchedHolders(device))
            if (settings.vlan_translation) found.push(`${where}.vlan_translation, RouterOS changes a VLAN ID only as a frame comes in`);
        const holders = Derive.switchedHolders(device).filter(
            ({ settings }) =>
                !("in_lag" in settings && settings.in_lag) && (settings.access_vlan || settings.trunk_vlans || settings.qinq_vlan)
        );
        const tagged = holders.find(({ settings }) => settings.tpid === RouterOsVlanTags.SERVICE_TAG);

        if (tagged) {
            const one = `RouterOS has one TPID for every switched port and LAG, its bridge's ether-type, and ${tagged.where} has 0x88a8: write tpid: "0x88a8" here too`;
            for (const { where, settings } of holders)
                if (settings.tpid !== RouterOsVlanTags.SERVICE_TAG) found.push(`${where} without tpid 0x88a8, ${one}`);

            for (const field of ["dhcp_snooping", "ra_guard"] as const)
                if (device.switching?.[field]) found.push(`switching.${field}, ${RouterOsVlanTags.UNTESTED}`);
            for (const name of Object.keys(device.interfaces?.pseudowire ?? {}))
                found.push(`interfaces.pseudowire.${name}, ${RouterOsVlanTags.UNTESTED}`);
            for (const [name, vlan] of RouterOsSyntax.entries(device.switching?.vlans))
                if (vlan.vpls) found.push(`switching.vlans.${name}.vpls, ${RouterOsVlanTags.UNTESTED}`);
            for (const { where, settings } of holders) {
                // An 802.1ad bridge sends its BPDUs to another address than the one `stp: false` drops (MikroTik's manual, Bridging and Switching).
                if (settings.stp === false) found.push(`${where}.stp false, ${RouterOsVlanTags.UNTESTED}`);
                for (const field of ["ethertypes", "ingress_acl"] as const)
                    if ((settings as Partial<Record<typeof field, unknown>>)[field] !== undefined)
                        found.push(`${where}.${field}, ${RouterOsVlanTags.UNTESTED}`);
            }
        }

        for (const [name, iface] of RouterOsSyntax.entries(device.interfaces?.vlan_interface))
            if (iface.inner_vlan_id !== undefined && iface.mac)
                found.push(`interfaces.vlan_interface.${name}.mac beside inner_vlan_id, not tested on a device yet`);

        const taken = new Map(Derive.interfaces(device).map(({ name, kind }) => [name, `interfaces.${kind}.${name}`]));
        for (const port of Catalog.devicePorts(device))
            taken.set(Catalog.spell(device.platform, device.model, port), `interfaces.ethernet.${port}`);
        for (const vlan of RouterOsVlanTags.madeOuter(device)) {
            const holder = taken.get(vlan) ?? RouterOsVlanTags.RESERVED[vlan];
            if (holder)
                found.push(
                    `switching.vlans.${vlan}: RouterOS names the VLAN interface of its outer tag after the VLAN, and ${holder} has that name. Rename one, or write a plain VLAN interface on ${vlan}`
                );
        }

        return found;
    }
}
