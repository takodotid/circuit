import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import { Utils } from "../../core/utils";
import type { Device, Ethertype, Limit, Port, Prefix, RateLimit, Severity, SnmpUser, Switched, Vrrp } from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { RaisecomRosRouting } from "./routing";

export class RaisecomRosRender {
    /** The access-list that guards every management service. */
    static readonly MANAGEMENT_ACL = 1000;

    /** The access-list that guards SNMP when it has sources of its own. */
    static readonly SNMP_ACL = 1001;

    /** A log level as the platform prints it, a number. It takes the names too (`warnings`), but prints the number. */
    private static readonly LOG_LEVELS: Record<Severity, number> = {
        emergency: 0,
        alert: 1,
        critical: 2,
        error: 3,
        warning: 4,
        notice: 5,
        info: 6,
        debug: 7,
    };

    /** The most MAC addresses port security takes on a port, and its default. */
    static readonly MAC_LIMIT_MAX = 1024;

    /** A rate limit's rate is in kbit/s and its burst in kB of 1000 bytes. The switch's own burst for 10000 kbit/s is 1250 kB, one second at the rate. */
    static readonly BITS_PER_KBIT = 1000;
    static readonly BYTES_PER_KB = 1000;

    /** The rate a port's limit takes at most, in kbit/s, and the burst, in kB. A rate above the port's speed is refused by the switch. */
    static readonly RATE_KBPS_MAX = 100_000_000;
    static readonly BURST_KB = { min: 1, max: 4096 };

    /** A storm-control threshold in packets per second. */
    static readonly STORM_PPS = { min: 1, max: 262_143 };

    /** A port's speed in kbit/s, by the unit in its key `<speed>-<position>`. */
    private static readonly PORT_SPEED_KBPS: Record<string, number> = { m: 1000, g: 1_000_000 };

    /** A kind of frame as a MAC access-list rule matches it, in the form the device prints. It takes a type as hex without `0x`, and names IPv4 and ARP. */
    private static readonly ETHERTYPES: Record<Ethertype, string> = { ipv4: "ip", arp: "arp", ipv6: "86dd ffff" };

    /** The log level and UDP port a log host has unless told otherwise. Neither prints. */
    private static readonly LOG_DEFAULTS = { level: 6, port: 514 };

    /** The SNMPv3 authentication each `auth` takes on this platform. One missing here cannot be expressed. */
    static readonly SNMP_AUTH: Partial<Record<SnmpUser["auth"], string>> = { sha1: "sha" };

    private static readonly OSPF_PROCESS = 1;

    /** The SNMPv3 access group every user belongs to, read-only on the whole tree. */
    private static readonly SNMP_GROUP = "circuit";

    /** A port's speed in kbit/s, from its key: `10g-12` is 10000000. Undefined for a key without one. */
    static portKbps(name: string): number | undefined {
        const speed = /^(\d+)([mg])-/.exec(name);
        return speed ? Number(speed[1]) * RaisecomRosRender.PORT_SPEED_KBPS[speed[2]!]! : undefined;
    }

    /** Whether any port has BPDU guard, one setting for the whole switch here. */
    static bpduGuard(device: Device): boolean {
        return Derive.ports(device).some(([, port]) => typeof port.stp === "object" && port.stp.bpdu_guard);
    }

    /** Whether a port or LAG switches any VLAN. */
    static switches(settings: Switched): boolean {
        return Boolean(settings.access_vlan || settings.trunk_vlans || settings.qinq_vlan);
    }

    /** Whether LLDP runs on a port: its own setting, else the device's. A LAG member runs it when its LAG is listed. */
    private static lldpRuns(device: Device, name: string, port: Port): boolean {
        if (port.lldp !== undefined) return port.lldp;

        const lldp = device.switching?.lldp;
        if (!lldp || lldp === true) return Boolean(lldp);
        return lldp.interfaces.includes(name) || (port.in_lag !== undefined && lldp.interfaces.includes(port.in_lag));
    }

    /** LLDP is on for the switch once it runs on any port. Each port runs it then, unless told not to. */
    private static lldpOn(device: Device): boolean {
        return Boolean(device.switching?.lldp) || Derive.ports(device).some(([, port]) => port.lldp === true);
    }

