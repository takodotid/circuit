// The configuration a VRP device should run, in the form the device prints it.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import { TimeZone } from "../../core/time-zone";
import type { Device, Interface, Port, Vrrp } from "../../schema";
import { Catalog } from "../catalog";
import { Derive } from "../derive";

type AnyPort = Port<string, string, string, string>;
type AnyInterface = Interface<string, string>;
type LagInterface = Extract<AnyInterface, { type: "lag" }>;

/** Builds the configuration as blocks: a header line, its indented lines, then `#`. */
export class VrpRender {
    /** The ACL that guards every management service. */
    private static readonly MANAGEMENT_ACL = 2000;

    /** The OSPF process number. One process per device. */
    private static readonly OSPF_PROCESS = 1;

    /** The sFlow collectors are numbered from here, in the order the config lists them. */
    private static readonly FIRST_COLLECTOR = 1;

    /** The SNMPv3 group every user joins, with read access to everything. */
    private static readonly SNMP_GROUP = "circuit";

    private static readonly USER_LEVEL = { admin: 3, operator: 2, "read-only": 1 } as const;
    private static readonly SNMP_AUTH = { sha1: "sha", sha256: "sha2-256" } as const;
    private static readonly SNMP_PRIVACY = { aes128: "aes128", des: "des56" } as const;

    private readonly lines: string[] = [];
    private readonly vlans: NonNullable<Device["vlans"]>;
    private readonly interfaces: NonNullable<Device["interfaces"]>;
    private readonly lagNumbers: Map<string, number>;

    private constructor(private readonly device: Device) {
        this.vlans = device.vlans ?? {};
        this.interfaces = device.interfaces ?? {};
        this.lagNumbers = Derive.lagIds(device);
    }

    /** The whole configuration the device should run. Secrets appear as markers, never values. */
    static of(device: Device): string {
        return new VrpRender(device).build();
    }

    /** `99 999 to 1000 2000`, the platform's compression of a VLAN list. */
    static vlanBatch(ids: number[]): string {
        const sorted = [...new Set(ids)].sort((a, b) => a - b);
        const ranges: string[] = [];

        for (let i = 0; i < sorted.length; i++) {
            let end = i;
            while (sorted[end + 1] === sorted[end]! + 1) end++;
            ranges.push(i === end ? `${sorted[i]}` : `${sorted[i]} to ${sorted[end]}`);
            i = end;
        }

        return ranges.join(" ");
    }

    private build(): string {
        const device = this.device;

        this.system();
        this.vlanBlocks();
        this.managementAcl();
        this.users();
        this.vrfs();

        for (const [name, lag] of Object.entries(this.interfaces)) {
            if (lag.type === "lag") this.block(`interface ${this.nameOf(name)}`, [...VrpRender.lagMode(lag), ...this.switching(lag)]);
        }

        for (const [name, iface] of Object.entries(this.interfaces)) {
            if (iface.type === "vlan") this.block(`interface ${this.nameOf(name)}`, this.vlanInterface(name, iface));
        }

        for (const port of Catalog.ports(device.platform, device.model)) {
            const settings = device.ports?.[port as keyof typeof device.ports];
            this.block(`interface ${this.nameOf(port)}`, this.physicalPort(port, settings));
        }

        this.staticRoutes();
        this.ospf();
        if (this.wantsBfd()) this.block("bfd", []);
        if (device.dhcp_relay && Object.keys(device.dhcp_relay).length) {
            this.line("dhcp enable");
            this.separator();
        }

        this.flowExport();
        this.snmp();
        this.ssh();
        this.userInterfaces();
        return this.text();
    }

    private line(text: string): void {
        this.lines.push(text);
    }

    /** A header and its lines. A block with nothing in it is still written, so that its header exists. */
    private block(header: string, body: string[]): void {
        this.lines.push(header, ...body.map((text) => ` ${text}`), "#");
    }

    private separator(): void {
        this.lines.push("#");
    }

    private text(): string {
        return this.lines.join("\n") + "\n";
    }

    private vlanId(name: string): number {
        return this.vlans[name]!.id;
    }

    /** What the platform calls a port, a LAG or a VLAN interface. */
    private nameOf(portOrInterface: string): string {
        const iface = this.interfaces[portOrInterface];
        if (iface?.type === "lag") return `Eth-Trunk${this.lagNumbers.get(portOrInterface)}`;

        if (iface?.type === "vlan") return `Vlanif${this.vlanId(iface.vlan)}`;

        return Catalog.spell(this.device.platform, this.device.model, portOrInterface);
    }

