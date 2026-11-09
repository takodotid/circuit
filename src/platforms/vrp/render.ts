// The configuration a VRP device should run, in the form the device prints it.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import { Utils } from "../../core/utils";
import type { Device, Lag, Port, VlanInterface, Vrrp } from "../../model";
import { Catalog } from "../catalog";
import { Derive } from "../derive";

/** Builds the configuration as blocks: a header line, its indented lines, then `#`. */
export class VrpRender {
    /** The ACL that guards every management service. */
    private static readonly MANAGEMENT_ACL = 2000;

    /** The ACL that guards SNMP when it has sources of its own. */
    private static readonly SNMP_ACL = 2001;

    /** The channel that writes the log files on the device's own storage. */
    private static readonly LOGFILE_CHANNEL = 9;

    /** How many log files the device keeps when the config sets none. It is not printed. */
    private static readonly LOGFILES_DEFAULT = 200;

    /** The BFD multiplier the device uses when the config sets none. It is not printed. */
    private static readonly BFD_MULTIPLIER = 3;

    /** The syslog port the device uses when the config sets none. It is not printed. */
    private static readonly SYSLOG_PORT = 514;

    /** A severity as the platform spells it. `debugging` is the default for a log host and for the log files, and is not printed. */
    private static readonly LOG_LEVEL = {
        emergency: "emergencies",
        alert: "alert",
        critical: "critical",
        error: "error",
        warning: "warning",
        notice: "notification",
        info: "informational",
        debug: "debugging",
    } as const;

    /** The OSPF process number. One process per device. */
    private static readonly OSPF_PROCESS = 1;

    /** The sFlow collectors are numbered from here, in the order the config lists them. */
    private static readonly FIRST_COLLECTOR = 1;

    /** The SNMPv3 group every user joins, with read access to everything. */
    private static readonly SNMP_GROUP = "circuit";

    /** An alarm severity as the platform prints it. */
    private static readonly ALARM_SEVERITY = { critical: "Critical", major: "Major", minor: "Minor", warning: "Warning" } as const;

    private static readonly USER_LEVEL = { admin: 3, operator: 2, "read-only": 1 } as const;
    private static readonly SNMP_AUTH = { sha1: "sha", sha256: "sha2-256" } as const;
    private static readonly SNMP_PRIVACY = { aes128: "aes128", des: "des56" } as const;

    /** Layer 2 ACLs, one for each set of ethertypes a port takes, are numbered from here. */
    private static readonly FIRST_L2_ACL = 4000;

    /** An ethertype as the platform prints it in a layer 2 ACL rule: `0x0800` prints as `type ip`. */
    private static readonly ETHERTYPE = { ipv4: "ip", ipv6: "ipv6", arp: "arp" } as const;

    private readonly lines: string[] = [];
    private readonly vlans: NonNullable<NonNullable<Device["switching"]>["vlans"]>;
    private readonly lags: NonNullable<NonNullable<Device["interfaces"]>["lag"]>;
    private readonly vlanInterfaces: NonNullable<NonNullable<Device["interfaces"]>["vlan_interface"]>;
    private readonly lagNumbers: Map<string, number>;
    /** The layer 2 ACL of each set of ethertypes the ports take, by the set written as `ipv4 ipv6 arp`. */
    private readonly ethertypeAcls = new Map<string, number>();

    private constructor(private readonly device: Device) {
        this.vlans = device.switching?.vlans ?? {};
        this.lags = device.interfaces?.lag ?? {};
        this.vlanInterfaces = device.interfaces?.vlan_interface ?? {};
        this.lagNumbers = Derive.lagIds(device);

        for (const [, port] of Derive.ports(device)) {
            const key = port.ethertypes?.join(" ");
            if (key && !this.ethertypeAcls.has(key)) this.ethertypeAcls.set(key, VrpRender.FIRST_L2_ACL + this.ethertypeAcls.size);
        }
    }

    /** The whole configuration the device should run. Secrets appear as markers, never values. */
    static of(device: Device): string {
        return new VrpRender(device).build();
    }