    /** `99,200-201,999`, the platform's compression of a VLAN list. */
    static vlanList(ids: number[]): string {
        const sorted = [...new Set(ids)].sort((a, b) => a - b);
        const ranges: string[] = [];

        for (let i = 0; i < sorted.length; i++) {
            let end = i;
            while (sorted[end + 1] === sorted[end]! + 1) end++;
            ranges.push(i === end ? `${sorted[i]}` : `${sorted[i]}-${sorted[end]}`);
            i = end;
        }

        return ranges.join(",");
    }

    static of(device: Device): string {
        const lines: string[] = [];
        const vlans = device.switching?.vlans ?? {};
        const vlanId = (name: string) => vlans[name]!.id;
        const management = device.management ?? {};
        const allow = RaisecomRosRender.managementAllow(device);

        const ids = Object.values(vlans).flatMap((vlan) => (vlan ? [vlan.id] : []));
        if (ids.length) lines.push(`create vlan ${RaisecomRosRender.vlanList(ids)} active`, "!");

        lines.push(...RaisecomRosRouting.vrfs(device));
        const lagNumbers = Derive.lagIds(device);

        for (const [name, lag] of Object.entries(device.interfaces?.lag ?? {})) {
            if (!lag) continue;

            lines.push(`interface port-channel ${lagNumbers.get(name)}`);
            if (lag.description) lines.push(`description ${lag.description}`);
            if (lag.mode === "static") lines.push("mode manual");
            lines.push(...RaisecomRosRender.switching(lag, vlanId), ...RaisecomRosRender.rateLimit(lag.rate_limit));
            if (lag.dhcp_trusted) lines.push("ip dhcp snooping trust");
            lines.push("!");
        }

        if (allow.length) lines.push(...RaisecomRosRender.accessList(RaisecomRosRender.MANAGEMENT_ACL, "management", allow));
        const snmp = device.monitoring?.snmp;
        const snmpSources = snmp?.allow;
        if (snmpSources) lines.push(...RaisecomRosRender.accessList(RaisecomRosRender.SNMP_ACL, "snmp", snmpSources));

        const ports = Catalog.ports(device.platform, device.model);

        // Each port that takes only some kinds of frame has a MAC access-list of its own, so changing one releases only that port.
        ports.forEach((port, index) => {
            const ethertypes = device.interfaces?.ethernet?.[port]?.ethertypes;
            if (!ethertypes) return;

            lines.push(`access-list ${RaisecomRosRender.ethertypeAcl(index)}`);
            ethertypes.forEach((type, rule) =>
                lines.push(`  rule ${(rule + 1) * 10} permit any any ethertype ${RaisecomRosRender.ETHERTYPES[type]}`)
            );
            lines.push("  rule 100 deny any any", "!");
        });

        for (const [name, user] of Object.entries(device.system?.users ?? {}))
            if (user) lines.push(`user name ${name} password ${Secrets.marker(user.password)}`);
        if (management.privilege_password) lines.push(`enable password ${Secrets.marker(management.privilege_password)}`);
        lines.push(`hostname ${device.name}`);

        const timezone = device.system?.timezone;
        if (timezone) {
            const minutes = Utils.timeZoneOffset(timezone);
            const absolute = Math.abs(minutes);
            lines.push(`clock timezone ${minutes < 0 ? "-" : "+"} ${Math.floor(absolute / 60)} ${absolute % 60} 0`);
        }

        lines.push("!");

        ports.forEach((port, index) => {
            const settings = device.interfaces?.ethernet?.[port];
            const lldpOff =
                settings !== undefined && RaisecomRosRender.lldpOn(device) && !RaisecomRosRender.lldpRuns(device, port, settings);
            const portLines =
                settings && RaisecomRosRouting.routes(settings)
                    ? RaisecomRosRender.routedPort(settings, lldpOff)
                    : RaisecomRosRender.physicalPort(settings, vlanId, lagNumbers, lldpOff);
            lines.push(
                `interface ${Catalog.spell(device.platform, device.model, port)}`,
                ...portLines,
                ...(settings?.ethertypes ? [`filter ingress access-list ${RaisecomRosRender.ethertypeAcl(index)}`] : []),
                "!"
            );
        });

        lines.push(...RaisecomRosRouting.loopbacks(device));

        const ospf = device.routing?.ospf;

        for (const [name, iface] of Object.entries(device.interfaces?.vlan_interface ?? {})) {
            if (!iface) continue;

            lines.push(`interface vlan ${vlanId(iface.vlan)}`, ...RaisecomRosRouting.addressLines(iface));

            const ospfSettings = Object.values(ospf?.areas ?? {}).find((area) => area.interfaces[name])?.interfaces[name];
            if (ospfSettings?.network === "point-to-point") lines.push("ip ospf network ptp");
            if (ospfSettings?.cost !== undefined) lines.push(`ip ospf cost ${ospfSettings.cost}`);
            if (ospfSettings?.passive) lines.push("ip ospf passive-interface enable");
            if (ospfSettings?.bfd) lines.push("ip ospf bfd");
            lines.push(...RaisecomRosRouting.urpfLines(iface));

            for (const group of iface.vrrp ?? []) lines.push(...RaisecomRosRender.vrrp(group));

            lines.push("!");
        }

        if (ospf) {
            const routerId = device.routing?.router_id;
            lines.push(`router ospf ${RaisecomRosRender.OSPF_PROCESS}${routerId ? ` router-id ${routerId}` : ""}`);

            for (const [areaId, area] of Object.entries(ospf.areas)) {
                for (const [iface, settings] of Object.entries(area.interfaces)) {
                    if (!settings) continue;

                    for (const prefix of Derive.ipv4Networks(device, iface)) {
                        lines.push(`network ${Address.host(prefix)} ${Address.wildcard(Address.split(prefix).len)} area ${areaId}`);
                    }
                }
            }

            for (const source of ospf.redistribute ?? []) lines.push(`redistribute ${source}`);
            lines.push("!");
        }

        // Storm control acts only once detection is on.
        if (Derive.ports(device).some(([, port]) => port.storm_control)) lines.push("storm-control detection enable");
        if (device.monitoring?.transceivers) lines.push("transceiver ddm enable");
        // LLDP and spanning tree are off by default and turned on by the config.
        const switching = device.switching;
        if (RaisecomRosRender.lldpOn(device)) lines.push("lldp enable");
        if (switching?.stp) {
            lines.push("spanning-tree enable");
            if (switching.stp.priority !== undefined) lines.push(`spanning-tree priority ${switching.stp.priority}`);
            // One setting guards every edge port.
            if (RaisecomRosRender.bpduGuard(device)) lines.push("spanning-tree bpduguard enable");
        }
        // Each switched port snoops once the switch does, unless it is trusted.
        if (switching?.dhcp_snooping) lines.push("ip dhcp snooping");

        // The factory communities survive a reset, and one of them can write, so they are always removed.
        lines.push("no snmp-server community public", "no snmp-server community private");
        if (snmp?.community) lines.push(`snmp-server community ${Secrets.marker(snmp.community)} ro`);

        const snmpUsers = Object.entries(snmp?.users ?? {});
        if (snmpUsers.length) lines.push(`snmp-server access ${RaisecomRosRender.SNMP_GROUP} read internet usm authpriv`);

        for (const [name, user] of snmpUsers) {
            const authentication = `authentication ${RaisecomRosRender.SNMP_AUTH[user.auth]} ${Secrets.marker(user.auth_password)}`;
            const privacy = `privacy ${user.privacy} ${Secrets.marker(user.privacy_password)}`;
            lines.push(
                `snmp-server user ${name} ${authentication} ${privacy}`,
                `snmp-server group ${RaisecomRosRender.SNMP_GROUP} user ${name} usm`
            );
        }

        const snmpAcl = snmpSources ? RaisecomRosRender.SNMP_ACL : allow.length ? RaisecomRosRender.MANAGEMENT_ACL : undefined;
        if ((snmp?.community || snmpUsers.length) && snmpAcl) lines.push(`snmp-server access-list ${snmpAcl}`);

        // A static route watched by BFD tracks a BFD session, one per next hop, bound to the VLAN interface the next hop is on.
        for (const [via, session] of RaisecomRosRouting.bfdSessions(device)) {
            lines.push(`bfd ${session.id} bind peer-ip ${via} interface vlan ${vlanId(session.vlan)}`, "session enable", "!");
        }

        lines.push(...RaisecomRosRouting.staticRoutes(device));

        if (management.telnet) {
            lines.push("telnet-server enable");
            if (allow.length) lines.push(`telnet-server access-list ${RaisecomRosRender.MANAGEMENT_ACL}`);
        } else lines.push("telnet-server disable");

        const ssh = management.ssh;
        if (ssh?.auth_timeout) lines.push(`ssh2 server authentication-timeout ${ssh.auth_timeout}`);
        if (ssh?.auth_retries) lines.push(`ssh2 server authentication-retries ${ssh.auth_retries}`);
        if (ssh && allow.length) lines.push(`ssh2 access-list ${RaisecomRosRender.MANAGEMENT_ACL}`);

        const ntp = device.system?.ntp;
        if (ntp?.servers.length) lines.push("ntp enable", ...ntp.servers.map((server) => `ntp server ${server}`));

        for (const host of device.monitoring?.syslog ?? []) {
            const level = RaisecomRosRender.LOG_LEVELS[host.level];
            const port = host.port ?? RaisecomRosRender.LOG_DEFAULTS.port;
            let line = `logging host ${host.address}`;
            if (level !== RaisecomRosRender.LOG_DEFAULTS.level) line += ` ${level}`;
            if (port !== RaisecomRosRender.LOG_DEFAULTS.port) line += ` udpport ${port}`;
            lines.push(line);
        }

        return `${lines.join("\n")}\n`;
    }

