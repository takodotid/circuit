import { Derive } from "../../core/derive";
import type { Device, Lag, Port } from "../../model";
import type { JunosNames } from "./names";
import { JunosStatements } from "./statements";

type Switched = Port | Lag;

/** Layer 2 that the switched ports share: VLANs, QinQ, spanning tree, DHCP snooping with ARP inspection, and RA guard. */
export class JunosSwitching {
    /** The DHCP snooping groups of the ports that trust DHCP servers, and of those that don't. */
    private static readonly DHCP_TRUSTED = "circuit-dhcp-trusted";
    private static readonly DHCP_UNTRUSTED = "circuit-dhcp-untrusted";

    /** Every VLAN ID, so a QinQ port takes whatever a customer tags. */
    private static readonly ANY_VLAN = "1-4094";

    /** Settings that go on unit 0, so they would miss a QinQ VLAN's unit. */
    private static readonly UNIT_ZERO_ONLY = ["storm_control", "mac_limit", "ethertypes", "ingress_acl"] as const;

    /** The VLANs some port or LAG puts customers' frames in with `qinq_vlan`. */
    private readonly qinqVlans: Set<string>;

    constructor(
        private readonly out: JunosStatements,
        private readonly device: Device,
        private readonly names: JunosNames
    ) {
        this.qinqVlans = JunosSwitching.qinqVlansOf(device);
    }

    private static qinqVlansOf(device: Device): Set<string> {
        return new Set(Derive.switchedHolders(device).flatMap(({ settings }) => (settings.qinq_vlan ? [settings.qinq_vlan] : [])));
    }

    /** A QinQ VLAN has no ID of its own here: each port joins it with a unit of its own (TRAPS.md). So no access port, native VLAN, or unit 0 setting goes with one. */
    static gaps(device: Device): string[] {
        const found: string[] = [];
        const qinq = JunosSwitching.qinqVlansOf(device);

        const { tpid, innerVlans } = Derive.stackedTags(device);
        for (const where of tpid) found.push(`${where} 0x88a8, which Junos 21.4 on a QFX5100 can't set: Juniper lists it from 22.4R1`);
        for (const where of innerVlans) found.push(`${where}, which only RouterOS builds for now`);

        // A trunk with a native VLAN passes `commit check` with translation, but with a warning that it shouldn't (TRAPS.md).
        for (const { where, settings } of Derive.switchedHolders(device)) {
            const translations = settings.vlan_translation ?? [];
            if (translations.length && settings.native_vlan)
                found.push(`${where}.vlan_translation beside native_vlan, which the switch warns a trunk should not have`);
            for (const { to } of translations)
                if (qinq.has(to)) found.push(`${where}.vlan_translation to ${to}, a QinQ VLAN, which a trunk joins on a unit of its own`);
        }
        if (!qinq.size) return found;

        for (const { where, settings } of Derive.switchedHolders(device)) {
            for (const field of ["access_vlan", "native_vlan"] as const) {
                const vlan = settings[field];
                if (vlan && qinq.has(vlan))
                    found.push(`${where}.${field} ${vlan}, a QinQ VLAN, which only QinQ ports and trunks join here`);
            }

            if (!settings.qinq_vlan && !settings.trunk_vlans?.some((vlan) => qinq.has(vlan))) continue;
            for (const field of JunosSwitching.UNIT_ZERO_ONLY)
                if ((settings as Port)[field] !== undefined) found.push(`${where}.${field} beside a QinQ VLAN, whose unit it would miss`);
        }

        return found;
    }

