import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import type { Device } from "../../model";

/** What the platform calls a port, a LAG, a VLAN interface, a loopback, or a tunnel. */
export class JunosNames {
    readonly lags: Map<string, number>;
    readonly loopbacks = new Map<string, number>();
    readonly tunnels = new Map<string, number>();

    constructor(private readonly device: Device) {
        this.lags = Derive.lagIds(device);

        // The default table's loopback is unit 0, and one in a VRF takes the next unit.
        const loopbacks = Derive.interfaces(device).filter((entry) => entry.kind === "loopback");
        let unit = 0;

        for (const { name, settings } of loopbacks) if (!settings.vrf) this.loopbacks.set(name, 0);

        for (const { name, settings } of loopbacks) if (settings.vrf) this.loopbacks.set(name, ++unit);

        // GRE tunnels are units of the one tunnel interface, in order.
        const tunnels = Derive.interfaces(device).filter((entry) => entry.kind === "gre");
        tunnels.forEach(({ name }, index) => this.tunnels.set(name, index));
    }

    /** A 10G cage holding a 1G optic is `ge-`, not `xe-`. */
    port(port: string): string {
        const name = Catalog.spell(this.device.platform, this.device.model, port);
        const settings = this.device.interfaces?.ethernet?.[port];
        return settings?.speed === "1g" ? name.replace(/^xe-/, "ge-") : name;
    }

    /** The physical interface a port or a LAG is: `xe-0/0/1`, `ae1`. */
    physical(name: string): string {
        if (this.device.interfaces?.lag?.[name]) return `ae${this.lags.get(name)}`;

        return this.port(name);
    }

    /** The logical interface that holds addresses: `xe-0/0/1.0`, `ae1.0`, `irb.10`, `lo0.0`. */
    unit(name: string): string {
        const vlanInterface = this.device.interfaces?.vlan_interface?.[name];
        if (vlanInterface) return `irb.${this.device.switching!.vlans![vlanInterface.vlan]!.id}`;

        if (this.device.interfaces?.loopback?.[name]) return `lo0.${this.loopbacks.get(name)}`;

        if (this.device.interfaces?.gre?.[name]) return `gr-0/0/0.${this.tunnels.get(name)}`;

        return `${this.physical(name)}.0`;
    }

    /** The physical ports behind a port or a LAG. */
    members(name: string): string[] {
        if (!this.device.interfaces?.lag?.[name]) return [this.port(name)];

        const ports = Derive.ports(this.device).filter(([, settings]) => settings.in_lag === name);
        return ports.map(([port]) => this.port(port));
    }
}
