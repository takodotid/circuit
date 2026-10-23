import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import { Utils } from "../../core/utils";
import type { Device, Port, SnmpUser, Switched, Vrrp } from "../../schema";
import { Catalog } from "../catalog";
import { Derive } from "../derive";

type AnyPort = Port<string, string, string, string>;

/** The configuration a Raisecom ROS device should run. */
export class RaisecomRosRender {
    /** The access-list that guards every management service. */
    static readonly MANAGEMENT_ACL = 1000;

    /** The SNMPv3 authentication each `auth` takes on this platform. One missing here cannot be expressed. */
    static readonly SNMP_AUTH: Partial<Record<SnmpUser["auth"], string>> = { sha1: "sha" };

    /** The OSPF process number. */
    private static readonly OSPF_PROCESS = 1;

    /** The SNMPv3 access group every user belongs to, read-only on the whole tree. */
    private static readonly SNMP_GROUP = "circuit";

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

    /** The whole configuration of a device. */
    static of(device: Device): string {
        const lines: string[] = [];
        const vlans = device.vlans ?? {};
        const vlanId = (name: string) => vlans[name]!.id;
        const management = device.management ?? {};
        const allow = management.allow ?? [];

        const ids = Object.values(vlans).map((vlan) => vlan.id);
        if (ids.length) lines.push(`create vlan ${RaisecomRosRender.vlanList(ids)} active`, "!");

        const lagNumbers = Derive.lagIds(device);

        for (const [name, lag] of Object.entries(device.interfaces ?? {})) {
            if (lag.type !== "lag") continue;

            lines.push(`interface port-channel ${lagNumbers.get(name)}`);
            if (lag.description) lines.push(`description ${lag.description}`);
            if (lag.mode === "static") lines.push("mode manual");
            lines.push(...RaisecomRosRender.switching(lag, vlanId), "!");
        }

        if (allow.length) {
            // An access-list description takes one word.
            lines.push(`access-list ${RaisecomRosRender.MANAGEMENT_ACL}`, "  description management");
            allow.forEach((cidr, index) =>
                lines.push(`  rule ${(index + 1) * 10} permit ${Address.host(cidr)} ${Address.netmask(Address.split(cidr).len)}`)
            );
            // Stated, so the list reads the same without knowing the firmware's implicit end.
            lines.push("  rule 100 deny any", "!");
        }

        for (const [name, user] of Object.entries(device.users ?? {}))
            lines.push(`user name ${name} password ${Secrets.marker(user.password)}`);
        if (management.privilege_password) lines.push(`enable password ${Secrets.marker(management.privilege_password)}`);

        const timezone = device.system?.timezone;
        if (timezone) {
            const minutes = Utils.timeZoneOffset(timezone);
            const absolute = Math.abs(minutes);
            lines.push(`clock timezone ${minutes < 0 ? "-" : "+"} ${Math.floor(absolute / 60)} ${absolute % 60} 0`);
        }

        lines.push("!");

        for (const port of Catalog.ports(device.platform, device.model)) {
            const settings = device.ports?.[port as keyof typeof device.ports];
            lines.push(
                `interface ${Catalog.spell(device.platform, device.model, port)}`,
                ...RaisecomRosRender.physicalPort(settings, vlanId, lagNumbers),
                "!"
            );
        }

        const ospf = device.routing?.ospf;

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "vlan") continue;

            lines.push(`interface vlan ${vlanId(iface.vlan)}`);

            for (const entry of iface.addresses ?? []) {
                const address = typeof entry === "string" ? entry : entry.address;
                if (Address.family(address) === "ipv4")
                    lines.push(`ip address ${Address.host(address)} ${Address.netmask(Address.split(address).len)}`);
            }

            const ospfSettings = Object.values(ospf?.areas ?? {}).find((area) => area.interfaces[name])?.interfaces[name];
            if (ospfSettings?.network === "point-to-point") lines.push("ip ospf network ptp");
            if (ospfSettings?.cost !== undefined) lines.push(`ip ospf cost ${ospfSettings.cost}`);
            if (ospfSettings?.passive) lines.push("ip ospf passive-interface enable");

            for (const group of iface.vrrp ?? []) lines.push(...RaisecomRosRender.vrrp(group));

            lines.push("!");
        }

        if (ospf) {
            const routerId = device.routing?.router_id;
            lines.push(`router ospf ${RaisecomRosRender.OSPF_PROCESS}${routerId ? ` router-id ${routerId}` : ""}`);

            for (const [areaId, area] of Object.entries(ospf.areas)) {
                for (const iface of Object.keys(area.interfaces)) {
                    for (const prefix of Derive.ipv4Networks(device, iface)) {
                        lines.push(`network ${Address.host(prefix)} ${Address.wildcard(Address.split(prefix).len)} area ${areaId}`);
                    }
                }
            }

            for (const source of ospf.redistribute ?? []) lines.push(`redistribute ${source}`);
            lines.push("!");
        }

        // Storm control acts only once detection is on.
        if (Object.values(device.ports ?? {}).some((port) => port?.storm_control)) lines.push("storm-control detection enable");
        if (device.system?.transceiver_monitoring) lines.push("transceiver ddm enable");
        // LLDP and spanning tree are off by default and turned on by the config.
        if (device.lldp) lines.push("lldp enable");
        if (device.stp) {
            lines.push("spanning-tree enable");
            if (device.stp.priority !== undefined) lines.push(`spanning-tree priority ${device.stp.priority}`);
        }

        // The factory communities survive a reset, and one of them can write, so they are always removed.
        lines.push("no snmp-server community public", "no snmp-server community private");
        const snmp = management.snmp;
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

        if ((snmp?.community || snmpUsers.length) && allow.length)
            lines.push(`snmp-server access-list ${RaisecomRosRender.MANAGEMENT_ACL}`);

        for (const route of device.routing?.static ?? []) {
            const { addr, len } = Address.split(route.prefix);
            if (Address.family(addr) === "ipv4" && route.via) lines.push(`ip route ${addr} ${Address.netmask(len)} ${route.via}`);
        }

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

        return lines.join("\n") + "\n";
    }

    /** Access or trunk membership, for a port or a LAG. */
    private static switching(settings: Switched<string>, vlanId: (name: string) => number): string[] {
        const lines: string[] = [];
        if (settings.access_vlan) lines.push(`switchport access vlan ${vlanId(settings.access_vlan)}`);

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

    /** A port the config does not declare is shut down. A LAG member holds its membership and description; the LAG holds the rest. */
    private static physicalPort(
        settings: AnyPort | undefined,
        vlanId: (name: string) => number,
        lagNumbers: Map<string, number>
    ): string[] {
        if (!settings) return ["shutdown"];

        const lines: string[] = [];
        if (settings.description) lines.push(`description ${settings.description}`);
        if (settings.lag) return [...lines, `port-channel ${lagNumbers.get(settings.lag)}`];

        lines.push(...RaisecomRosRender.switching(settings, vlanId));

        if (settings.lldp === false) lines.push("lldp disable");
        if (settings.stp === false) lines.push("spanning-tree disable");
        const broadcast = settings.storm_control?.broadcast;
        if (broadcast && "pps" in broadcast) lines.push("storm-control mode pps", `storm-control broadcast pps ${broadcast.pps}`);
        return lines;
    }
}