    private system(): void {
        const device = this.device;

        this.line(`sysname ${device.name}`);
        this.separator();

        const timezone = device.system?.timezone;
        if (timezone) {
            const minutes = TimeZone.offset(timezone);
            const absolute = Math.abs(minutes);
            const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
            const remainder = String(absolute % 60).padStart(2, "0");
            // The platform names the zone with one word; the last part of the IANA name serves.
            this.line(`clock timezone ${timezone.split("/").at(-1)} ${minutes < 0 ? "minus" : "add"} ${hours}:${remainder}:00`);
            this.separator();
        }

        const stp = device.stp;
        if (!stp) this.line("stp disable");
        else {
            // MSTP is the platform's default and is not written.
            if (stp.mode && stp.mode !== "mstp") this.line(`stp mode ${stp.mode}`);
            if (stp.priority !== undefined) this.line(`stp priority ${stp.priority}`);
        }
        // LLDP is off by default and turned on by the config.
        if (device.lldp) this.line("lldp enable");
        this.separator();

        const ntp = device.system?.ntp;
        if (!ntp?.serve) {
            this.line("ntp server disable");
            this.line("ntp ipv6 server disable");
        }

        for (const server of ntp?.servers ?? []) this.line(`ntp unicast-server ${server}`);
        this.separator();

        const ids = Object.values(device.vlans ?? {}).map((vlan) => vlan.id);
        if (ids.length) {
            this.line(`vlan batch ${VrpRender.vlanBatch(ids)}`);
            this.separator();
        }

        if (!device.management?.telnet) {
            this.line("telnet server disable");
            this.line("telnet ipv6 server disable");
            this.separator();
        }
    }

    private vlanBlocks(): void {
        for (const [name, vlan] of Object.entries(this.device.vlans ?? {})) {
            this.block(`vlan ${vlan.id}`, [`name ${name}`, ...(vlan.description ? [`description ${vlan.description}`] : [])]);
        }
    }

    /** One ACL guards every management service: a permit per source, then an explicit deny. */
    private managementAcl(): void {
        const allow = this.device.management?.allow ?? [];
        if (!allow.length) return;

        const rules = allow.map(
            (cidr, index) => `rule ${(index + 1) * 5} permit source ${Address.host(cidr)} ${Address.wildcard(Address.split(cidr).len)}`
        );
        this.block(`acl number ${VrpRender.MANAGEMENT_ACL}`, [
            "description Management access",
            ...rules,
            `rule ${(allow.length + 1) * 5} deny`,
        ]);
    }

    private users(): void {
        const lines: string[] = [];

        for (const [name, user] of Object.entries(this.device.users ?? {})) {
            lines.push(`local-user ${name} password irreversible-cipher ${Secrets.marker(user.password)}`);
            lines.push(`local-user ${name} service-type ssh`);
            lines.push(`local-user ${name} level ${VrpRender.USER_LEVEL[user.role]}`);
        }

        this.block("aaa", lines);
    }

    private vrfs(): void {
        for (const name of Object.keys(this.device.vrfs ?? {})) this.block(`ip vpn-instance ${name}`, ["ipv4-family"]);
    }

    private static lagMode(lag: LagInterface): string[] {
        const lines = [lag.mode === "static" ? "mode manual load-balance" : "mode lacp-static"];
        if (lag.description) lines.unshift(`description ${lag.description}`);
        return lines;
    }

    /** Layer 2 membership of a port or LAG. */
    private switching(settings: AnyPort | LagInterface): string[] {
        const lines: string[] = [];
        if (settings.access_vlan) lines.push(`port default vlan ${this.vlanId(settings.access_vlan)}`);
        if (settings.trunk_vlans) {
            lines.push("port link-type trunk");
            if (settings.native_vlan) lines.push(`port trunk pvid vlan ${this.vlanId(settings.native_vlan)}`);
            // VLAN 1 is allowed by default and never wanted. The native VLAN has to be allowed too, or its untagged frames are dropped.
            const allowed = [...settings.trunk_vlans, ...(settings.native_vlan ? [settings.native_vlan] : [])].map((name) =>
                this.vlanId(name)
            );
            lines.push("undo port trunk allow-pass vlan 1");
            lines.push(`port trunk allow-pass vlan ${VrpRender.vlanBatch(allowed)}`);
        }

        if (settings.stp === false) lines.push("stp disable");
        else if (typeof settings.stp === "object") {
            if (settings.stp.edge) lines.push("stp edged-port enable");
            if (settings.stp.cost !== undefined) lines.push(`stp cost ${settings.stp.cost}`);
            if (settings.stp.priority !== undefined) lines.push(`stp port priority ${settings.stp.priority}`);
        }

        const storm = settings.storm_control;
        if (storm) {
            const kinds = [
                ["broadcast", storm.broadcast],
                ["multicast", storm.multicast],
                ["unknown-unicast", storm.unknown_unicast],
            ] as const;

            for (const [kind, threshold] of kinds) {
                if (!threshold || !("percent" in threshold)) continue;

                const percent = threshold.percent;
                lines.push(`storm control ${kind} min-rate percent ${percent} max-rate percent ${percent}`);
            }

            lines.push("storm control action suppress", "storm control enable trap", "storm control enable log");
        }

        return lines;
    }

