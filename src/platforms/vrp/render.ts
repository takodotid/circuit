import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import { Utils } from "../../core/utils";
import type { Device, Gre, Lag, Limit, Loopback, OspfArea, OspfInterface, Port, RateLimit, VlanInterface, Vrrp } from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { VrpAaa } from "./aaa";
import { VrpAcls } from "./acls";
import { VrpBgp } from "./bgp";
import { VrpDhcp } from "./dhcp";
import { VrpDhcpv6 } from "./dhcpv6";
import { VrpEvpn } from "./evpn";
import { VrpIsis } from "./isis";
import { VrpMarking } from "./marking";
import { VrpMonitoring } from "./monitoring";
import { VrpNetStream } from "./netstream";
import { VrpNames } from "./names";
import { VrpOspf } from "./ospf";
import { VrpPolicies } from "./policies";
import { VrpProbes } from "./probes";
import { VrpQos } from "./qos";
import { VrpRouterAdvertisement } from "./router-advertisement";
import { VrpSwitching } from "./switching";

/** The configuration in the form the device prints it: a block is a header, its indented lines, then `#`. */
export class VrpRender {
    /** The longest name a key takes. */
    static readonly KEY_NAME = 30;

    /** How long each line of a key's text is sent: the CLI refuses a whole RSA key on one line, and takes 200 characters. */
    static readonly KEY_LINE = 200;

    /** What the switch writes after a key that came without a comment. */
    static readonly KEY_COMMENT = "rsa-key";

    static readonly BITS_PER_KBIT = 1000;

    /** The ACL that guards every management service. */
    private static readonly MANAGEMENT_ACL = 2000;

    /** The ACL that guards SNMP when it has sources of its own. */
    private static readonly SNMP_ACL = 2001;

    /** The BFD multiplier the device uses when the config sets none. It is not printed. */
    private static readonly BFD_MULTIPLIER = 3;

    /** An OSPF interface's DR priority when the config sets none. It is not printed. */
    private static readonly OSPF_PRIORITY = 1;

    /** One process per device. */
    private static readonly OSPF_PROCESS = 1;

    /** `ospf network-type` for each network type. */
    private static readonly OSPF_NETWORK = {
        broadcast: "broadcast",
        "point-to-point": "p2p",
        "point-to-multipoint": "p2mp",
        "non-broadcast": "nbma",
    } as const satisfies Record<NonNullable<OspfInterface["network"]>, string>;

    private static readonly ALARM_SEVERITY = { critical: "Critical", major: "Major", minor: "Minor", warning: "Warning" } as const;

    private static readonly USER_LEVEL = { admin: 3, operator: 2, "read-only": 1 } as const;

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

    static of(device: Device): string {
        return new VrpRender(device).build();
    }

    /** `management.allow` as a list. The project turns an address set named there into its addresses before rendering. */
    static managementAllow(device: Device): readonly string[] {
        const allow = device.management?.allow ?? [];
        if (typeof allow === "string") throw new Error(`management.allow names the address set ${allow}, not its addresses`);
        return allow;
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
        this.lines.push(...VrpEvpn.lines(device));
        this.managementAcl();
        this.snmpAcl();
        this.ethertypeAclBlocks();
        this.lines.push(...VrpAcls.blocks(device), ...VrpSwitching.boundAcls(device));
        this.lines.push(...VrpMarking.lines(device));
        this.lines.push(...VrpQos.lines(device));
        this.lines.push(...VrpAaa.serverLines(device));
        this.users();
        this.vrfs();
        this.lines.push(...VrpDhcp.blocks(device), ...VrpDhcpv6.blocks(device));
        this.carProfiles();

        for (const [name, lag] of Object.entries(this.lags)) {
            if (lag)
                this.block(`interface ${this.nameOf(name)}`, [
                    ...VrpRender.lagMode(lag),
                    ...this.switching(lag),
                    ...VrpRender.rateLimitLines(name, lag.rate_limit),
                    ...VrpSwitching.boundPortLines(name, lag),
                ]);
        }

        for (const [name, iface] of Object.entries(this.vlanInterfaces)) {
            if (iface) this.block(`interface ${this.nameOf(name)}`, this.vlanInterface(name, iface));
        }

        for (const [name, loopback] of Object.entries(device.interfaces?.loopback ?? {})) {
            if (loopback)
                this.block(`interface ${this.nameOf(name)}`, [
                    ...this.addressing(name, loopback),
                    ...this.ospfLines(name, "point-to-point"),
                ]);
        }

        for (const [name, tunnel] of Object.entries(device.interfaces?.gre ?? {})) {
            if (tunnel) this.block(`interface ${this.nameOf(name)}`, this.gre(name, tunnel));
        }

        for (const port of Catalog.ports(device.platform, device.model)) {
            this.block(`interface ${this.nameOf(port)}`, this.physicalPort(port, device.interfaces?.ethernet?.[port]));
        }

        this.lines.push(...VrpEvpn.nve(device));

        this.bindings();
        this.staticRoutes();
        this.ospf();
        this.lines.push(...VrpBgp.lines(device, VrpIsis.policies(device)));
        this.lines.push(...VrpIsis.lines(device));
        if (this.wantsBfd()) this.block("bfd", []);
        const relays = device.services?.dhcp_relay;
        const servers = device.services?.dhcp_server;
        const snooping = device.switching?.dhcp_snooping;
        if (snooping || [relays, servers].some((each) => each && Object.keys(each).length)) {
            this.line("dhcp enable");
            if (snooping) this.line("dhcp snooping enable");
            this.separator();
        }
        if (VrpDhcpv6.serves(device)) {
            this.line("dhcpv6 enable");
            this.separator();
        }

        this.lines.push(...VrpMonitoring.flowLines(device), ...VrpNetStream.lines(device), ...VrpMonitoring.loggingLines(device));
        this.alarms();
        this.lines.push(...VrpMonitoring.snmpLines(device, this.snmpGuard()));
        this.lines.push(...VrpProbes.lines(device));
        this.ssh();
        this.userInterfaces();
        return this.text();
    }

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

