import { Derive } from "../../core/derive";
import type { Device, Lag, Port } from "../../model";
import type { JunosNames } from "./names";
import { JunosStatements } from "./statements";

type Switched = Port | Lag;

/** Layer 2 that the switched ports share: VLANs, spanning tree, DHCP snooping with ARP inspection, and RA guard. */
export class JunosSwitching {
    /** The DHCP snooping groups of the ports that trust DHCP servers, and of those that don't. */
    private static readonly DHCP_TRUSTED = "circuit-dhcp-trusted";
    private static readonly DHCP_UNTRUSTED = "circuit-dhcp-untrusted";

    constructor(
        private readonly out: JunosStatements,
        private readonly device: Device,
        private readonly names: JunosNames
    ) {}

    vlans(): void {
        for (const [name, vlan] of Object.entries(this.device.switching?.vlans ?? {})) {
            if (!vlan) continue;

            this.out.set(`vlans ${name} vlan-id`, vlan.id);
            if (vlan.description) this.out.set(`vlans ${name} description`, JunosStatements.quote(vlan.description));

            // A secondary VLAN says what it is, and its primary VLAN names it.
            const secondary = vlan.private_vlan;
            if (!secondary) continue;
            this.out.set(`vlans ${name} private-vlan`, secondary.type);
            this.out.set(`vlans ${secondary.primary}`, secondary.type === "isolated" ? "isolated-vlan" : "community-vlans", name);
        }

        for (const [name, iface] of Object.entries(this.device.interfaces?.vlan_interface ?? {})) {
            if (iface) this.out.set(`vlans ${iface.vlan} l3-interface`, this.names.unit(name));
        }
    }

    /** On every switched port and LAG. RSTP when no mode is given. */
    spanningTree(): void {
        const stp = this.device.switching?.stp;
        if (!stp) return;

        // The platform has no plain STP, so RSTP is held to it.
        const protocol = `protocols ${stp.mode === "mstp" ? "mstp" : "rstp"}`;
        if (stp.mode === "stp") this.out.set(protocol, "force-version stp");
        if (stp.priority !== undefined) this.out.set(protocol, "bridge-priority", stp.priority === 0 ? "0" : `${stp.priority / 1024}k`);

        for (const [name, settings] of this.switched()) {
            const statement = `${protocol} interface ${name}`;
            this.out.set(statement);

            if (settings.stp === false) this.out.set(statement, "disable");
            else if (typeof settings.stp === "object") {
                if (settings.stp.edge) this.out.set(statement, "edge");
                if (settings.stp.cost !== undefined) this.out.set(statement, "cost", settings.stp.cost);
                if (settings.stp.priority !== undefined) this.out.set(statement, "priority", settings.stp.priority);
                if (settings.stp.guard === "root") this.out.set(statement, "no-root-port");
                // BPDU protection on one interface; `bpdu-block-on-edge` would cover every edge port at once.
                if (settings.stp.bpdu_guard) this.out.set("protocols layer2-control bpdu-block interface", name);
            }
        }
    }

    /** DHCP snooping on every VLAN. The platform trusts a trunk and distrusts an access port by default, so each port is named in a group that says which it is. A port trusted for DHCP is trusted by ARP inspection too. */
    dhcpSnooping(): void {
        if (!this.device.switching?.dhcp_snooping) return;

        for (const vlan of this.vlanNames()) {
            const security = `vlans ${vlan} forwarding-options dhcp-security`;
            this.out.set(security);
            if (this.device.switching.arp_inspection) this.out.set(security, "arp-inspection");

            for (const [name, settings] of this.inVlan(vlan)) {
                const group = settings.dhcp_trusted ? JunosSwitching.DHCP_TRUSTED : JunosSwitching.DHCP_UNTRUSTED;
                this.out.set(`${security} group ${group} overrides`, settings.dhcp_trusted ? "trusted" : "untrusted");
                this.out.set(`${security} group ${group} interface`, `${name}.0`);
            }
        }
    }

    /** RA guard on every VLAN, and on each switched port: `block` drops every router advertisement, `trusted` passes them unchecked. */
    raGuard(): void {
        if (!this.device.switching?.ra_guard) return;

        const guard = "forwarding-options access-security router-advertisement-guard";
        for (const vlan of this.vlanNames()) this.out.set(`${guard} vlans`, vlan);
        for (const [name, settings] of this.switched())
            this.out.set(`${guard} interface ${name}.0 mark-interface`, settings.ra_trusted ? "trusted" : "block");
    }

    /** Each switched port and LAG, as the physical interface the platform names: `xe-0/0/1`, `ae1`. A port in a LAG is the LAG. */
    private switched(): [string, Switched][] {
        const ports = Derive.ports(this.device).filter(([, port]) => !port.in_lag && (port.access_vlan || port.trunk_vlans));
        const lags = Object.entries(this.device.interfaces?.lag ?? {}).filter(([, lag]) => lag && (lag.access_vlan || lag.trunk_vlans));
        return [
            ...ports.map(([port, settings]): [string, Switched] => [this.names.port(port), settings]),
            ...lags.map(([name, lag]): [string, Switched] => [this.names.physical(name), lag!]),
        ];
    }

    private vlanNames(): string[] {
        return Object.entries(this.device.switching?.vlans ?? {}).flatMap(([name, vlan]) => (vlan ? [name] : []));
    }

    /** The switched ports and LAGs in a VLAN, its native VLAN too. */
    private inVlan(vlan: string): [string, Switched][] {
        return this.switched().filter(([, settings]) =>
            [settings.access_vlan, settings.native_vlan, ...(settings.trunk_vlans ?? [])].includes(vlan)
        );
    }
}
