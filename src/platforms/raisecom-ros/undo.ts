// How each line of the Raisecom ROS config is taken away: most by `no` and the line, some by `no` and their keyword, and some by another line. A RAX721 on ROS 6.5.2 showed which (TRAPS.md).

import { RaisecomRosBgp } from "./bgp";
import { RaisecomRosIsis } from "./isis";

export class RaisecomRosUndo {
    /** Lines whose opposite is not `no` and the line. */
    private static readonly OPPOSITES: [RegExp, string][] = [
        [/^mode manual$/, "mode lacp"],
        [/^ip ospf passive-interface enable$/, "ip ospf passive-interface disable"],
        [/^lldp disable$/, "lldp enable"],
        [/^spanning-tree disable$/, "spanning-tree enable"],
        [/^switchport mode (trunk|private-vlan (host|promiscuous))$/, "switchport mode access"],
        [/^telnet-server disable$/, "telnet-server enable"],
        [/^shutdown$/, "no shutdown"],
        // `no isis bfd enable` is refused at `enable`, and `no isis bfd` is incomplete.
        [/^isis bfd enable$/, "isis bfd disable"],
        // `no` is refused for these, and `auto` is the default edge setting.
        [/^spanning-tree rootguard enable$/, "spanning-tree rootguard disable"],
        [/^spanning-tree bpduguard enable$/, "spanning-tree bpduguard disable"],
        [/^spanning-tree edged-port force-(true|false)$/, "spanning-tree edged-port auto"],
        // The device refuses `no storm-control mode`, and kbps is its default and prints nothing.
        [/^storm-control mode pps$/, "storm-control mode kbps"],
    ];

    /** Lines whose removal takes only their keyword, not their value. */
    private static readonly BY_KEYWORD =
        /^(description|switchport access vlan|switchport trunk native vlan|switchport trunk allowed vlan|storm-control broadcast|storm-control dlf|rate-limit ingress|rate-limit egress|port-channel|ip vrf forwarding|ip urpf|ip ospf cost|ip ospf network|ip ospf hello-interval|ip ospf dead-interval|ip ospf priority|switchport port-security maximum|switchport private-vlan host-association|switchport private-vlan mapping|tpid|gateway|lease expired)\b/;

    static of(line: string, path: readonly string[] = []): string {
        for (const [pattern, opposite] of RaisecomRosUndo.OPPOSITES) if (pattern.test(line)) return opposite;
        // A port's spanning tree priority goes back to its default by keyword.
        if (path[0]?.startsWith("interface ") && line.startsWith("spanning-tree instance 0 priority "))
            return "no spanning-tree instance 0 priority";
        if (/^rule \d+/.test(line)) return `no ${line.split(" ").slice(0, 2).join(" ")}`;

        const routing = RaisecomRosBgp.undo(line, path) ?? RaisecomRosIsis.undo(line);
        if (routing) return routing;

        // A VRRP group goes with its address, and its other settings return to their defaults by keyword. Preemption is on unless turned off.
        const vrrp = /^(no )?vrrp (\d+) (ip \S+|priority|timers advertise-interval|preempt)/.exec(line);
        if (vrrp) return vrrp[1] ? `vrrp ${vrrp[2]} preempt` : `no vrrp ${vrrp[2]} ${vrrp[3]}`;

        // A route goes by its VRF, prefix, next hop, and interface, whatever it tracks: without its interface, `no ip route` answers `Set successfully.` and keeps it. A BFD session goes by its number.
        const toNull = /^(ip route (?:vrf \S+ )?\S+ \S+) null 0$/i.exec(line);
        if (toNull) return `no ${toNull[1]} null 0`;

        const route = /^(ip route (?:vrf \S+ )?\S+ \S+ \S+(?: (?!track )\S+ \S+)?)/.exec(line);
        if (route) return `no ${route[1]}`;

        // A list goes by its number, whatever its name. A private VLAN's secondaries and a translation go by the VLAN they start with.
        const list = /^(access-list \d+) name /.exec(line);
        if (list) return `no ${list[1]}`;

        const byFirstVlan = /^(private-vlan association \d+|switchport vlan-mapping both outer \d+) /.exec(line);
        if (byFirstVlan) return `no ${byFirstVlan[1]}`;

        const bfdSession = /^bfd (\d+) bind /.exec(line);
        if (bfdSession) return `no bfd ${bfdSession[1]}`;

        // An address goes by itself, without its mask: `no ip address` alone is incomplete on a routed port.
        const address = /^ip address (\S+) /.exec(line);
        if (address) return `no ip address ${address[1]}`;

        // An OSPF key goes by its ID, as the read hides the key itself. Not tried on a switch: OSPF's keys are experimental.
        const ospfKey = /^(ip ospf authentication-key (?:md5 \d+|simple)) /.exec(line);
        if (ospfKey) return `no ${ospfKey[1]}`;

        const ospfProcess = /^router ospf (\d+)/.exec(line);
        if (ospfProcess) return `no router ospf ${ospfProcess[1]}`;

        // An SNMPv3 user, its group, and its access are each removed by their name alone.
        const snmpUser = /^snmp-server user (\S+)/.exec(line);
        if (snmpUser) return `no snmp-server user ${snmpUser[1]}`;

        const snmpGroup = /^snmp-server group \S+ user (\S+) usm$/.exec(line);
        if (snmpGroup) return `no snmp-server group user ${snmpGroup[1]} usm`;

        const snmpAccess = /^snmp-server access (\S+) .* usm (\S+)$/.exec(line);
        if (snmpAccess) return `no snmp-server access ${snmpAccess[1]} usm ${snmpAccess[2]}`;

        // A log host and a trap receiver go by their address, whatever their level and port. A reservation goes without its pool, and a pool's secondary DNS server by its kind.
        const byAddress = /^(logging host|snmp-server host) (\S+)/.exec(line);
        if (byAddress) return `no ${byAddress[1]} ${byAddress[2]}`;

        const reservation = /^(ip dhcp static-bind \S+ \S+) /.exec(line);
        if (reservation) return `no ${reservation[1]}`;

        if (/^dns-server \S+ secondary$/.test(line)) return "no dns-server secondary";
        if (line.startsWith("dns-server ")) return "no dns-server";

        const keyword = RaisecomRosUndo.BY_KEYWORD.exec(line);
        if (keyword) return `no ${keyword[1]}`;

        return `no ${line}`;
    }
}