    /** What arrives on a port or a LAG is policed by a CAR profile of its own, named after it. Rates are in kbit/s and bursts in bytes. */
    private carProfiles(): void {
        const limited = Derive.rateLimited(this.device).filter(({ kind, rateLimit }) => kind !== "vlan_interface" && rateLimit.input);
        for (const { name, rateLimit } of limited) this.line(`qos car ${VrpRender.carName(name)} ${VrpRender.rate(rateLimit.input!)}`);
        if (limited.length) this.separator();
    }

    /** A port's or a LAG's rate limit, in the order the switch prints them: a rate limit on what leaves, and its CAR profile on what arrives. */
    private static rateLimitLines(name: string, rateLimit: RateLimit | undefined): string[] {
        const lines: string[] = [];
        if (rateLimit?.output) lines.push(`qos lr ${VrpRender.rate(rateLimit.output)} outbound`);
        if (rateLimit?.input) lines.push(`qos car inbound ${VrpRender.carName(name)}`);
        return lines;
    }

    /** The CAR profile of a port or a LAG, by its name in the config: `rate-limit-10g-1`. */
    private static carName(name: string): string {
        return `rate-limit-${name}`;
    }

    /** `cir 200000 kbps cbs 250000 bytes`: the rate in kbit/s, then the burst in bytes when the config sets one, each with its unit, as the switch prints them. */
    private static rate(limit: Limit): string {
        const { rate, burst } = Derive.limit(limit);
        const cir = `cir ${Derive.bitsPerSecond(rate) / VrpRender.BITS_PER_KBIT} kbps`;
        return burst === undefined ? cir : `${cir} cbs ${burst} bytes`;
    }

    /** A header and its lines. A block with nothing in it is still written, so that its header exists. */
    private block(header: string, body: string[]): void {
        this.lines.push(header, ...body.map((text) => ` ${text}`), "#");
    }

    private separator(): void {
        this.lines.push("#");
    }

    private text(): string {
        return `${this.lines.join("\n")}\n`;
    }

    private vlanId(name: string): number {
        return this.vlans[name]!.id;
    }

    /** What the platform calls a port, a LAG, a VLAN interface, a loopback, or a GRE tunnel. */
    private nameOf(portOrInterface: string): string {
        if (this.lags[portOrInterface]) return `Eth-Trunk${this.lagNumbers.get(portOrInterface)}`;

        const vlanInterface = this.vlanInterfaces[portOrInterface];
        if (vlanInterface) return `Vlanif${this.vlanId(vlanInterface.vlan)}`;

        const own = VrpNames.loopback(this.device, portOrInterface) ?? VrpNames.tunnel(this.device, portOrInterface);
        return own ?? Catalog.spell(this.device.platform, this.device.model, portOrInterface);
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
            // The platform names the zone with one word, so the last part of the IANA name serves.
            this.line(`clock timezone ${timezone.split("/").at(-1)} ${minutes < 0 ? "minus" : "add"} ${hours}:${remainder}:00`);
            this.separator();
        }