    /** The sources every management service takes. The project has already turned an address set's name here into the set's addresses. */
    private static managementAllow(device: Device): readonly Prefix[] {
        const allow = device.management?.allow ?? [];
        if (typeof allow === "string")
            throw new Error(`${device.name}: management.allow is still the address set ${allow}, not its addresses`);
        return allow;
    }

    /** An access-list permitting `sources`, then denying the rest. Its description takes one word. */
    private static accessList(number: number, description: string, sources: readonly Prefix[]): string[] {
        const rules = sources.map(
            (cidr, index) => `  rule ${(index + 1) * 10} permit ${Address.host(cidr)} ${Address.netmask(Address.split(cidr).len)}`
        );

        // Stated, so the list reads the same without knowing the firmware's implicit end.
        return [`access-list ${number}`, `  description ${description}`, ...rules, "  rule 100 deny any", "!"];
    }

    private static switching(settings: Switched, vlanId: (name: string) => number): string[] {
        const lines: string[] = [];
        if (settings.access_vlan) lines.push(`switchport access vlan ${vlanId(settings.access_vlan)}`);
        // QinQ is an access port that pushes its VLAN's tag on every frame, tagged or not. The outer tag is 0x8100, the default.
        if (settings.qinq_vlan) lines.push(`switchport access vlan ${vlanId(settings.qinq_vlan)}`, "dot1q-tunnel");

        if (settings.trunk_vlans) {
            if (settings.native_vlan) lines.push(`switchport trunk native vlan ${vlanId(settings.native_vlan)}`);
            lines.push(
                `switchport trunk allowed vlan ${RaisecomRosRender.vlanList(settings.trunk_vlans.map(vlanId))}`,
                "switchport mode trunk"
            );
        }

        return lines;
    }