    private static vrrpLines(group: Vrrp): string[] {
        const lines = [`vrrp vrid ${group.id} virtual-ip ${group.address}`];
        if (group.priority !== undefined) lines.push(`vrrp vrid ${group.id} priority ${group.priority}`);
        // The platform preempts by default; the config only does when asked.
        if (!group.preempt) lines.push(`vrrp vrid ${group.id} preempt disable`);
        if (group.interval !== undefined && group.interval !== 1) lines.push(`vrrp vrid ${group.id} timer advertise ${group.interval}`);
        return lines;
    }

    private vlanInterface(name: string, iface: Extract<AnyInterface, { type: "vlan" }>): string[] {
        const device = this.device;
        const lines: string[] = [];
        if (iface.description) lines.push(`description ${iface.description}`);
        // Binding to a VRF clears the addresses, so it comes first.
        if (iface.vrf) lines.push(`ip binding vpn-instance ${iface.vrf}`);

        for (const entry of iface.addresses ?? []) {
            const address = typeof entry === "string" ? entry : entry.address;
            if (Address.family(address) === "ipv4")
                lines.push(`ip address ${Address.host(address)} ${Address.netmask(Address.split(address).len)}`);
            else lines.push(`ipv6 address ${address}`);
        }

        for (const group of iface.vrrp ?? []) lines.push(...VrpRender.vrrpLines(group));

        const relays = Object.values(device.dhcp_relay ?? {}).filter((relay) => relay.interface === name);
        if (relays.length) {
            lines.push("dhcp select relay");
            for (const server of relays.flatMap((relay) => relay.servers)) lines.push(`dhcp relay binding server ip ${server}`);
        }

        for (const area of Object.values(device.routing?.ospf?.areas ?? {})) {
            const settings = area.interfaces[name as keyof typeof area.interfaces];
            if (!settings) continue;

            if (settings.cost !== undefined) lines.push(`ospf cost ${settings.cost}`);
            if (settings.network === "point-to-point") lines.push("ospf network-type p2p");
            if (settings.bfd) lines.push("ospf bfd enable");
        }

        return lines;
    }

    /** A port the config does not declare is shut down. A LAG member holds only its membership. */
    private physicalPort(port: string, settings: AnyPort | undefined): string[] {
        if (!settings) return ["shutdown"];

        // A port joins a LAG only while it holds no other setting, so membership comes before its description.
        if (settings.lag) {
            const membership = `eth-trunk ${this.lagNumbers.get(settings.lag)}`;
            return settings.description ? [membership, `description ${settings.description}`] : [membership];
        }

        const lines: string[] = [];
        if (settings.description) lines.push(`description ${settings.description}`);
        lines.push(...this.switching(settings));
        if (settings.lldp === false) lines.push("lldp disable");

        const flow = this.device.flow_export;
        const observed = flow?.protocol === "sflow" && (!flow.interfaces || flow.interfaces.includes(port));
        if (observed) {
            for (let index = 0; index < flow!.collectors.length; index++)
                lines.push(`sflow sampling collector ${VrpRender.FIRST_COLLECTOR + index}`);
            lines.push(`sflow sampling rate ${flow!.sampling}`);
            lines.push("sflow sampling inbound");
        }

        return lines;
    }

    private staticRoutes(): void {
        for (const route of this.device.routing?.static ?? []) {
            const { addr, len } = Address.split(route.prefix);
            const nextHop = route.blackhole ? "NULL0" : (route.via ?? this.nameOf(route.interface!));
            const vrf = route.vrf ? ` vpn-instance ${route.vrf}` : "";
            const preference = route.distance ? ` preference ${route.distance}` : "";
            const description = route.description ? ` description ${route.description}` : "";
            if (Address.family(addr) === "ipv4")
                this.line(`ip route-static${vrf} ${addr} ${Address.netmask(len)} ${nextHop}${preference}${description}`);
            else this.line(`ipv6 route-static${vrf} ${addr} ${len} ${nextHop}${preference}`);
        }

        this.separator();
    }

    /**
     * OSPF for IPv4. An area announces the networks of its interfaces; a passive interface is silent. `unsupported()` refuses IPv6.
     */
    private ospf(): void {
        const device = this.device;
        const ospf = device.routing?.ospf;
        if (!ospf) return;

        const routerId = device.routing?.router_id;
        const lines: string[] = [];
        for (const source of ospf.redistribute ?? []) lines.push(`import-route ${source === "connected" ? "direct" : "static"}`);

        const areaLines: string[] = [];

        for (const [areaId, area] of Object.entries(ospf.areas)) {
            areaLines.push(`area ${areaId}`);

            for (const [iface, settings] of Object.entries(area.interfaces)) {
                if (settings?.passive) lines.push(`silent-interface ${this.nameOf(iface)}`);
                for (const prefix of Derive.ipv4Networks(device, iface))
                    areaLines.push(` network ${Address.host(prefix)} ${Address.wildcard(Address.split(prefix).len)}`);
            }
        }

        this.block(`ospf ${VrpRender.OSPF_PROCESS}${routerId ? ` router-id ${routerId}` : ""}`, [...lines, ...areaLines]);
    }

