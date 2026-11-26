// Huawei VRP on the CE series. Changes stage in a candidate and take effect at `commit`, so a refused line leaves nothing applied. Only `save` writes to flash, so a fresh login tests access before saving, and a reboot undoes an unsaved commit.

import type { Client, ClientChannel } from "ssh2";
import { Address } from "../../core/address";
import type { Neighbor } from "../../core/cabling";
import { Secrets } from "../../core/secrets";
import type { Device, Gre, Lag, Port, VlanInterface } from "../../model";
import { ConsoleShell, SerialConsole } from "../../transport/console";
import type { ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { LineDiff } from "../line-diff";
import type { Dialect, Entry, Group } from "../line-diff";
import { BgpHealth } from "../bgp-health";
import { Platform } from "../platform";
import type {
    ApplyOptions,
    BgpSession,
    HealthCheck,
    HealthOptions,
    OsSupport,
    Plan,
    ReadOptions,
    ReadSession,
    Step,
    Tool,
} from "../platform";
import { VrpAaa } from "./aaa";
import { VrpAcls } from "./acls";
import { VrpBgp } from "./bgp";
import { VrpBgpSessions } from "./bgp-sessions";
import { VrpDhcp } from "./dhcp";
import { VrpDhcpv6 } from "./dhcpv6";
import { VrpEvpn } from "./evpn";
import { VrpIsis } from "./isis";
import { VrpMarking } from "./marking";
import { VrpMonitoring } from "./monitoring";
import { VrpNetStream } from "./netstream";
import { VrpOspf } from "./ospf";
import { VrpProbes } from "./probes";
import { VrpQos } from "./qos";
import { VrpRender } from "./render";
import { VrpRouterAdvertisement } from "./router-advertisement";
import { VrpServices } from "./services";
import { VrpRoutes } from "./routes";

export class Vrp extends Platform {
    /** The question to change the password is always answered no, and a system view is left with `return`. The line's banner after a logout or a refused password is answered with Enter. Not yet tested on a device. */
    static readonly CONSOLE: ConsoleDialect = {
        login: /Username:\s*$/i,
        password: /Password:\s*$/i,
        prompt: /<[^>\n]+>\s*$/,
        logout: "quit",
        refused: /The password is invalid/i,
        others: [
            [/Please Press ENTER\.?\s*$/i, "\n"],
            [/Change now\? ?\[Y\/N\]:?\s*$/i, "N\n"],
            [/\[~?\*?[^\]\n]+\]\s*$/, "return\n"],
        ],
    };

    /** Lines the device prints whatever is configured, or that describe the hardware rather than its configuration. */
    private static readonly DEVICE_FACTS = [
        "!",
        "device ",
        "system resource",
        "drop-profile default",
        "dcb ",
        "diffserv domain default",
        "vlan reserved",
        "interface MEth",
        "interface NULL",
        "stack",
        "vm-manager",
        "return",
        "authentication-scheme default",
        "authorization-scheme default",
        "accounting-scheme default",
        "Info:",
        // Derived from the switch's MAC once SNMP is on.
        "snmp-agent local-engineid",
    ];

    /** Lines whose removal takes only their keyword, not their value. */
    private static readonly UNDO_BY_KEYWORD =
        /^(description|name|port default vlan|port link-type|port trunk pvid vlan|set authentication password|eth-trunk|ip binding vpn-instance|ssh server cipher|ssh server hmac|ssh server key-exchange|info-center max-logfile-number|info-center source default channel \d+ log level|info-center loghost \S+(?: vpn-instance \S+)?|alarm \S+ severity|ip route-static bfd \S+|mac-address limit|ospf timer hello|ospf timer dead|ospf authentication-mode|ospf dr-priority|ospf network-type|stub|nssa|default-cost|default-domain admin|cmd recording-scheme|hwtacacs server source-ip|recording-mode)\b/;

    /** Lines a new line of the same kind replaces whole, so the old one is not undone first: a static route's BFD template, and a port's CAR profile. */
    private static readonly REPLACED_WHOLE = /^(ip route-static bfd \S+|qos car (?!inbound )\S+) /;

    private static readonly DIALECT: Dialect = {
        // A VRF's `ipv4-family` and `ipv6-family` hold nothing, but each enters a view of its own all the same.
        block: /^(interface |vlan \d+$|acl (?:number|name|ipv6) |bridge-domain |diffserv domain |aaa$|user-interface |ospf \d+|isis \d+$|ip vpn-instance |ip pool |bfd$|alarm$|route-policy |bgp |traffic (?:classifier|behavior|policy) |ipv[46]-family$)/,
        indented: true,
        terminator: "#",
        // The users' domain is the switch's. The administrators' is read, as `system.aaa` gives it schemes.
        ignore: (line) => line === "domain default" || Vrp.DEVICE_FACTS.some((fact) => line.startsWith(fact)),
        undo: Vrp.undo,
        leave: "quit",
        // The console refuses to drop its password while password login is still on, and IS-IS its last NET.
        first: /^(authentication-mode|network-entity) /,
        canon: Vrp.canon,
        order: Vrp.order,
        head: (line) =>
            VrpBgp.head(line) ??
            VrpMarking.head(line) ??
            VrpIsis.head(line) ??
            VrpOspf.head(line) ??
            VrpDhcpv6.head(line) ??
            VrpNetStream.head(line) ??
            VrpMonitoring.head(line) ??
            Vrp.head(line),
    };

    /** Blocks other blocks refer to come first: VRFs, VLANs, ACLs, login servers, users, BFD, DHCPv6 pools, then marking's classifiers, behaviors, and policy, then the DiffServ domain ports trust. Then come device-wide lines, such as prefix lists, then route-policies, which IS-IS names, IS-IS, which interfaces name, LAGs, ports, VLAN interfaces, OSPF, BGP, and the rest, such as logins. */
    private static readonly BLOCK_ORDER = [
        /^(ip vpn-instance|vlan |acl |radius server group|hwtacacs server template|aaa|bfd|dhcpv6 pool )/,
        /^traffic (classifier|behavior) /,
        /^traffic policy /,
        /^diffserv domain /,
        /^$/,
        /^bridge-domain /,
        /^route-policy /,
        /^isis /,
        /^interface Eth-Trunk/,
        /^interface (?!Vlanif|Nve)/,
        /^interface Vlanif/,
        /^interface Nve/,
        /^ospf /,
        /^bgp /,
    ];

    /** The platform offers an ECDSA host key it then signs wrongly, so RSA is asked for. */
    private static readonly HOST_KEYS = ["ssh-rsa"];

    private static readonly REFUSED = /^\s*Error|Unrecognized command|Incomplete command|Wrong parameter|Too many parameters/m;

    /** A setting whose password the platform asks for interactively: the command, then the password, then the password again. */
    private static readonly INTERACTIVE =
        /^(snmp-agent usm-user v3 \S+ (?:authentication|privacy)-mode \S+) cipher <secret:([A-Za-z0-9_./:-]+)>$/;

    private static readonly NOT_SAVED = "Not saved: a reboot restores the previous configuration.";

    /** A `?` sent by a script is run, not taken as help, so a line with one is refused. */
    private static readonly READS = /^display\s[^?]*$/;

    private static readonly COMMAND_TIMEOUT_MS = 10_000;
    private static readonly PROMPT_TIMEOUT_MS = 15_000;
    private static readonly LINE_TIMEOUT_MS = 20_000;
    private static readonly SLOW_TIMEOUT_MS = 60_000;
    private static readonly READ_TIMEOUT_MS = 120_000;
    private static readonly PROMPT_SETTLE_MS = 1500;
    private static readonly PASSWORD_SETTLE_MS = 900;
    private static readonly LINE_SETTLE_MS = 800;
    private static readonly SAVE_SETTLE_MS = 2000;
    private static readonly SLOW_SETTLE_MS = 3000;
    private static readonly WRITE_SETTLE_MS = 5000;

    /** How much of the device's answer an error shows. */
    private static readonly ANSWER_CHARS = 300;

    /** Ranges the platform takes. */
    private static readonly BFD_INTERVAL_MS = { min: 50, max: 1000 };
    private static readonly BFD_MULTIPLIER = { min: 3, max: 50 };

    override readonly name = "vrp";

    override readonly os: OsSupport = {
        name: "Huawei VRP",
        versions: "V200R005",
        testedOn: "CE6855-48S6Q-HI, V200R005C00SPC800",
        checked: false,
    };

    override readonly extension = ".cfg";

    override readonly console = Vrp.CONSOLE;

    /** A CE6855 printed its sessions, but none came up: the switch has no peer, and refused a route from the main table to a VRF of its own. */
    override readonly experimentalTools: readonly Tool[] = ["bgp", "health"];

    override unsupported(device: Device): string[] {
        const found: string[] = [];

        if (device.management?.interfaces) found.push("management.interfaces, which only FortiOS builds for now");

        const interfaces = Derive.interfaces(device);

        for (const { name, kind, settings } of interfaces) {
            // A CE6855 refused a second `l2 binding vlan` in a bridge domain, and one for a VLAN with a VLAN interface (TRAPS.md).
            if (kind === "bridge")
                found.push(
                    `interfaces.bridge.${name}, a bridge: a CloudEngine bridge domain binds one VLAN, and no VLAN that has a VLAN interface`
                );
            if (kind === "vlan_interface" && (settings as VlanInterface).mac)
                found.push(`interfaces.vlan_interface.${name}.mac, which only RouterOS sets for now`);
        }

        for (const [name, port] of Derive.ports(device)) {
            for (const field of ["speed", "mtu", "hardware_offload"] as const) {
                if (port[field] !== undefined) found.push(`interfaces.ethernet.${name}.${field}, ports are switched; use a VLAN interface`);
            }

            // A CE6855 refused `undo portswitch` until VLANs are reserved for routed ports (TRAPS.md), a range of the network's own.
            for (const field of ["addresses", "urpf", "vrrp", "vrf", "ipv6_ra"] as const) {
                if (port[field] !== undefined)
                    found.push(
                        `interfaces.ethernet.${name}.${field}, a routed port: the switch routes a port only on a VLAN it reserves for it, which Circuit has no key for. Use a VLAN interface`
                    );
            }

            for (const field of ["mac_limit", "ethertypes"] as const) {
                if (port[field] !== undefined && port.in_lag)
                    found.push(`interfaces.ethernet.${name}.${field} on a LAG member, set it on the LAG`);
            }

            if (port.lldp === true && !device.switching?.lldp)
                found.push(`interfaces.ethernet.${name}.lldp true while LLDP is off on the device`);
            const storm = Object.values(port.storm_control ?? {});
            if (storm.some((threshold) => "pps" in threshold))
                found.push(`interfaces.ethernet.${name}.storm_control in pps, the platform takes percent`);
        }

        for (const { name, kind, settings } of interfaces) {
            const where = `interfaces.${kind}.${name}`;
            if (kind === "ipsec") found.push(`${where}, IPsec: a CloudEngine switch does not encrypt the traffic it forwards`);
            else if (kind === "pseudowire") found.push(`${where}, a pseudowire, not built yet`);
            else if (kind === "pppoe_client")
                found.push(`${where}, a PPPoE client: VRP runs one on AR routers, and a CloudEngine switch has none`);
            else if (kind === "vxlan" && !("evpn" in settings && settings.evpn)) found.push(`${where}, a VXLAN without EVPN`);
            else if (!["vlan_interface", "lag", "vxlan", "loopback", "gre"].includes(kind)) found.push(`${where}, a ${kind}`);
            if (settings.vrrp?.length && kind !== "vlan_interface" && kind !== "lag") found.push(`${where}.vrrp, on VLAN interfaces only`);
            if (kind === "lag" && settings.addresses?.length) found.push(`${where}.addresses, LAGs are switched`);
            if (kind === "lag" && (settings as Lag).mac_limit !== undefined) found.push(`${where}.mac_limit, on a LAG is not tested`);
            if (kind === "lag" && (settings as Lag).ethertypes) found.push(`${where}.ethertypes, on a LAG is not tested`);
            if (settings.mtu !== undefined) found.push(`${where}.mtu`);
            const ends = kind === "gre" ? [(settings as Gre).local_address, (settings as Gre).remote_address] : [];
            if (ends.some((end) => Address.family(Address.host(end)) === "ipv6"))
                found.push(`${where}, GRE between IPv6 addresses, not built yet`);
            if (kind === "gre" && settings.vrf) found.push(`${where}.vrf, a GRE tunnel in a VRF, not tested`);
            if (settings.hardware_offload !== undefined) found.push(`${where}.hardware_offload, the switch chip forwards everything`);
            for (const group of settings.vrrp ?? []) if (Address.family(group.address) === "ipv6") found.push(`${where}.vrrp for IPv6`);
        }

        found.push(...VrpRouterAdvertisement.unsupported(device));
        const routing = device.routing;

        for (const [name, vrf] of Object.entries(routing?.vrfs ?? {})) {
            if (vrf?.description) found.push(`routing.vrfs.${name}.description`);
        }

        found.push(...VrpIsis.unsupported(device));
        if (routing?.mpls) found.push("routing.mpls, not built yet");
        for (const where of Derive.l3vpn(device)) found.push(`${where}, L3VPN, not built yet`);
        found.push(...VrpEvpn.unsupported(device));
        for (const where of Derive.vpls(device)) found.push(`${where}, a VPLS by BGP, not built yet`);
        // A CE6855 refused `rpki` and `prefix origin-validation enable`.
        if (routing?.rpki) found.push("routing.rpki, V200R005 has no route origin validation");
        found.push(...VrpOspf.unsupported(device));
        if (routing?.router_id && !routing.ospf && !routing.bgp)
            found.push("routing.router_id without routing.ospf or routing.bgp, only they use it here");

        const bfd = routing?.bfd;
        const interval = Vrp.BFD_INTERVAL_MS;
        const multiplier = Vrp.BFD_MULTIPLIER;
        if (bfd && !Vrp.inRange(bfd.interval, interval))
            found.push(`routing.bfd.interval, between ${interval.min} and ${interval.max} ms on the platform`);
        if (bfd && !Vrp.inRange(bfd.multiplier, multiplier))
            found.push(`routing.bfd.multiplier, between ${multiplier.min} and ${multiplier.max} on the platform`);

        found.push(...VrpRoutes.unsupported(device));
        found.push(...Vrp.firewallGaps(device), ...VrpAcls.unsupported(device), ...VrpDhcp.unsupported(device));
        found.push(...VrpDhcpv6.unsupported(device));
        for (const where of Derive.radiusLeases(device)) found.push(`${where}, a lease checked by RADIUS, not built for VRP`);

        if (device.system?.hardware_offload !== undefined) found.push("system.hardware_offload");
        found.push(...VrpServices.unsupported(device));

        if (device.system?.users?.admin) found.push("system.users.admin, the platform reserves the name");
        found.push(...VrpAaa.unsupported(device));
        found.push(...VrpBgp.unsupported(device));

        const lldp = device.switching?.lldp;
        if (lldp && lldp !== true) found.push("switching.lldp.interfaces, use lldp on the ports instead");

        // The CE6855 on V200R005 refused `ipv6 nd raguard`, `ipv6 raguard`, and `nd raguard` in every view.
        const noRaGuard = "the platform has no RA guard command";
        if (device.switching?.ra_guard) found.push(`switching.ra_guard, ${noRaGuard}`);
        const holders = Derive.switchedHolders(device).filter(({ settings }) => !("in_lag" in settings && settings.in_lag));
        for (const { where, settings } of holders) if (settings.ra_trusted) found.push(`${where}.ra_trusted, ${noRaGuard}`);
        // The CE6855 took `arp anti-attack check user-bind enable` in a VLAN's view only (TRAPS.md).
        if (device.switching?.arp_inspection)
            found.push("switching.arp_inspection, the platform checks a whole VLAN, and whether it passes dhcp_trusted ports is not known");
        // Snooping runs on each port, over all of its VLANs.
        for (const { where, settings } of device.switching?.dhcp_snooping ? Derive.switchedHolders(device) : [])
            if (settings.qinq_vlan) found.push(`${where}.qinq_vlan beside switching.dhcp_snooping, which the platform runs on every VLAN`);
        for (const { where, settings } of Derive.switchedHolders(device))
            if (settings.vlan_translation) found.push(`${where}.vlan_translation, which only Junos builds for now`);
        const { tpid, innerVlans } = Derive.stackedTags(device);
        for (const where of tpid) found.push(`${where}, which only RouterOS builds for now`);
        // A CE6855 refused `qinq termination` in a VLAN interface's view, and a sub-interface on a port that is not routed (TRAPS.md).
        for (const where of innerVlans)
            found.push(`${where}, a VLAN interface on V200R005 ends no inner VLAN, and a sub-interface needs a routed port`);
        // MUX VLAN, the platform's counterpart, went into a CE6855's candidate, but how a trunk carries it is not known (TRAPS.md).
        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {}))
            if (vlan?.private_vlan) found.push(`switching.vlans.${name}.private_vlan, which only Junos and RouterOS build for now`);

        // `stp bpdu-protection` guards every edge port at once.
        const stpOf = (settings: Port | Lag) => (typeof settings.stp === "object" ? settings.stp : undefined);
        const edges = holders.filter(({ settings }) => stpOf(settings)?.edge);
        if (edges.some(({ settings }) => stpOf(settings)?.bpdu_guard)) {
            for (const { where, settings } of edges)
                if (!stpOf(settings)?.bpdu_guard)
                    found.push(`${where}.stp without bpdu_guard, the platform guards every edge port or none: write it on each`);
        }

        const system = device.system ?? {};

        if (system.release_channel || system.banner) found.push("system.release_channel and banner");

        found.push(...VrpMonitoring.unsupported(device), ...VrpNetStream.unsupported(device), ...VrpProbes.unsupported(device));

        // SNMP takes sources of its own here, in an ACL of its own.
        found.push(...Derive.switchUnsupported(device, ["snmp"], true));
        // One key per user, as `ssh user ... assign` takes one. RSA only: V200R005 has no ed25519, and ECDSA is not tested.
        for (const [name, user] of Object.entries(device.system?.users ?? {})) {
            const keys = user?.ssh_keys ?? [];
            if (keys.length > 1) found.push(`system.users.${name}.ssh_keys, more than one: a user takes one key`);
            keys.forEach((key, index) => {
                if (!key.startsWith("ssh-rsa "))
                    found.push(`system.users.${name}.ssh_keys[${index}], not RSA: the platform takes RSA keys only`);
            });
            if (keys.length && name.length > VrpRender.KEY_NAME)
                found.push(`system.users.${name}.ssh_keys, a key named after a user over ${VrpRender.KEY_NAME} characters`);
        }
        found.push(...Derive.untested(device, ["alarm-severity", "bfd-timers", "static-route-bfd", "mac-limit", "ethertype-filter"]));
        found.push(
            ...Derive.unbuilt(device, [
                "urpf",
                "rate-limit",
                "rate-limit-per-prefix",
                "marking",
                "marking-class",
                "queues",
                "ospf-ranges",
                "ospf-range-cost",
                "ospf-priority",
                "ospf-unicast-links",
                "ospf-virtual-links",
            ]),
            ...VrpMarking.unsupported(device),
            ...VrpQos.unsupported(device)
        );

        for (const { where, kind, rateLimit } of Derive.rateLimited(device)) {
            if (kind === "vlan_interface") found.push(`${where}.rate_limit, on a VLAN interface, which is not built yet`);
            for (const direction of ["input", "output"] as const) {
                const limit = rateLimit[direction];
                const bits = limit && Derive.bitsPerSecond(Derive.limit(limit).rate);
                if (bits && !Number.isInteger(bits / VrpRender.BITS_PER_KBIT))
                    found.push(`${where}.rate_limit.${direction}, the platform takes a rate in whole kbit/s`);
            }
        }

        for (const { where, kind, settings } of Derive.holders(device)) {
            if (kind === "ethernet" || !settings.urpf) continue;
            if (kind !== "vlan_interface") found.push(`${where}.urpf, only on a VLAN interface`);
            else if (settings.urpf.ipv4 === "strict") found.push(`${where}.urpf.ipv4 strict, the CE6855 checks in loose mode only`);
            if (settings.urpf.ipv6) found.push(`${where}.urpf.ipv6, which the platform does not build`);
        }

        return found;
    }

    /** Built from Huawei's documentation and not tested on a switch (decision 114): `ip urpf enable`, some of OSPF (`VrpOspf`), and a BGP session from an IPv6 address. The spanning tree guards, DHCP snooping, and QinQ went into a candidate on a CE6855, so how the switch prints them is not known. Rate limits and NetStream were committed on a spare port, but no packet crossed it. */
    override experimental(device: Device): string[] {
        const found = Object.entries(device.interfaces?.vlan_interface ?? {})
            .filter(([, iface]) => iface?.urpf?.ipv4 === "loose")
            .map(([name]) => `interfaces.vlan_interface.${name}.urpf.ipv4`);

        if (device.switching?.dhcp_snooping) found.push("switching.dhcp_snooping");
        // `snmp-agent protocol vpn-instance` went into a candidate only: the switch's own SNMP would have left the network that polls it.
        if (device.monitoring?.snmp?.vrf) found.push("monitoring.snmp.vrf");
        // NetStream was committed on a CE6855, but no packet crossed a watched port, and Huawei's documentation doesn't list it for the CE6855HI.
        if (device.monitoring?.flow_export?.protocol === "netflow-v9") found.push("monitoring.flow_export");
        // A pool was committed on a CE6855, but `dhcp enable` went into a candidate only, and no client has asked it for an address.
        for (const name of Object.keys(device.services?.dhcp_server ?? {})) found.push(`services.dhcp_server.${name}`);
        found.push(
            ...VrpBgp.experimental(device),
            ...VrpMarking.experimental(device),
            ...VrpQos.experimental(device),
            ...Derive.evpn(device)
        );
        for (const { where, kind } of Derive.rateLimited(device)) if (kind !== "vlan_interface") found.push(`${where}.rate_limit`);
        for (const { where, settings } of Derive.switchedHolders(device)) {
            const stp = typeof settings.stp === "object" ? settings.stp : undefined;
            if (stp?.bpdu_guard) found.push(`${where}.stp.bpdu_guard`);
            if (stp?.guard) found.push(`${where}.stp.guard`);
            if (settings.dhcp_trusted) found.push(`${where}.dhcp_trusted`);
            if (settings.qinq_vlan) found.push(`${where}.qinq_vlan`);
        }

        found.push(...VrpOspf.experimental(device));
        return found;
    }

    /** Each filter chain is refused with what stands in its way. `Derive.unbuilt` refuses TCP MSS clamps. */
    private static firewallGaps(device: Device): string[] {
        const { filter, tcp_mss: _tcpMss, ipsec, ...rest } = device.firewall ?? {};
        const found = Object.keys(rest).map((key) => `firewall.${key}`);
        if (ipsec) found.push("firewall.ipsec, IPsec: a CloudEngine switch does not encrypt the traffic it forwards");

        if (filter?.input)
            found.push(
                "firewall.filter.input, V200R005 filters traffic to the switch only with a blacklist, which drops what it lists; management.allow guards SSH and SNMP"
            );
        if (filter?.forward)
            found.push(
                "firewall.filter.forward, the switch's traffic filter checks what it switches as well as what it routes: use switching.acls on the ports"
            );
        if (filter?.output) found.push("firewall.filter.output, the switch filters nothing it sends itself");

        return found;
    }

    /** An ACL rule's description is a setting of its own beside the rule. A pool's lists take more than one value, so a line that changes is undone whole. */
    private static head(line: string): string {
        const description = /^rule \d+ description/.exec(line);
        if (description) return description[0];
        // A second NET is added beside the first, rather than replacing it. So are an OSPF area's ranges and virtual links, and a DNS server. A prefix a router advertisement announces is undone before it changes.
        if (
            /^(gateway-list|dns-list|excluded-ip-address|static-bind|network-entity|abr-summary|vlink-peer|ipv6 nd ra prefix|dns server) /.test(
                line
            )
        )
            return line;

        return LineDiff.head(line);
    }

    override render(device: Device): string {
        return VrpRender.of(device);
    }

    override async read(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<string> {
        if (options.console) {
            return Vrp.onConsole(device, async (channel) => Vrp.configurationOf(device, await Vrp.dump(channel)));
        }

        const client = await Vrp.login(device);

        try {
            const channel = await Vrp.openShell(client);
            const dump = await Vrp.dump(channel);
            channel.end();

            return Vrp.configurationOf(device, dump);
        } finally {
            client.end();
        }
    }

    /** VLANs no longer used go first, with their VLAN interfaces, so their names and numbers are free for a new VLAN. A VLAN name is unique, and a VLAN with an interface cannot be removed. The whole plan is one candidate, so nothing is left half done. */
    override plan(desired: string, current: string, options: ApplyOptions): Plan {
        const compared = LineDiff.compare(desired, current, Vrp.DIALECT);
        const groups = options.secrets ? LineDiff.withSecrets(compared, desired, Vrp.DIALECT) : compared;
        LineDiff.vlanListChange(
            groups,
            "vlan batch ",
            Vrp.batchIds,
            (ids) => [`vlan batch ${VrpRender.vlanBatch(ids)}`],
            (ids) => [`vlan batch ${VrpRender.vlanBatch(ids)}`]
        );

        Vrp.removeLoghosts(groups, desired, current);
        Vrp.replaceRules(groups, desired, current);
        VrpDhcp.rebuild(groups, desired, current, Vrp.DIALECT);
        const probes = VrpProbes.order(groups, desired, current, Vrp.DIALECT);
        VrpDhcpv6.order(groups);
        Vrp.emptyAlarmView(groups, current);
        Vrp.keepReplacedWhole(groups);
        VrpAaa.order(groups, desired, current, Vrp.DIALECT);
        VrpMarking.order(groups);
        const domains = VrpQos.order(groups, desired, Vrp.DIALECT);
        const keys = Vrp.keySteps(groups, desired, current);
        const problems = [...keys.problems, ...VrpEvpn.problems(desired, current, Vrp.DIALECT)];
        if (problems.length) return { steps: [], problems };

        const top = groups.find((group) => group.path.length === 0);
        const removedBatch = top?.remove.find((line) => line.startsWith("vlan batch ")) ?? "";
        const removedIds = removedBatch ? Vrp.batchIds(removedBatch) : [];

        const firstRemovals = [
            ...removedIds.map((id) => `interface Vlanif${id}`).filter((line) => top?.remove.includes(line)),
            ...removedIds.map((id) => `vlan ${id}`).filter((line) => top?.remove.includes(line)),
            ...(removedBatch ? [removedBatch] : []),
        ];

        // An ACL still bound to a service cannot be removed, so ACLs go after every binding has moved.
        const lastRemovals = top?.remove.filter((line) => /^acl (number \d+|(ipv6 )?name \S+ advance)$/.test(line)) ?? [];
        // A DHCPv6 pool goes once its VLAN interface lets go of it.
        const pools = top?.remove.filter((line) => line.startsWith("dhcpv6 pool ")) ?? [];
        const unused = VrpBgp.order(groups, desired, Vrp.DIALECT);
        const isis = VrpIsis.removed(top);

        const later = [...firstRemovals, ...lastRemovals, ...pools];
        if (top) top.remove = top.remove.filter((line) => !later.includes(line));
        const through = VrpRoutes.throughInterfaces(top);

        const planned = LineDiff.steps(
            groups.filter((group) => group.add.length || group.remove.length),
            Vrp.DIALECT
        );

        if (firstRemovals.length) {
            // `undo vlan batch` removes a VLAN's own settings with it, so only the interfaces and the list are sent.
            const sent = firstRemovals.filter((line) => !/^vlan \d+$/.test(line)).map((line) => Vrp.undo(line));
            planned.unshift({ title: "VLANs no longer used", show: firstRemovals.map((line) => `- ${line}`), send: sent });
        }

        VrpRoutes.place(planned, through, (line) => Vrp.undo(line));

        planned.push(
            ...Vrp.removal("ACLs no longer used", lastRemovals),
            ...Vrp.removal("DHCPv6 pools no longer used", pools),
            ...Vrp.removal("DiffServ domains no longer used", domains),
            ...Vrp.removal("IS-IS no longer used", isis),
            ...Vrp.removal("Route policies and lists no longer used", unused),
            ...Vrp.removal("ICMP probes no longer used", probes)
        );

        return { steps: [...keys.first, ...planned, ...keys.last], problems: [] };
    }

    /** A step that removes what is no longer used, after the steps that let go of it. None when nothing goes. */
    private static removal(title: string, lines: string[]): Step[] {
        return lines.length ? [{ title, show: lines.map((line) => `- ${line}`), send: lines.map((line) => Vrp.undo(line)) }] : [];
    }

    override async apply(device: Device, _network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void> {
        // On the console, a fresh login on the same console is the proof, and the save is sent in it.
        if (options.console) {
            await Vrp.onConsole(device, async (channel, relogin) => {
                await Vrp.commitPlan(channel, plan);
                await relogin().catch((error: Error) => {
                    throw new Error(`committed, but a fresh login on the console failed: ${error.message}. ${Vrp.NOT_SAVED}`);
                });
                await Vrp.save(channel);
            });

            console.log("  committed, logged in again, saved");
            return;
        }

        const client = await Vrp.login(device);
        const channel = await Vrp.openShell(client);

        try {
            await Vrp.commitPlan(channel, plan);

            const proof = await Ssh.retrying(() => Vrp.login(device)).catch(() => undefined);
            if (!proof)
                throw new Error(`committed, but a fresh login failed. ${Vrp.NOT_SAVED} Recover over the open session or the console.`);
            proof.end();

            await Vrp.save(channel);
        } finally {
            channel.end();
            client.end();
        }

        console.log("  committed, logged in again, saved");
    }

    override async neighbors(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<Neighbor[]> {
        const session = await this.session(device, options);

        try {
            return Vrp.neighborsOf(device, await session.run("display lldp neighbor", Vrp.SLOW_TIMEOUT_MS));
        } finally {
            session.close();
        }
    }

    /** A header per port, `10GE1/0/2 has 1 neighbor(s):`, then a block per neighbor where `Port ID` comes before `System name`. A port Circuit does not know, such as the management port, is left out. */
    static neighborsOf(device: Device, output: string): Neighbor[] {
        const ports = Catalog.ports(device.platform, device.model);
        const byName = new Map(ports.map((port) => [Catalog.spell(device.platform, device.model, port), port]));

        const neighbors: Neighbor[] = [];
        let port: string | undefined;
        let remotePort: string | undefined;

        for (const line of output.replace(/\r/g, "").split("\n")) {
            const header = /^(\S+) has \d+ neighbor\(s\)/.exec(line);
            if (header) {
                port = byName.get(header[1]!);
                remotePort = undefined;
                continue;
            }

            const remote = /^Port ID\s*:(.*)$/.exec(line);
            if (remote) remotePort = remote[1]!.trim();

            const system = /^System name\s*:(.*)$/.exec(line)?.[1]?.trim();
            if (port && remotePort && system) neighbors.push({ port, system, remote_port: remotePort });
        }

        return neighbors;
    }

    override bgpSessions(device: Device, session: ReadSession): Promise<BgpSession[]> {
        return VrpBgpSessions.read(device, session);
    }

    /** Each BGP session established before the apply must be established again. */
    override health(device: Device, _plan: Plan, options: HealthOptions = {}): Promise<HealthCheck> {
        return BgpHealth.check(this, device, options);
    }

    override readOnly(command: string): boolean {
        return Vrp.READS.test(command);
    }

    /** One shell for every command, as the platform takes commands only there. */
    override async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        if (options.console) {
            const opened = await Vrp.openConsole(device);
            const shell = new ConsoleShell(opened.channel, Vrp.CONSOLE, ConsoleShell.SETTLE);

            return {
                run: (command, timeout) => shell.run(command, timeout),
                close: () => {
                    shell.logout();
                    void opened.close();
                },
            };
        }

        const client = await Vrp.login(device);
        const channel = await Vrp.openShell(client).catch((error: Error) => {
            client.end();
            throw error;
        });
        const shell = new ConsoleShell(channel, Vrp.CONSOLE, ConsoleShell.SETTLE);

        return {
            run: (command, timeout) => shell.run(command, timeout),
            close: () => {
                channel.end();
                client.end();
            },
        };
    }

    private static undo(line: string, path: readonly string[] = []): string {
        // A negated line is undone by stating it.
        if (line.startsWith("undo ")) return line.slice("undo ".length);
        // A domain lets go of a scheme, a server group, or its level by the keyword alone: `undo radius server group`.
        if (path[0] === "aaa" && path[1]?.startsWith("domain ")) return `undo ${line.split(" ").slice(0, -1).join(" ")}`;
        const server = VrpAaa.undo(line);
        if (server) return server;
        const routing =
            VrpBgp.undo(line) ??
            VrpIsis.undo(line, path) ??
            VrpOspf.undo(line) ??
            VrpMarking.undo(line) ??
            VrpQos.undo(line) ??
            VrpRouterAdvertisement.undo(line) ??
            VrpNetStream.undo(line) ??
            VrpMonitoring.undo(line);
        if (routing) return routing;
        // A user's key is let go of without its name: `undo ssh user <user> assign rsa-key`.
        const assigned = /^(ssh user \S+ assign \S+-key) \S+$/.exec(line);
        if (assigned) return `undo ${assigned[1]}`;
        // A named ACL is removed by its name, and a rule's description by its rule's number.
        const named = /^(acl (?:ipv6 )?name \S+) advance$/.exec(line);
        if (named) return `undo ${named[1]}`;
        const description = /^rule \d+ description/.exec(line);
        if (description) return `undo ${description[0]}`;
        // An ACL rule is removed by its number.
        if (/^rule \d+/.test(line)) return `undo ${line.split(" ").slice(0, 2).join(" ")}`;
        const pool = Vrp.undoInPool(line, path) ?? VrpDhcpv6.undo(line, path) ?? VrpProbes.undo(line, path);
        if (pool) return pool;

        const keyword = Vrp.UNDO_BY_KEYWORD.exec(line);
        if (keyword) return `undo ${keyword[1]}`;
        // A static route is removed by its destination and next hop. Its preference, description, or BFD after them is refused.
        if (/^ipv6 route-static |^ip route-static /.test(line)) return `undo ${line.replace(/ (preference|description|bfd) .*$/, "")}`;
        // A CAR profile is removed by its name, and a rate limit by its direction.
        const car = /^qos car (inbound|\S+) /.exec(line);
        if (car) return `undo qos car ${car[1]}`;
        if (/^qos lr .* outbound$/.test(line)) return "undo qos lr outbound";
        // Storm control is removed per kind, without its rates.
        if (line.startsWith("storm control ")) return `undo ${line.replace(/ (min-rate|max-rate).*$/, "")}`;

        return `undo ${line}`;
    }

    /** A pool's network, lease, and VRF are undone by their keyword, and a static binding by its address. */
    private static undoInPool(line: string, path: readonly string[]): string | undefined {
        if (!path[0]?.startsWith("ip pool ")) return undefined;

        const keyword = /^(network|lease|vpn-instance) /.exec(line);
        if (keyword) return `undo ${keyword[1]}`;
        const binding = /^(static-bind ip-address \S+) /.exec(line);
        return binding ? `undo ${binding[1]}` : undefined;
    }

    /** Secrets the device prints as ciphers and the render writes as markers compare equal. */
    private static canon(line: string): string {
        return line
            .replace(/((?:password|community read|-mode \S+(?: key-id)?(?: \d+)?) )(?:irreversible-)?cipher \S+/g, "$1cipher <secret>")
            .replace(/(shared-key(?:-| )cipher) \S+/g, "$1 <secret>");
    }

    private static order(path: string[]): number {
        const header = path[0] ?? "";
        const rank = Vrp.BLOCK_ORDER.findIndex((pattern) => pattern.test(header));

        return rank === -1 ? Vrp.BLOCK_ORDER.length : rank;
    }

    private static inRange(value: number, range: { min: number; max: number }): boolean {
        return Number.isInteger(value) && value >= range.min && value <= range.max;
    }

    /** A log host the config no longer has is removed. One at the default level prints as `info-center loghost <address>`, whose head is the bare command, so a new log host would otherwise seem to replace it. */
    private static removeLoghosts(groups: Group[], desired: string, current: string): void {
        const loghosts = (text: string) => text.split("\n").filter((line) => line.startsWith("info-center loghost "));
        const addressOf = (line: string) => line.split(" ")[2];
        const wanted = new Set(loghosts(desired).map(addressOf));

        let top = groups.find((group) => group.path.length === 0);
        if (!top) {
            top = { path: [], remove: [], add: [] };
            groups.push(top);
        }

        for (const line of loghosts(current)) {
            if (!wanted.has(addressOf(line)) && !top.remove.includes(line)) top.remove.push(line);
        }
    }

    /**
     * An ACL rule sent over a rule of the same number merges into it: `rule 10 deny` over `rule 10 permit source A` leaves `rule 10 deny source A`. A changed rule is undone first, which takes its description with it, so the description is sent again. A rule that goes takes its description too.
     */
    private static replaceRules(groups: Group[], desired: string, current: string): void {
        const existing = LineDiff.entries(current, Vrp.DIALECT);
        const wanted = LineDiff.entries(desired, Vrp.DIALECT);
        const isDescription = (line: string) => /^rule \d+ description /.test(line);

        for (const group of groups) {
            if (!group.path[0]?.startsWith("acl ")) continue;

            const inBlock = (entries: Entry[]) => entries.filter((entry) => entry.path.join("\n") === group.path.join("\n"));
            const rulesUndone = new Set<string>();

            for (const line of group.add) {
                const rule = /^rule \d+ /.exec(line)?.[0];
                if (!rule || isDescription(line)) continue;

                const old = inBlock(existing).find((entry) => entry.line.startsWith(rule) && !isDescription(entry.line));
                if (old && !group.remove.includes(old.line)) group.remove.push(old.line);
                if (old) rulesUndone.add(rule);
            }

            for (const line of group.remove) {
                const rule = /^rule \d+ /.exec(line)?.[0];
                if (rule && !isDescription(line)) rulesUndone.add(rule);
            }

            const undoneWith = (line: string) => [...rulesUndone].some((rule) => line.startsWith(`${rule}description `));
            group.remove = group.remove.filter((line) => !(isDescription(line) && undoneWith(line)));

            for (const { line } of inBlock(wanted)) {
                if (isDescription(line) && undoneWith(line) && !group.add.includes(line)) group.add.push(line);
            }
        }
    }

    /** A static route's BFD template, or a CAR profile, sent again replaces the old one whole, options left out included. So the old one is not undone: a route or a port still uses it. */
    private static keepReplacedWhole(groups: Group[]): void {
        const kind = (line: string) => Vrp.REPLACED_WHOLE.exec(line)?.[1];

        for (const group of groups) {
            const added = new Set(group.add.map(kind).filter(Boolean));
            group.remove = group.remove.filter((line) => !added.has(kind(line)));
        }
    }

    /** Each SSH key block, `rsa peer-public-key <name> ...` with its lines, by name. */
    private static keyBlocks(text: string): Map<string, string[]> {
        const blocks = new Map<string, string[]>();
        const lines = text.split(/\r?\n/);

        lines.forEach((line, index) => {
            const name = /^rsa peer-public-key (\S+)/.exec(line)?.[1];
            if (!name) return;
            const end = lines.findIndex((other, at) => at > index && other.trim() === "peer-public-key end");
            blocks.set(
                name,
                lines.slice(index, end === -1 ? undefined : end + 1).map((each) => each.trim())
            );
        });

        return blocks;
    }

    /** A key is sent whole, every line of its block. A new key goes before the lines that assign it, and a key that goes after them. Its lines leave the groups, which would send them apart. A key that changes is refused, because the switch asks before replacing one. */
    private static keySteps(groups: Group[], desired: string, current: string): { first: Step[]; last: Step[]; problems: string[] } {
        const wanted = Vrp.keyBlocks(desired);
        const had = Vrp.keyBlocks(current);
        const first: Step[] = [];
        const last: Step[] = [];
        const problems: string[] = [];

        for (const group of groups) {
            if (group.path[0]?.startsWith("rsa peer-public-key ")) {
                group.add = [];
                group.remove = [];
            }
            if (group.path.length === 0) {
                group.add = group.add.filter((line) => !line.startsWith("rsa peer-public-key "));
                group.remove = group.remove.filter((line) => !line.startsWith("rsa peer-public-key "));
            }
        }

        for (const [name, lines] of wanted) {
            const old = had.get(name);
            if (!old) first.push({ title: `SSH key ${name}`, show: lines.map((line) => `+ ${line}`), send: VrpRender.keyLines(lines) });
            else if (old.join("\n") !== lines.join("\n"))
                problems.push(
                    `the SSH key ${name} changes: the switch asks before it replaces a key, so remove it in one apply and add it in the next`
                );
        }

        for (const name of had.keys()) {
            if (!wanted.has(name))
                last.push({
                    title: `SSH key ${name}, removed`,
                    show: [`- rsa peer-public-key ${name}`],
                    send: [`undo rsa peer-public-key ${name}`],
                });
        }

        return { first, last, problems };
    }

    /** `undo alarm` is not a command: the `alarm` view goes once each line in it is undone. */
    private static emptyAlarmView(groups: Group[], current: string): void {
        const top = groups.find((group) => group.path.length === 0);
        if (!top?.remove.includes("alarm")) return;

        top.remove = top.remove.filter((line) => line !== "alarm");
        const lines = LineDiff.entries(current, Vrp.DIALECT).filter((entry) => entry.path[0] === "alarm" && entry.path.length === 1);
        groups.push({ path: ["alarm"], remove: lines.map((entry) => entry.line), add: [] });
    }

    /** The VLAN IDs of a `vlan batch` line: `vlan batch 10 20 to 30`. */
    private static batchIds(line: string): number[] {
        const words = line.replace(/^vlan batch /, "").split(" ");
        const ids: number[] = [];

        for (let index = 0; index < words.length; index++) {
            const first = Number(words[index]);

            if (words[index + 1] === "to") {
                const last = Number(words[index + 2]);
                for (let id = first; id <= last; id++) ids.push(id);
                index += 2;
            } else {
                ids.push(first);
            }
        }

        return ids;
    }

    private static async login(device: Device): Promise<Client> {
        const { port, user, password, keys } = Secrets.loginOf(device);

        return Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user,
            password,
            keys,
            hostKeys: Vrp.HOST_KEYS,
        });
    }

    /** Every login asks whether to change the password. Yes replaces it at once, and every stored credential with it, so the answer is always no. Anything sent before the question is answered is taken as the answer. */
    private static async openShell(client: Client): Promise<ClientChannel> {
        const channel = await Ssh.shell(client);
        const banner = await Ssh.readUntil(
            channel,
            (text) => /Change now\? ?\[Y\/N\]/i.test(text) || /<[^>]+>\s*$/.test(text),
            Vrp.PROMPT_TIMEOUT_MS,
            Vrp.PROMPT_SETTLE_MS
        );
        if (/Change now\?/i.test(banner)) await Ssh.send(channel, "N", Vrp.COMMAND_TIMEOUT_MS, Vrp.PROMPT_SETTLE_MS);
        await Vrp.pagingOff(channel);
        return channel;
    }

    private static async pagingOff(channel: ClientChannel): Promise<void> {
        await Ssh.send(channel, "screen-length 0 temporary", Vrp.COMMAND_TIMEOUT_MS, Vrp.PROMPT_SETTLE_MS);
    }

    private static async openConsole(device: Device) {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);

        const login = async () => {
            await SerialConsole.login(opened.channel, Vrp.CONSOLE, user, password, console.password_only);
            await Vrp.pagingOff(opened.channel);
        };

        try {
            await login();
        } catch (error) {
            void opened.close();
            throw error;
        }

        return { channel: opened.channel, login, close: opened.close };
    }

    private static async onConsole<T>(
        device: Device,
        work: (channel: ClientChannel, relogin: () => Promise<void>) => Promise<T>
    ): Promise<T> {
        const opened = await Vrp.openConsole(device);

        try {
            const result = await work(opened.channel, opened.login);
            opened.channel.write(`${Vrp.CONSOLE.logout}\n`);
            return result;
        } finally {
            void opened.close();
        }
    }

    private static dump(channel: ClientChannel): Promise<string> {
        return Ssh.send(channel, "display current-configuration", Vrp.READ_TIMEOUT_MS, Vrp.SLOW_SETTLE_MS);
    }

    /** The configuration in a dump, without the prompt or the stamp of the last change. */
    private static configurationOf(device: Device, dump: string): string {
        const lines = dump.replace(/\r/g, "").split("\n");
        const start = lines.findIndex((line) => line.startsWith("!Software Version"));
        if (start === -1) throw new Error(`${device.name} returned no configuration`);

        const body = lines.slice(start).filter((line) => !/^<.*>$/.test(line.trim()) && !line.startsWith("!Last configuration"));
        return LineDiff.scrub(`${body.join("\n").trim()}\n`);
    }

    /** A reversible cipher sits between `%^%#` marks, wherever a command prints it. */
    override scrubOutput(text: string): string {
        return LineDiff.scrub(text).replace(/%\^%#\S*?%\^%#/g, "<redacted>");
    }

    /** Answers a confirmation, or the password prompts of an interactive line. */
    private static async sendLine(channel: ClientChannel, line: string): Promise<string> {
        const interactive = Vrp.INTERACTIVE.exec(line.trim());
        if (interactive) {
            const [, command, reference] = interactive;
            const password = Secrets.valueOf(reference!);
            let answer = await Ssh.send(channel, command!, Vrp.PROMPT_TIMEOUT_MS, Vrp.PASSWORD_SETTLE_MS);
            answer += await Ssh.send(channel, password, Vrp.PROMPT_TIMEOUT_MS, Vrp.PASSWORD_SETTLE_MS);
            answer += await Ssh.send(channel, password, Vrp.PROMPT_TIMEOUT_MS, Vrp.PASSWORD_SETTLE_MS);
            return answer;
        }

        let answer = await Ssh.send(channel, Secrets.substitute(line), Vrp.LINE_TIMEOUT_MS, Vrp.LINE_SETTLE_MS);
        if (/\[Y\/N\]/i.test(answer)) answer += await Ssh.send(channel, "Y", Vrp.LINE_TIMEOUT_MS, Vrp.LINE_SETTLE_MS);
        return answer;
    }

    /** A refused line clears the candidate, which leaves the device as it was. */
    private static async commitPlan(channel: ClientChannel, plan: Plan): Promise<void> {
        try {
            await Ssh.send(channel, "system-view", Vrp.COMMAND_TIMEOUT_MS, Vrp.PROMPT_SETTLE_MS);

            for (const step of plan.steps) {
                for (const line of step.send) {
                    const answer = await Vrp.sendLine(channel, line);
                    if (Vrp.REFUSED.test(answer))
                        throw new Error(`${step.title}: ${line}\n    device said: ${answer.trim().slice(0, Vrp.ANSWER_CHARS)}`);
                }
            }

            const committed = await Ssh.send(channel, "commit", Vrp.SLOW_TIMEOUT_MS, Vrp.SLOW_SETTLE_MS);
            if (Vrp.REFUSED.test(committed)) throw new Error(`commit refused: ${committed.trim().slice(0, Vrp.ANSWER_CHARS)}`);
            await Ssh.send(channel, "quit", Vrp.COMMAND_TIMEOUT_MS);
        } catch (error) {
            await Ssh.send(channel, "clear configuration candidate", Vrp.COMMAND_TIMEOUT_MS).catch(() => undefined);
            throw error;
        }
    }

    private static async save(channel: ClientChannel): Promise<void> {
        const saving = await Ssh.send(channel, "save", Vrp.LINE_TIMEOUT_MS, Vrp.SAVE_SETTLE_MS);
        if (/\[Y\/N\]/i.test(saving)) await Ssh.send(channel, "Y", Vrp.SLOW_TIMEOUT_MS, Vrp.WRITE_SETTLE_MS);
    }
}