    /** A VRRP group. The platform enables a group once it has an address, and preempts unless told not to. */
    private static vrrp(group: Vrrp): string[] {
        const lines = [`vrrp ${group.id} ip ${group.address}`];
        if (group.interval !== undefined && group.interval !== 1)
            lines.push(`vrrp ${group.id} timers advertise-interval ${group.interval}`);
        if (group.priority !== undefined && group.priority !== 100) lines.push(`vrrp ${group.id} priority ${group.priority}`);
        if (!group.preempt) lines.push(`no vrrp ${group.id} preempt`);
        return lines;
    }

    /** A routed port: one without `portswitch`, the switch's default for a port, with its addresses. */
    static routedPort(settings: Port, lldpOff: boolean): string[] {
        const lines = settings.description ? [`description ${settings.description}`] : [];
        lines.push(...RaisecomRosRouting.addressLines(settings), ...RaisecomRosRouting.urpfLines(settings));
        if (settings.lldp === false || lldpOff) lines.push("lldp disable");
        return lines;
    }

    /** A port the config does not declare is shut down. A LAG member holds its membership, description, and LLDP; the LAG holds the rest. */
    private static physicalPort(
        settings: Port | undefined,
        vlanId: (name: string) => number,
        lagNumbers: Map<string, number>,
        lldpOff: boolean
    ): string[] {
        if (!settings) return ["shutdown"];

        const lines: string[] = [];
        if (settings.description) lines.push(`description ${settings.description}`);
        // LLDP runs on each port once it runs on the switch, and is turned off where the config doesn't want it.
        const lldp = settings.lldp === false || lldpOff ? ["lldp disable"] : [];
        if (settings.in_lag) return [...lines, `port-channel ${lagNumbers.get(settings.in_lag)}`, ...lldp];

        lines.push(...RaisecomRosRender.switching(settings, vlanId), ...lldp, ...RaisecomRosRender.portStp(settings.stp));

        // Every threshold takes the one mode, and kbps, the default, prints nothing.
        const storm = settings.storm_control;
        const thresholds = [
            ["broadcast", storm?.broadcast],
            ["dlf", storm?.unknown_unicast],
        ] as const;
        const pps = thresholds.flatMap(([kind, threshold]) =>
            threshold && "pps" in threshold ? [`storm-control ${kind} pps ${threshold.pps}`] : []
        );
        if (pps.length) lines.push("storm-control mode pps", ...pps);

        lines.push(...RaisecomRosRender.rateLimit(settings.rate_limit));

        // Port security drops frames from any source past the limit, its default `protect` action. The default limit prints nothing.
        if (settings.mac_limit !== undefined) {
            lines.push("switchport port-security");
            if (settings.mac_limit !== RaisecomRosRender.MAC_LIMIT_MAX)
                lines.push(`switchport port-security maximum ${settings.mac_limit}`);
        }

        if (settings.dhcp_trusted) lines.push("ip dhcp snooping trust");

        return lines;
    }