    vlans(): void {
        for (const [name, vlan] of Object.entries(this.device.switching?.vlans ?? {})) {
            if (!vlan) continue;

            if (!this.qinqVlans.has(name)) this.out.set(`vlans ${name} vlan-id`, vlan.id);
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

    /**
     * A port joins each QinQ VLAN with a unit numbered after the VLAN's ID. On a QinQ port, the unit takes any tag and pushes the VLAN's on top. On a trunk, it carries frames with the VLAN's tag beside unit 0's VLANs. Returns the trunk's other VLANs, for unit 0.
     */
    qinq(physical: string, settings: Switched): readonly string[] {
        const trunk = settings.trunk_vlans ?? [];
        const tunneled = settings.qinq_vlan ? [settings.qinq_vlan] : trunk.filter((vlan) => this.qinqVlans.has(vlan));
        if (!tunneled.length) return trunk;

        this.out.set(`interfaces ${physical} flexible-vlan-tagging`);
        this.out.set(`interfaces ${physical} encapsulation`, settings.qinq_vlan ? "extended-vlan-bridge" : "flexible-ethernet-services");

        for (const vlan of tunneled) {
            const id = this.device.switching!.vlans![vlan]!.id;
            const unit = `interfaces ${physical} unit ${id}`;

            if (settings.qinq_vlan) {
                this.out.set(unit, "vlan-id-list", JunosSwitching.ANY_VLAN);
                this.out.set(unit, "input-vlan-map push");
                this.out.set(unit, "output-vlan-map pop");
            } else {
                this.out.set(unit, "encapsulation vlan-bridge");
                this.out.set(unit, "vlan-id", id);
            }
            this.out.set(`vlans ${vlan} interface`, `${physical}.${id}`);
        }

        return trunk.filter((vlan) => !this.qinqVlans.has(vlan));
    }

    /** On every switched port and LAG, its QinQ ports too. RSTP when no mode is given. */
    spanningTree(): void {
        const stp = this.device.switching?.stp;
        if (!stp) return;

        // The platform has no plain STP, so RSTP is held to it.
        const protocol = `protocols ${stp.mode === "mstp" ? "mstp" : "rstp"}`;
        if (stp.mode === "stp") this.out.set(protocol, "force-version stp");
        if (stp.priority !== undefined) this.out.set(protocol, "bridge-priority", stp.priority === 0 ? "0" : `${stp.priority / 1024}k`);

        for (const [name, settings] of this.bridged()) {
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

    /** DHCP snooping on every VLAN but the QinQ ones. The platform trusts a trunk and distrusts an access port by default, so each port is named in a group that says which it is. A port trusted for DHCP is trusted by ARP inspection too. */
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

    /** RA guard on every VLAN but the QinQ ones, and on each port with a unit 0: `block` drops every router advertisement, `trusted` passes them unchecked. */
    raGuard(): void {
        if (!this.device.switching?.ra_guard) return;

        const guard = "forwarding-options access-security router-advertisement-guard";
        for (const vlan of this.vlanNames()) this.out.set(`${guard} vlans`, vlan);
        for (const [name, settings] of this.switched())
            this.out.set(`${guard} interface ${name}.0 mark-interface`, settings.ra_trusted ? "trusted" : "block");
    }

    /** Each port and LAG in a VLAN, as the physical interface the platform names: `xe-0/0/1`, `ae1`. A port in a LAG is the LAG. */
    private bridged(): [string, Switched][] {
        const ports = Derive.ports(this.device).filter(
            ([, port]) => !port.in_lag && (port.access_vlan || port.trunk_vlans || port.qinq_vlan)
        );
        const lags = Object.entries(this.device.interfaces?.lag ?? {}).filter(
            ([, lag]) => lag && (lag.access_vlan || lag.trunk_vlans || lag.qinq_vlan)
        );
        return [
            ...ports.map(([port, settings]): [string, Switched] => [this.names.port(port), settings]),
            ...lags.map(([name, lag]): [string, Switched] => [this.names.physical(name), lag!]),
        ];
    }

    /** The ports and LAGs with a unit 0 in `ethernet-switching`: in an access VLAN, or in a trunk VLAN that is not QinQ. */
    private switched(): [string, Switched][] {
        return this.bridged().filter(
            ([, settings]) =>
                settings.access_vlan || settings.native_vlan || settings.trunk_vlans?.some((vlan) => !this.qinqVlans.has(vlan))
        );
    }

    private vlanNames(): string[] {
        return Object.entries(this.device.switching?.vlans ?? {}).flatMap(([name, vlan]) =>
            vlan && !this.qinqVlans.has(name) ? [name] : []
        );
    }

    /** The ports and LAGs with a unit 0 in a VLAN, its native VLAN too. */
    private inVlan(vlan: string): [string, Switched][] {
        return this.switched().filter(([, settings]) =>
            [settings.access_vlan, settings.native_vlan, ...(settings.trunk_vlans ?? [])].includes(vlan)
        );
    }
}