        const stp = device.switching?.stp;
        if (!stp) this.line("stp disable");
        else {
            // MSTP is the platform's default and is not written.
            if (stp.mode && stp.mode !== "mstp") this.line(`stp mode ${stp.mode}`);
            if (stp.priority !== undefined) this.line(`stp priority ${stp.priority}`);
            // One setting for every edge port; `unsupported()` holds every edge port to the same.
            if (Derive.switchedHolders(device).some(({ settings }) => typeof settings.stp === "object" && settings.stp.bpdu_guard))
                this.line("stp bpdu-protection");
        }
        // LLDP is off by default and turned on by the config.
        if (device.switching?.lldp) this.line("lldp enable");
        this.separator();

        if (!device.services?.ntp_server) {
            this.line("ntp server disable");
            this.line("ntp ipv6 server disable");
        }

        // A server written with its length is written as the address alone.
        const ntpVrf = device.system?.ntp?.vrf ? ` vpn-instance ${device.system.ntp.vrf}` : "";
        for (const server of device.system?.ntp?.servers ?? []) this.line(`ntp unicast-server ${Address.host(server)}${ntpVrf}`);
        this.separator();

        // The switch asks its resolvers only once `dns resolve` is on. It prints IPv6 addresses in capitals.
        const dns = device.system?.dns;
        if (dns) {
            const vrf = dns.vrf ? ` vpn-instance ${dns.vrf}` : "";
            this.line("dns resolve");
            for (const server of dns.servers)
                this.line(
                    Address.family(server) === "ipv6" ? `dns server ipv6 ${VrpPolicies.spell(server)}${vrf}` : `dns server ${server}${vrf}`
                );
            this.separator();
        }

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

    private managementAcl(): void {
        const allow = VrpRender.managementAllow(this.device);
        if (!allow.length) return;

        this.block(`acl number ${VrpRender.MANAGEMENT_ACL}`, ["description Management access", ...VrpRender.aclRules(allow)]);
    }

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

        lines.push(...VrpAaa.schemeLines(this.device, VrpRender.USER_LEVEL));
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

    private switching(settings: Port | Lag): string[] {
        const lines: string[] = [];
        if (settings.qinq_vlan) lines.push("port link-type dot1q-tunnel", `port default vlan ${this.vlanId(settings.qinq_vlan)}`);
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
            if (settings.stp.guard === "root") lines.push("stp root-protection");
        }