    /** A port's spanning tree. The switch finds edge ports itself unless told, `auto`, its default. A port's priority is the common instance's, 0, as the switch prints it. */
    private static portStp(stp: Switched["stp"]): string[] {
        if (stp === false) return ["spanning-tree disable"];
        if (typeof stp !== "object") return [];

        const lines: string[] = [];
        if (stp.edge !== undefined) lines.push(`spanning-tree edged-port force-${stp.edge}`);
        if (stp.priority !== undefined) lines.push(`spanning-tree instance 0 priority ${stp.priority}`);
        if (stp.guard === "root") lines.push("spanning-tree rootguard enable");
        return lines;
    }

    /** What arrives and what leaves, the rate in kbit/s. A burst the same as the switch's own, one second at the rate up to the most it takes, prints nothing. */
    private static rateLimit(rateLimit: RateLimit | undefined): string[] {
        const line = (direction: string, limit: Limit) => {
            const { rate, burst } = Derive.limit(limit);
            const kbps = Derive.bitsPerSecond(rate) / RaisecomRosRender.BITS_PER_KBIT;
            const own = Math.min(kbps / Derive.BITS_PER_BYTE, RaisecomRosRender.BURST_KB.max);
            const kilobytes = burst === undefined ? own : burst / RaisecomRosRender.BYTES_PER_KB;
            return `rate-limit ${direction} cir ${kbps}${kilobytes === own ? "" : ` cbs ${kilobytes}`}`;
        };

        return [
            ...(rateLimit?.input ? [line("ingress", rateLimit.input)] : []),
            ...(rateLimit?.output ? [line("egress", rateLimit.output)] : []),
        ];
    }

    /** The MAC access-list of the port at `index` in the catalog, for its `ethertypes`. MAC access-lists are 3000 and up. */
    static ethertypeAcl(index: number): number {
        return 3001 + index;
    }
}