    /** `99 999 to 1000 2000`, the platform's compression of a VLAN list. */
    /** `management.allow` as a list. The project turns an address set named there into its addresses before rendering. */
    static managementAllow(device: Device): readonly string[] {
        const allow = device.management?.allow ?? [];
        if (typeof allow === "string") throw new Error(`management.allow names the address set ${allow}, not its addresses`);
        return allow;
    }

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
        this.snmpAcl();
        this.ethertypeAclBlocks();
        this.users();
        this.vrfs();

        for (const [name, lag] of Object.entries(this.lags)) {
            if (lag) this.block(`interface ${this.nameOf(name)}`, [...VrpRender.lagMode(lag), ...this.switching(lag)]);
        }

        for (const [name, iface] of Object.entries(this.vlanInterfaces)) {
            if (iface) this.block(`interface ${this.nameOf(name)}`, this.vlanInterface(name, iface));
        }

        for (const port of Catalog.ports(device.platform, device.model)) {
            this.block(`interface ${this.nameOf(port)}`, this.physicalPort(port, device.interfaces?.ethernet?.[port]));
        }

        this.staticRoutes();
        this.ospf();
        if (this.wantsBfd()) this.block("bfd", []);
        const relays = device.services?.dhcp_relay;
        if (relays && Object.keys(relays).length) {
            this.line("dhcp enable");
            this.separator();
        }