    private wantsBfd(): boolean {
        const areas = Object.values(this.device.routing?.ospf?.areas ?? {});
        return areas.some((area) => Object.values(area.interfaces).some((settings) => settings?.bfd));
    }

    /** sFlow from the management address, to each collector in order. */
    private flowExport(): void {
        const device = this.device;
        const flow = device.flow_export;
        if (flow?.protocol !== "sflow") return;

        if (device.connection.host) this.line(`sflow agent ip ${device.connection.host}`);

        flow.collectors.forEach((collector, index) => {
            const number = VrpRender.FIRST_COLLECTOR + index;
            this.line(`sflow collector ${number} ip ${collector.address} udp-port ${collector.port ?? 6343}`);
        });

        this.separator();
    }

    /** SNMP version 2c with one read community, version 3 with users in one read-only group, or both. */
    private snmp(): void {
        const device = this.device;
        const snmp = device.management?.snmp;
        if (!snmp) return;

        const versions = [snmp.community ? "v2c" : "", snmp.users ? "v3" : ""].filter(Boolean).join(" ");
        const guarded = (device.management?.allow?.length ?? 0) > 0;
        const acl = guarded ? ` acl ${VrpRender.MANAGEMENT_ACL}` : "";

        this.line("snmp-agent");
        this.line(`snmp-agent sys-info version ${versions}`);
        if (snmp.contact) this.line(`snmp-agent sys-info contact ${snmp.contact}`);
        if (snmp.location) this.line(`snmp-agent sys-info location ${snmp.location}`);
        if (snmp.community) this.line(`snmp-agent community read cipher ${Secrets.marker(snmp.community)}${acl}`);
        if (snmp.users) {
            this.line("snmp-agent mib-view included all iso");
            this.line(`snmp-agent group v3 ${VrpRender.SNMP_GROUP} privacy read-view all${acl}`);

            for (const [name, user] of Object.entries(snmp.users)) {
                // The switch prints a user's own line before its settings.
                this.line(`snmp-agent usm-user v3 ${name}`);
                this.line(`snmp-agent usm-user v3 ${name} group ${VrpRender.SNMP_GROUP}`);
                this.line(
                    `snmp-agent usm-user v3 ${name} authentication-mode ${VrpRender.SNMP_AUTH[user.auth]} cipher ${Secrets.marker(user.auth_password)}`
                );
                this.line(
                    `snmp-agent usm-user v3 ${name} privacy-mode ${VrpRender.SNMP_PRIVACY[user.privacy]} cipher ${Secrets.marker(user.privacy_password)}`
                );
            }
        }

        this.separator();
    }

    private ssh(): void {
        const device = this.device;
        const ssh = device.management?.ssh;
        if (!ssh) return;

        const guarded = (device.management?.allow?.length ?? 0) > 0;

        this.line("stelnet server enable");

        for (const user of Object.keys(device.users ?? {})) {
            this.line(`ssh user ${user}`);
            this.line(`ssh user ${user} authentication-type password`);
            this.line(`ssh user ${user} service-type stelnet`);
        }

        if (guarded) this.line(`ssh server acl ${VrpRender.MANAGEMENT_ACL}`);
        // Who decides whether a login is allowed: AAA, the same place for every service.
        this.line("ssh authorization-type default aaa");
        this.separator();

        if (!ssh.weak_crypto) {
            this.line("ssh server cipher aes256_ctr aes128_ctr");
            this.line("ssh server hmac sha2_256_96 sha2_256");
            this.line("ssh server key-exchange dh_group_exchange_sha256 ecdh_sha2_nistp256 ecdh_sha2_nistp384 ecdh_sha2_nistp521");
            this.separator();
        }
    }

    /** The console logs in with the device's users unless the config gives it a password of its own. Remote logins always use the users. */
    private userInterfaces(): void {
        const device = this.device;
        const console = device.management?.console;

        const consoleLogin = console
            ? ["authentication-mode password", `set authentication password cipher ${Secrets.marker(console.password)}`]
            : ["authentication-mode aaa"];

        this.block("user-interface con 0", consoleLogin);
        this.block("user-interface vty 0 4", ["authentication-mode aaa", `protocol inbound ${device.management?.telnet ? "all" : "ssh"}`]);
    }
}