        // Snooping runs on each port, and the device-wide `dhcp snooping enable` comes before the ports in a plan.
        const switched = settings.access_vlan || settings.trunk_vlans;
        if (switched && this.device.switching?.dhcp_snooping)
            lines.push(settings.dhcp_trusted ? "dhcp snooping trusted" : "dhcp snooping enable");

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
        // The platform preempts by default, and the config only does when asked.
        if (!group.preempt) lines.push(`vrrp vrid ${group.id} preempt disable`);
        if (group.interval !== undefined && group.interval !== 1) lines.push(`vrrp vrid ${group.id} timer advertise ${group.interval}`);
        return lines;
    }

    private vlanInterface(name: string, iface: VlanInterface): string[] {
        const device = this.device;
        const lines = this.addressing(name, iface);

        // Loose, the CloudEngine command reference's only mode on a VLAN interface. `unsupported()` refuses the rest.
        if (iface.urpf?.ipv4 === "loose") lines.push("ip urpf enable");
        lines.push(...VrpRouterAdvertisement.lines(iface));

        for (const group of iface.vrrp ?? []) lines.push(...VrpRender.vrrpLines(group));

        const relays = Object.values(device.services?.dhcp_relay ?? {}).filter((relay) => relay.interface === name);
        if (relays.length) {
            lines.push("dhcp select relay");
            for (const server of relays.flatMap((relay) => relay.servers)) lines.push(`dhcp relay binding server ip ${server}`);
        }
        lines.push(...VrpDhcpv6.interfaceLines(device, name));

        lines.push(...this.ospfLines(name, "broadcast"));
        lines.push(...VrpIsis.interfaceLines(device, name, this.bfdTimers("isis bfd")));
        return lines;
    }

    /** A GRE tunnel: `tunnel-protocol gre` comes before the ends it joins, and they before its addresses. */
    private gre(name: string, tunnel: Gre): string[] {
        const lines = tunnel.description ? [`description ${tunnel.description}`] : [];
        lines.push("tunnel-protocol gre", `source ${Address.host(tunnel.local_address)}`, `destination ${tunnel.remote_address}`);
        const addressing = this.addressing(name, tunnel).filter((line) => !line.startsWith("description "));
        return [...lines, ...addressing, ...this.ospfLines(name, "point-to-point")];
    }

    /** An interface's description, VRF, and addresses. Binding to a VRF clears the addresses, so it comes first. */
    private addressing(name: string, iface: VlanInterface | Loopback | Gre): string[] {
        const lines: string[] = [];
        if (iface.description) lines.push(`description ${iface.description}`);
        if (iface.vrf) lines.push(`ip binding vpn-instance ${iface.vrf}`);

        // The switch takes an IPv6 address, or IS-IS for IPv6, only once IPv6 is on.
        const addresses = (iface.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
        if (addresses.some((address) => Address.family(address) === "ipv6") || VrpIsis.runsIpv6(this.device, name))
            lines.push("ipv6 enable");

        for (const address of addresses) {
            if (Address.family(address) === "ipv4")
                lines.push(`ip address ${Address.host(address)} ${Address.netmask(Address.split(address).len)}`);
            else lines.push(`ipv6 address ${VrpPolicies.spell(address)}`);
        }

        return lines;
    }

    /** An interface's own OSPF settings, from the area that holds it. The switch does not print the network type that is the interface's own: broadcast on a VLAN interface, point-to-point on a loopback or a tunnel. */
    private ospfLines(name: string, own: NonNullable<OspfInterface["network"]>): string[] {
        const lines: string[] = [];

        for (const area of Object.values(this.device.routing?.ospf?.areas ?? {})) {
            const settings = area.interfaces[name];
            if (!settings) continue;

            if (settings.cost !== undefined) lines.push(`ospf cost ${settings.cost}`);
            if (settings.network && settings.network !== own) lines.push(`ospf network-type ${VrpRender.OSPF_NETWORK[settings.network]}`);
            const priority = settings.priority;
            if (priority !== undefined && priority !== VrpRender.OSPF_PRIORITY) lines.push(`ospf dr-priority ${priority}`);
            if (settings.hello_interval !== undefined) lines.push(`ospf timer hello ${settings.hello_interval}`);
            if (settings.dead_interval !== undefined) lines.push(`ospf timer dead ${settings.dead_interval}`);
            // `unsupported()` refuses the algorithms the platform lacks.
            const authentication = settings.authentication;
            const mode = authentication && VrpOspf.AUTH[authentication.algorithm];
            if (authentication && mode)
                lines.push(`ospf authentication-mode ${mode} ${authentication.key_id} cipher ${Secrets.marker(authentication.key)}`);
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
        lines.push(...VrpRender.rateLimitLines(port, settings.rate_limit));
        lines.push(...VrpQos.portLines(this.device, settings));
        if (settings.lldp === false) lines.push("lldp disable");
        if (settings.mac_limit !== undefined) lines.push(`mac-address limit maximum ${settings.mac_limit}`);
        if (settings.ethertypes) lines.push(`traffic-filter acl ${this.ethertypeAcls.get(settings.ethertypes.join(" "))} inbound`);
        lines.push(...VrpAcls.portLines(this.device, settings.ingress_acl), ...VrpSwitching.boundPortLines(port, settings));

        lines.push(...VrpMonitoring.portLines(this.device, port), ...VrpNetStream.portLines(this.device, port));
        return lines;
    }

    /** The hosts of bound ports, with their addresses and MAC addresses. */
    private bindings(): void {
        const lines = VrpSwitching.boundLines(this.device, (name) => this.nameOf(name));
        if (!lines.length) return;

        this.lines.push(...lines);
        this.separator();
    }

    /** A route watched by BFD needs a BFD template for its next hop first, from the device's own address on that network, with the device's timers. */
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
            // The interface comes before the next hop it reaches, `Vlanif10 FE80::1`. The switch prints IPv6 addresses in capitals.
            const through = [
                route.interface && this.nameOf(route.interface),
                route.next_hop && VrpPolicies.spell(Address.host(route.next_hop)),
            ];
            const nextHop = route.blackhole ? "NULL0" : through.filter(Boolean).join(" ");
            const vrf = route.vrf ? ` vpn-instance ${route.vrf}` : "";
            const preference = route.distance ? ` preference ${route.distance}` : "";
            const description = route.description ? ` description ${route.description}` : "";
            const bfd = route.bfd ? " bfd enable" : "";
            if (Address.family(addr) === "ipv4")
                this.line(`ip route-static${vrf} ${addr} ${Address.netmask(len)} ${nextHop}${preference}${description}${bfd}`);
            else this.line(`ipv6 route-static${vrf} ${VrpPolicies.spell(addr)} ${len} ${nextHop}${preference}`);
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

    /** The BFD timers of `routing.bfd`, after `prefix`, or nothing for the platform's own. */
    private bfdTimers(prefix: string): string[] {
        const bfd = this.device.routing?.bfd;
        if (!bfd) return [];

        const multiplier = bfd.multiplier === VrpRender.BFD_MULTIPLIER ? "" : ` detect-multiplier ${bfd.multiplier}`;
        return [`${prefix} min-tx-interval ${bfd.interval} min-rx-interval ${bfd.interval}${multiplier}`.trim()];
    }

    /** A stub area or an NSSA, in the area's view. A border router announces a default route into an NSSA with summaries only with `default-route-advertise`. */
    private static areaType(area: OspfArea): string[] {
        if (!area.type) return [];

        const cost = area.stub_default_cost;
        const options = [
            ...(area.type === "nssa" && !area.no_summaries && cost !== undefined ? ["default-route-advertise"] : []),
            ...(area.no_summaries ? ["no-summary"] : []),
        ];
        return [` ${[area.type, ...options].join(" ")}`, ...(cost === undefined ? [] : [` default-cost ${cost}`])];
    }

    /** A border router's summary of an area's range, `abr-summary` with the range's mask. The switch announces a range unless told `not-advertise`. */
    private static abrSummary(range: NonNullable<OspfArea["ranges"]>[number]): string {
        const { addr, len } = Address.split(range.prefix);
        const advertise = range.advertise ? "" : " not-advertise";
        const cost = range.cost === undefined ? "" : ` cost ${range.cost}`;
        return ` abr-summary ${addr} ${Address.netmask(len)}${advertise}${cost}`;
    }

    /**
     * An area announces the networks of its interfaces, and a passive interface is silent. An NBMA link's neighbors are the process's `peer` lines. A range is summarized in its own area's view, and a virtual link is a `vlink-peer` in the view of the area it crosses. `unsupported()` refuses IPv6.
     */
    private ospf(): void {
        const device = this.device;
        const ospf = device.routing?.ospf;
        if (!ospf) return;

        const routerId = device.routing?.router_id;
        const lines: string[] = [];
        for (const source of ospf.redistribute ?? []) lines.push(`import-route ${source === "connected" ? "direct" : "static"}`);

        const areaLines: string[] = [];
        const virtualLinks = Object.values(ospf.areas).flatMap((area) => area.virtual_links ?? []);

        for (const [areaId, area] of Object.entries(ospf.areas)) {
            areaLines.push(`area ${areaId}`, ...VrpRender.areaType(area));
            for (const range of area.ranges ?? []) {
                if (Address.family(range.prefix) === "ipv4") areaLines.push(VrpRender.abrSummary(range));
            }

            for (const [iface, settings] of Object.entries(area.interfaces)) {
                if (settings?.passive) lines.push(`silent-interface ${this.nameOf(iface)}`);
                for (const neighbor of settings?.neighbors ?? []) lines.push(`peer ${neighbor}`);
                for (const prefix of Derive.ipv4Networks(device, iface))
                    areaLines.push(` network ${Address.host(prefix)} ${Address.wildcard(Address.split(prefix).len)}`);
            }

            for (const link of virtualLinks) if (link.transit_area_id === areaId) areaLines.push(` vlink-peer ${link.router_id}`);
        }

        const vrf = ospf.vrf ? ` vpn-instance ${ospf.vrf}` : "";
        this.block(`ospf ${VrpRender.OSPF_PROCESS}${routerId ? ` router-id ${routerId}` : ""}${vrf}`, [...lines, ...areaLines]);
    }

    private wantsBfd(): boolean {
        const areas = Object.values(this.device.routing?.ospf?.areas ?? {});
        const onOspf = areas.some((area) => Object.values(area.interfaces).some((settings) => settings?.bfd));
        const onStatic = (this.device.routing?.static_routes ?? []).some((route) => route.bfd);

        return onOspf || onStatic || VrpIsis.wantsBfd(this.device);
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

    /** The ACL that guards SNMP: its own when it has sources of its own, else the one of every management service, else none. */
    private snmpGuard(): number | undefined {
        if ((this.device.monitoring?.snmp?.allow?.length ?? 0) > 0) return VrpRender.SNMP_ACL;
        return VrpRender.managementAllow(this.device).length > 0 ? VrpRender.MANAGEMENT_ACL : undefined;
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