        this.flowExport();
        this.logging();
        this.alarms();
        this.snmp();
        this.ssh();
        this.userInterfaces();
        return this.text();
    }

    /** The longest name a key takes. */
    static readonly KEY_NAME = 30;

    /** How long each line of a key's text is sent: the CLI refuses a whole RSA key on one line, and takes 200 characters. */
    static readonly KEY_LINE = 200;

    /** What the switch writes after a key that came without a comment. */
    static readonly KEY_COMMENT = "rsa-key";

    /** The lines that put a key block on the switch: its text sent in lines the CLI takes, without the comment the switch adds. */
    static keyLines(block: readonly string[]): string[] {
        const [header = "", , ...rest] = block;
        const text = rest
            .slice(0, -2)
            .map((line) => line.trim())
            .join("")
            .replace(new RegExp(`\\s*${VrpRender.KEY_COMMENT}$`), "");
        const [type = "", blob = ""] = text.split(/\s+/);
        const whole = `${type} ${blob}`;
        return [
            header,
            "public-key-code begin",
            ...(whole.match(new RegExp(`.{1,${VrpRender.KEY_LINE}}`, "g")) ?? []),
            "public-key-code end",
            "peer-public-key end",
        ];
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
        if (this.lags[portOrInterface]) return `Eth-Trunk${this.lagNumbers.get(portOrInterface)}`;

        const vlanInterface = this.vlanInterfaces[portOrInterface];
        if (vlanInterface) return `Vlanif${this.vlanId(vlanInterface.vlan)}`;

        return Catalog.spell(this.device.platform, this.device.model, portOrInterface);
    }

    private system(): void {
        const device = this.device;

        this.line(`sysname ${device.name}`);
        this.separator();

        const timezone = device.system?.timezone;
        if (timezone) {
            const minutes = Utils.timeZoneOffset(timezone);
            const absolute = Math.abs(minutes);
            const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
            const remainder = String(absolute % 60).padStart(2, "0");
            // The platform names the zone with one word; the last part of the IANA name serves.
            this.line(`clock timezone ${timezone.split("/").at(-1)} ${minutes < 0 ? "minus" : "add"} ${hours}:${remainder}:00`);
            this.separator();
        }

        const stp = device.switching?.stp;
        if (!stp) this.line("stp disable");
        else {
            // MSTP is the platform's default and is not written.
            if (stp.mode && stp.mode !== "mstp") this.line(`stp mode ${stp.mode}`);
            if (stp.priority !== undefined) this.line(`stp priority ${stp.priority}`);
        }
        // LLDP is off by default and turned on by the config.
        if (device.switching?.lldp) this.line("lldp enable");
        this.separator();

        if (!device.services?.ntp_server) {
            this.line("ntp server disable");
            this.line("ntp ipv6 server disable");
        }

        // A server written with its length is written as the address alone.
        for (const server of device.system?.ntp?.servers ?? []) this.line(`ntp unicast-server ${Address.host(server)}`);
        this.separator();

        const ids = Object.values(this.vlans).flatMap((vlan) => (vlan ? [vlan.id] : []));
        if (ids.length) {
            this.line(`vlan batch ${VrpRender.vlanBatch(ids)}`);
            this.separator();
        }

        // A user's key, named after the user, as the switch prints it: its text in lines of 80, ending with the name it gives it.
        for (const [user, settings] of Object.entries(device.system?.users ?? {})) {
            const [key] = settings?.ssh_keys ?? [];
            if (!key) continue;

            const [type, blob = ""] = key.trim().split(/\s+/);
            const lines = `${type} ${blob}`.match(/.{1,80}/g) ?? [];
            this.line(`rsa peer-public-key ${user} encoding-type openssh`);
            this.line(" public-key-code begin");
            lines.forEach((part, index) => this.line(`  ${part}${index === lines.length - 1 ? ` ${VrpRender.KEY_COMMENT}` : ""}`));
            this.line(" public-key-code end");
            this.line(" peer-public-key end");
            this.separator();
        }

        if (!device.management?.telnet) {
            this.line("telnet server disable");
            this.line("telnet ipv6 server disable");
            this.separator();
        }
    }

    private vlanBlocks(): void {
        for (const [name, vlan] of Object.entries(this.vlans)) {
            if (!vlan) continue;
            this.block(`vlan ${vlan.id}`, [`name ${name}`, ...(vlan.description ? [`description ${vlan.description}`] : [])]);
        }
    }

    /** One ACL guards every management service: a permit per source, then an explicit deny. */
    private managementAcl(): void {
        const allow = VrpRender.managementAllow(this.device);
        if (!allow.length) return;

        this.block(`acl number ${VrpRender.MANAGEMENT_ACL}`, ["description Management access", ...VrpRender.aclRules(allow)]);
    }

    /** SNMP with sources of its own gets an ACL of its own, built the same way. */
    private ethertypeAclBlocks(): void {
        for (const [key, number] of this.ethertypeAcls) {
            const kinds = key.split(" ") as (keyof typeof VrpRender.ETHERTYPE)[];
            const rules = kinds.map((kind, index) => `rule ${(index + 1) * 5} permit type ${VrpRender.ETHERTYPE[kind]}`);
            this.block(`acl number ${number}`, [...rules, `rule ${(kinds.length + 1) * 5} deny`]);
        }
    }

    private snmpAcl(): void {
        const allow = this.device.monitoring?.snmp?.allow ?? [];
        if (!allow.length) return;

        this.block(`acl number ${VrpRender.SNMP_ACL}`, ["description SNMP access", ...VrpRender.aclRules(allow)]);
    }

    /** A permit per source, then an explicit deny. The platform prints the wildcard of a single address as `0`. */
    private static aclRules(allow: readonly string[]): string[] {
        const rules = allow.map((cidr, index) => {
            const length = Address.split(cidr).len;
            const wildcard = length === 32 ? "0" : Address.wildcard(length);
            return `rule ${(index + 1) * 5} permit source ${Address.host(cidr)} ${wildcard}`;
        });

        return [...rules, `rule ${(allow.length + 1) * 5} deny`];
    }

    private users(): void {
        const lines: string[] = [];

        for (const [name, user] of Object.entries(this.device.system?.users ?? {})) {
            if (!user) continue;
            lines.push(`local-user ${name} password irreversible-cipher ${Secrets.marker(user.password)}`);
            lines.push(`local-user ${name} service-type ssh`);
            lines.push(`local-user ${name} level ${VrpRender.USER_LEVEL[user.role]}`);
        }

        this.block("aaa", lines);
    }

    private vrfs(): void {
        for (const [name, vrf] of Object.entries(this.device.routing?.vrfs ?? {})) {
            if (vrf) this.block(`ip vpn-instance ${name}`, ["ipv4-family"]);
        }
    }

    private static lagMode(lag: Lag): string[] {
        const lines = [lag.mode === "static" ? "mode manual load-balance" : "mode lacp-static"];
        if (lag.description) lines.unshift(`description ${lag.description}`);
        return lines;
    }

    /** Layer 2 membership of a port or LAG. */
    private switching(settings: Port | Lag): string[] {
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

    private vlanInterface(name: string, iface: VlanInterface): string[] {
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

        const relays = Object.values(device.services?.dhcp_relay ?? {}).filter((relay) => relay.interface === name);
        if (relays.length) {
            lines.push("dhcp select relay");
            for (const server of relays.flatMap((relay) => relay.servers)) lines.push(`dhcp relay binding server ip ${server}`);
        }

        for (const area of Object.values(device.routing?.ospf?.areas ?? {})) {
            const settings = area.interfaces[name];
            if (!settings) continue;

            if (settings.cost !== undefined) lines.push(`ospf cost ${settings.cost}`);
            if (settings.network === "point-to-point") lines.push("ospf network-type p2p");
            if (settings.bfd) lines.push("ospf bfd enable", ...this.bfdTimers("ospf bfd"));
        }

        return lines;
    }

    /** A port the config does not declare is shut down. A LAG member holds only its membership. */
    private physicalPort(port: string, settings: Port | undefined): string[] {
        if (!settings) return ["shutdown"];

        // A port joins a LAG only while it holds no other setting, so membership comes before its description.
        if (settings.in_lag) {
            const membership = `eth-trunk ${this.lagNumbers.get(settings.in_lag)}`;
            return settings.description ? [membership, `description ${settings.description}`] : [membership];
        }

        const lines: string[] = [];
        if (settings.description) lines.push(`description ${settings.description}`);
        lines.push(...this.switching(settings));
        if (settings.lldp === false) lines.push("lldp disable");
        if (settings.mac_limit !== undefined) lines.push(`mac-address limit maximum ${settings.mac_limit}`);
        if (settings.ethertypes) lines.push(`traffic-filter acl ${this.ethertypeAcls.get(settings.ethertypes.join(" "))} inbound`);

        const flow = this.device.monitoring?.flow_export;
        const observed = flow?.protocol === "sflow" && (!flow.interfaces || flow.interfaces.includes(port));
        if (observed) {
            for (let index = 0; index < flow!.collectors.length; index++)
                lines.push(`sflow sampling collector ${VrpRender.FIRST_COLLECTOR + index}`);
            lines.push(`sflow sampling rate ${flow!.sampling}`);
            lines.push("sflow sampling inbound");
        }

        return lines;
    }

    /**
     * Static routes. A route watched by BFD needs a BFD template for its next hop first, from the device's own address on that network, with the device's timers.
     */
    private staticRoutes(): void {
        const routes = this.device.routing?.static_routes ?? [];
        // A next hop written with its length is written as the address alone.
        const watched = [...new Set(routes.filter((route) => route.bfd && route.next_hop).map((route) => Address.host(route.next_hop!)))];

        for (const nextHop of watched) {
            const local = VrpRender.localAddressTo(this.device, nextHop);
            const timers = this.bfdTimers("").map((line) => line.trim());
            this.line([`ip route-static bfd ${nextHop} local-address ${local}`, ...timers].join(" "));
        }

        for (const route of routes) {
            const { addr, len } = Address.split(route.prefix);
            const nextHop = route.blackhole ? "NULL0" : route.next_hop ? Address.host(route.next_hop) : this.nameOf(route.interface!);
            const vrf = route.vrf ? ` vpn-instance ${route.vrf}` : "";
            const preference = route.distance ? ` preference ${route.distance}` : "";
            const description = route.description ? ` description ${route.description}` : "";
            const bfd = route.bfd ? " bfd enable" : "";
            if (Address.family(addr) === "ipv4")
                this.line(`ip route-static${vrf} ${addr} ${Address.netmask(len)} ${nextHop}${preference}${description}${bfd}`);
            else this.line(`ipv6 route-static${vrf} ${addr} ${len} ${nextHop}${preference}`);
        }

        this.separator();
    }

    /** The device's own IPv4 address on the network that holds `nextHop`. `unsupported()` refuses a watched route without one. */
    static localAddressTo(device: Device, nextHop: string): string | undefined {
        for (const { settings } of Derive.interfaces(device)) {
            for (const entry of settings.addresses ?? []) {
                const address = typeof entry === "string" ? entry : entry.address;
                if (Address.contains(Address.prefixOf(address), nextHop)) return Address.host(address);
            }
        }

        return undefined;
    }

    /** The BFD timers of `routing.bfd`, after `prefix`, or nothing for the platform's own. The platform does not print its default multiplier, 3. */
    private bfdTimers(prefix: string): string[] {
        const bfd = this.device.routing?.bfd;
        if (!bfd) return [];

        const multiplier = bfd.multiplier === VrpRender.BFD_MULTIPLIER ? "" : ` detect-multiplier ${bfd.multiplier}`;
        return [`${prefix} min-tx-interval ${bfd.interval} min-rx-interval ${bfd.interval}${multiplier}`.trim()];
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
        const onOspf = areas.some((area) => Object.values(area.interfaces).some((settings) => settings?.bfd));
        const onStatic = (this.device.routing?.static_routes ?? []).some((route) => route.bfd);

        return onOspf || onStatic;
    }

    /** sFlow from the management address, to each collector in order. */
    private flowExport(): void {
        const device = this.device;
        const flow = device.monitoring?.flow_export;
        if (flow?.protocol !== "sflow") return;

        if (device.connection.host) this.line(`sflow agent ip ${device.connection.host}`);

        flow.collectors.forEach((collector, index) => {
            const number = VrpRender.FIRST_COLLECTOR + index;
            this.line(`sflow collector ${number} ip ${collector.address} udp-port ${collector.port ?? 6343}`);
        });

        this.separator();
    }

    /** The log files' level and count, then each syslog collector. A default the device does not print is not written: level `debugging`, 200 files, port 514. */
    private logging(): void {
        const local = this.device.system?.logging?.local;
        const collectors = this.device.monitoring?.syslog;
        if (!this.device.system?.logging && !collectors) return;

        if (local && local.level !== "debug") {
            this.line(`info-center source default channel ${VrpRender.LOGFILE_CHANNEL} log level ${VrpRender.LOG_LEVEL[local.level]}`);
        }

        if (local?.files !== undefined && local.files !== VrpRender.LOGFILES_DEFAULT)
            this.line(`info-center max-logfile-number ${local.files}`);

        for (const collector of collectors ?? []) {
            const level = collector.level === "debug" ? "" : ` level ${VrpRender.LOG_LEVEL[collector.level]}`;
            const port = collector.port !== undefined && collector.port !== VrpRender.SYSLOG_PORT ? ` port ${collector.port}` : "";
            this.line(`info-center loghost ${collector.address}${level}${port}`);
        }

        this.separator();
    }

    /** Alarms raised at another severity than the platform's own, in the `alarm` view. The platform prints a severity with a capital, `Warning`. */
    private alarms(): void {
        const alarms = Object.entries(this.device.system?.alarms ?? {});
        if (!alarms.length) return;

        this.block(
            "alarm",
            alarms.map(([name, alarm]) => `alarm ${name} severity ${VrpRender.ALARM_SEVERITY[alarm.severity]}`)
        );
    }

    /** SNMP version 2c with one read community, version 3 with users in one read-only group, or both. */
    private snmp(): void {
        const device = this.device;
        const snmp = device.monitoring?.snmp;
        if (!snmp) return;

        const versions = [snmp.community ? "v2c" : "", snmp.users ? "v3" : ""].filter(Boolean).join(" ");
        const own = (snmp.allow?.length ?? 0) > 0;
        const guarded = VrpRender.managementAllow(device).length > 0;
        const acl = own ? ` acl ${VrpRender.SNMP_ACL}` : guarded ? ` acl ${VrpRender.MANAGEMENT_ACL}` : "";

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

        const guarded = VrpRender.managementAllow(device).length > 0;

        this.line("stelnet server enable");

        // A user with a key logs in with the key or the password, `all`.
        for (const [user, settings] of Object.entries(device.system?.users ?? {})) {
            if (!settings) continue;
            const keyed = Boolean(settings.ssh_keys?.length);
            this.line(`ssh user ${user}`);
            this.line(`ssh user ${user} authentication-type ${keyed ? "all" : "password"}`);
            if (keyed) this.line(`ssh user ${user} assign rsa-key ${user}`);
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
