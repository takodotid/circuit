// Raisecom ROS on the RAX700 series. Commands apply as they arrive and persist only on `write`. There is no rollback, so a fresh session tests access before anything is written. Until then, a reboot restores what was there before.

import type { ClientChannel } from "ssh2";
import type { Neighbor } from "../../core/cabling";
import { Secrets } from "../../core/secrets";
import type { Device, Finding } from "../../model";
import { ConsoleShell, SerialConsole } from "../../transport/console";
import type { ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Derive } from "../../core/derive";
import { LineDiff } from "../line-diff";
import type { Dialect, Group } from "../line-diff";
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
import { BgpHealth } from "../bgp-health";
import { RaisecomRosBgp } from "./bgp";
import { RaisecomRosBgpSessions } from "./bgp-sessions";
import { RaisecomRosIsis } from "./isis";
import { RaisecomRosLldp } from "./lldp";
import { RaisecomRosOspf } from "./ospf";
import { RaisecomRosRender } from "./render";
import { RaisecomRosServices } from "./services";
import { RaisecomRosSwitching } from "./switching";
import { RaisecomRosUndo } from "./undo";
import { RaisecomRosUnsupported } from "./unsupported";

/** `fresh` tests access in a fresh login: a new SSH session, or logging out and in again on the console. */
export type Session = { channel: ClientChannel; close: () => void; fresh: () => Promise<Session> };

export class RaisecomRos extends Platform {
    /** Not yet tested on a device: the RAX721's console was never cabled to a jump host. */
    static readonly CONSOLE: ConsoleDialect = {
        login: /login:\s*$/i,
        password: /password:\s*$/i,
        prompt: /[#>]\s*$/,
        logout: "exit",
        others: [[/\(config[^)\n]*\)#\s*$/, "end\n"]],
    };

    /** Lines the device prints whatever is configured, or that are part of moving around the CLI. */
    private static readonly DEVICE_FACTS = [
        "Being processed",
        "System current configuration",
        "recv-mode",
        "mpls te periodic-flooding",
        "spanning-tree region-configuration",
        "interface NULL",
        "ip rarp",
        "quit",
        "config",
        "exit",
        // Implied by any layer 2 setting on a port, so the plan sends it where needed.
        "portswitch",
        // A port's speed or duplex set back to auto prints as the default it is, and `no duplex` is refused.
        "speed auto",
        "duplex auto",
        // BGP prints an address family block for IPv6 and its VPN families whatever is set.
        "address-family",
        "policy vpn-target",
    ];

    private static readonly DIALECT: Dialect = {
        block: /^(interface |access-list |router (?:ospf|isis|bgp) |route-map |bfd \d+ bind |ip vrf (?!forwarding )|ip dhcp server pool )/,
        indented: false,
        terminator: "!",
        ignore: (line) => line.startsWith("!") || RaisecomRos.DEVICE_FACTS.some((fact) => line.startsWith(fact)),
        undo: RaisecomRosUndo.of,
        leave: "exit",
        // SNMP takes the new access-list before it lets go of the old one, so it is never left without one.
        first: /^snmp-server access-list /,
        // A password prints as a cipher and renders as a marker, and both are a secret.
        canon: (line) =>
            line
                // A routing protocol's key prints in clear, and the read hides it. Before the password below, which would take `md5` for the key.
                .replace(new RegExp(RaisecomRos.CLEAR_KEY.source), "$1 <secret>")
                .replace(/password (cipher )?(\S+)/, "password <secret>")
                .replace(/community <secret:\w+>/, "community <redacted>")
                // An SNMPv3 user prints its localized keys and renders its passphrases, and both are secrets.
                .replace(
                    /^snmp-server user (\S+) (?:authentication|authkey) (\S+) \S+ (?:privacy|privkey)\s+(\S+) \S+$/,
                    "snmp-server user $1 $2 $3 <secret>"
                )
                // A route is sent tracking `bfd N` and prints as tracking `bfd-session N`, and one to null prints it in capitals.
                .replace(/ track bfd-session (\d+)$/, " track bfd $1")
                .replace(/^(ip route .*) NULL 0$/, "$1 null 0")
                // An access group prints a notify view the render leaves to its default.
                .replace(/^(snmp-server access \S+ read \S+) notify internet (usm \S+)$/, "$1 $2")
                // A trap receiver's community prints in clear, and the read hides it.
                .replace(new RegExp(RaisecomRos.TRAP_COMMUNITY.source), "$1 <secret>"),
        order: RaisecomRos.order,
        // A pool has one range of addresses, one gateway, one lease, and one DNS server of each kind: a new one replaces the old in place.
        head: (line) =>
            /^(address|gateway|lease expired|dns-server \S+ secondary|dns-server) /
                .exec(line)?.[1]
                ?.replace(/ \S+ secondary$/, " secondary") ??
            RaisecomRosBgp.head(line) ??
            RaisecomRosIsis.head(line) ??
            LineDiff.head(line),
    };

    /** A trap receiver's community, which the switch prints in clear: `snmp-server host 192.0.2.1 version 2c <community>`. */
    private static readonly TRAP_COMMUNITY = /^(snmp-server host \S+ version 2c) \S+/gm;

    /** Lines set at the `#` prompt, as configuration mode refuses them: `hostname`, a user, and the privileged password. */
    private static readonly PRIVILEGED = /^(hostname|user name|enable password) /;

    /** Blocks after the top level. A route-map exists before a session or IS-IS names it. A LAG exists before a port joins it, and a routing process comes after its interfaces. A BFD session binds to a VLAN interface, so it comes last. Only one session binds to a peer, so an old one goes first, with the routes at the top level. A route takes a session that does not exist yet. */
    private static readonly BLOCK_ORDER = [
        /^route-map /,
        /^interface port-channel/,
        /^interface /,
        /^router ospf/,
        /^router isis/,
        /^router bgp/,
        /^bfd /,
    ];

    /** A routing protocol's key, which the switch prints in clear: OSPF's `ip ospf authentication-key md5 7 0 <key>`, a BGP session's password, and IS-IS's keys. */
    private static readonly CLEAR_KEY =
        /^(\s*(?:ip ospf authentication-key (?:md5 \d+|simple) 0|neighbor \S+ password|(?:area-password|domain-password|isis password) (?:md5|clear))) \S+$/gm;

    /** The firmware offers only an `ssh-rsa` host key, so that one is allowed for this platform alone. Key exchange, cipher, and MAC still negotiate modern ones. */
    private static readonly HOST_KEYS = ["ssh-rsa"];

    /** How long a dump may go quiet before the prompt, as on a lossy path where a retransmit stalls it for seconds, and how long it may take in all. */
    private static readonly DUMP_QUIET_MS = 30_000;
    private static readonly DUMP_LIMIT_MS = 150_000;
    private static readonly DUMP_ATTEMPTS = 3;

    /** How long the rest of a cut dump may take, ending once the device is quiet for the settle. */
    private static readonly DRAIN_TIMEOUT_MS = 30_000;
    private static readonly DRAIN_SETTLE_MS = 6000;

    private static readonly COMMAND_TIMEOUT_MS = 10_000;
    private static readonly PROMPT_TIMEOUT_MS = 15_000;
    private static readonly LINE_TIMEOUT_MS = 20_000;
    private static readonly LOGIN_TIMEOUT_MS = 30_000;
    private static readonly SLOW_TIMEOUT_MS = 60_000;
    private static readonly SETTLE_MS = 1000;
    private static readonly VERSION_SETTLE_MS = 1500;
    private static readonly LINE_SETTLE_MS = 2000;
    private static readonly WRITE_SETTLE_MS = 3000;

    /** How much of the device's answer an error shows. */
    private static readonly ANSWER_CHARS = 300;

    /** How the switch says no. Some answers carry no error word: `IP address overlaps with configured interface.`, `Malformed community-list value.`, `Parameter is error.`, `Route target is illegality.`, `Conflict with previous rule of current ACL.`, `Acl name has existed.`, `Please delete the static bind of the pool`, `Insertion failed - prefix-list entry exists.`, `The neighbor already exists in AS 64496` */
    private static readonly REFUSED =
        /^(%|Error|Incomplete|Unrecognized|Exceed|Malformed|Parameter is error|Conflict)|can not|cannot |can't |is in use|Wrong parameter|invalid|unsuccessful|overlaps|illegal|has existed|Please delete|failed|already exists in AS/im;

    /** Lines that ask for `y` and do nothing without it. */
    private static readonly CONFIRM = /^(portswitch|no portswitch|switchport trunk allowed vlan|switchport mode)/;

    /** A service letting go of an access-list, so the list can change. */
    private static readonly RELEASE = /^no (\S+ access-list \d+)$/;

    /** A VRF's own block. An interface's `ip vrf forwarding` puts the interface in one. */
    private static readonly VRF = /^ip vrf (?!forwarding )/;

    /** An interface's IP settings, which `ip vrf forwarding` removes: `All IP related configurations on this interface are removed.` */
    private static readonly IP_SETTING = /^(ip (?!vrf forwarding )|ipv6 |isis |vrrp )/;

    /** An OSPF link's timers, which a new network type sets back to the type's own. */
    private static readonly OSPF_TIMER = /^ip ospf (hello|dead)-interval /;

    /** Lines that each add one more of a kind rather than set a value: `snmp-server access-list 1001` beside `1000` binds both. */
    private static readonly STANDALONE = /^(logging host|snmp-server access-list|snmp-server host) /;

    /** Turn DHCP snooping, ARP inspection, and the DHCP relay on for the whole switch, once the ports and interfaces are set. */
    private static readonly SNOOPING = ["ip dhcp snooping", RaisecomRosSwitching.ARP_INSPECTION, ...RaisecomRosServices.RELAY];

    /** The line that lists every community VLAN. */
    private static readonly COMMUNITIES = "private-vlan community vlan ";

    /** A private VLAN's own lines, in the order they go once no port is in them: its secondaries, then their kinds, then the primary VLAN. */
    private static readonly PRIVATE_VLAN = [
        /^private-vlan association /,
        /^private-vlan community /,
        /^private-vlan isolated /,
        /^private-vlan primary /,
    ];

    /** A `?` sent by a script is run, so a line with one is refused. */
    private static readonly READS = /^show\s[^?]*$/;

    override readonly name = "raisecom-ros";

    override readonly os: OsSupport = {
        name: "Raisecom ROS",
        versions: "6.5",
        testedOn: "RAX721-C-6C48, ROS 6.5.2",
        checked: false,
    };

    override readonly extension = ".txt";

    override readonly console = RaisecomRos.CONSOLE;

    /** A RAX721 printed its sessions, but none came up: each neighbor was a documentation address routed to null. */
    override readonly experimentalTools: readonly Tool[] = ["bgp", "health"];

    override unsupported(device: Device): string[] {
        return RaisecomRosUnsupported.of(device);
    }

    /**
     * Each turns on a setting for the whole switch, so on tako-mmr-01, which carries live traffic, its line was only parsed, never sent. A trusted port's line was sent to a spare port and read back. uRPF and OSPF's areas, ranges, timers, priority, NBMA links, and keys were applied, read back, and planned empty, but the switch restarted before their removal ran.
     */
    override experimental(device: Device): string[] {
        const found: string[] = [];
        if (device.switching?.dhcp_snooping) found.push("switching.dhcp_snooping");

        for (const { where, settings } of Derive.switchedHolders(device)) {
            if (typeof settings.stp === "object" && settings.stp.bpdu_guard) found.push(`${where}.stp.bpdu_guard`);
            if (settings.dhcp_trusted) found.push(`${where}.dhcp_trusted`);
        }

        for (const { where, kind, settings } of Derive.holders(device))
            if ((kind === "ethernet" || kind === "vlan_interface") && settings.urpf?.ipv4) found.push(`${where}.urpf.ipv4`);

        return [
            ...found,
            ...RaisecomRosOspf.experimental(device),
            ...RaisecomRosBgp.experimental(device),
            ...RaisecomRosSwitching.experimental(device),
            ...RaisecomRosServices.experimental(device),
        ];
    }

    /** The switch answers time queries while it takes time from servers, and Raisecom's guide has no setting to stop it. */
    override checks(device: Device): Finding[] {
        if (!device.system?.ntp?.servers.length || device.services?.ntp_server) return [];

        const message =
            "system.ntp: the switch also answers time queries from others, and Raisecom ROS has no setting to stop it. Write services.ntp_server: true to say so";
        return [{ level: "warning", device: device.name, message }];
    }

    override render(device: Device): string {
        return RaisecomRosRender.of(device);
    }

    override async read(device: Device, _network: readonly Device[], options: ReadOptions = {}): Promise<string> {
        const { channel, close } = await RaisecomRos.open(device, options);

        try {
            // Without paging off, the dump stops halfway with no error. A complete dump ends at the prompt, so the read waits through a pause or a stall on a lossy path. One that never gets there is read again rather than planned against.
            let dump = "";
            for (let attempt = 1; ; attempt++) {
                dump = await RaisecomRos.dump(channel);
                if (/[#>]\s*$/.test(dump.replace(/\r/g, "").trimEnd())) break;
                if (attempt === RaisecomRos.DUMP_ATTEMPTS)
                    throw new Error(`${device.name} returned an incomplete configuration three times`);
                // What the device still prints of the cut dump ends before the next one starts.
                await Ssh.send(channel, "", RaisecomRos.DRAIN_TIMEOUT_MS, RaisecomRos.DRAIN_SETTLE_MS);
            }
            const lines = dump.replace(/\r/g, "").split("\n");
            const start = lines.findIndex((line) => line.trim().startsWith("!ROS version"));
            if (start === -1) throw new Error(`${device.name} returned no configuration`);

            // The prompt is not configuration, and uptime, clock, and boot count change on an untouched device.
            const body = lines.slice(start).filter((line) => line.startsWith("!") || !/[#>]\s*$/.test(line.trim()));
            const text = body
                .join("\n")
                .replace(/^!(System (up )?time|Boot times):.*\n/gm, "")
                .trim();
            return RaisecomRos.hideKeys(`${text}\n`);
        } finally {
            close();
        }
    }

    /** Ends at the prompt, or when the dump goes quiet for too long or takes too long in all. */
    private static dump(channel: ClientChannel): Promise<string> {
        const ended = (text: string) => {
            const clean = text.replace(/\r/g, "").trimEnd();
            return clean.includes("!ROS version") && /\n[^\n]*[#>]$/.test(clean);
        };

        return new Promise((done) => {
            let output = "";
            let quiet: ReturnType<typeof setTimeout>;
            let settle: ReturnType<typeof setTimeout> | undefined;

            const finish = () => {
                clearTimeout(quiet);
                clearTimeout(settle);
                clearTimeout(limit);
                channel.removeListener("data", onData);
                done(output);
            };

            const onData = (chunk: Buffer) => {
                output += chunk.toString("utf8");
                clearTimeout(quiet);
                clearTimeout(settle);
                quiet = setTimeout(finish, RaisecomRos.DUMP_QUIET_MS);
                if (ended(output)) settle = setTimeout(finish, RaisecomRos.SETTLE_MS);
            };

            const limit = setTimeout(finish, RaisecomRos.DUMP_LIMIT_MS);
            quiet = setTimeout(finish, RaisecomRos.DUMP_QUIET_MS);
            channel.on("data", onData);
            channel.write("show running-config\n");
        });
    }

    /** The detail form spells each port in full. The short form abbreviates ports, `TGE1/3/3`, and pads columns, so a name with a space cannot be told apart there. */
    override async neighbors(device: Device, _network: readonly Device[], options: ReadOptions = {}): Promise<Neighbor[]> {
        const session = await this.session(device, options);

        try {
            return RaisecomRosLldp.remotes(await session.run("show lldp remote detail", RaisecomRos.SLOW_TIMEOUT_MS), device);
        } finally {
            session.close();
        }
    }

    /** What Circuit prints of the device's answers, with the keys the read hides hidden. */
    override scrubOutput(text: string): string {
        return RaisecomRos.hideKeys(text);
    }

    /** Stored credentials print as ciphers, and an SNMPv3 user's localized keys, which authenticate as well as the passphrase, in clear. */
    private static hideKeys(text: string): string {
        return LineDiff.scrub(text)
            .replace(/(authkey \S+|privkey\s+\S+) \S+/g, "$1 <redacted>")
            .replace(RaisecomRos.CLEAR_KEY, "$1 <redacted>")
            .replace(RaisecomRos.TRAP_COMMUNITY, "$1 <redacted>");
    }

    override plan(desired: string, current: string, options: ApplyOptions): Plan {
        const compared = LineDiff.compare(desired, current, RaisecomRos.DIALECT);
        const groups = options.secrets ? LineDiff.withSecrets(compared, desired, RaisecomRos.DIALECT) : compared;

        // An access-list rule is not overwritten by one with the same number, so the old one is removed first.
        const existing = LineDiff.entries(current, RaisecomRos.DIALECT);

        for (const group of groups) {
            if (!group.path[0]?.startsWith("access-list ")) continue;

            for (const line of group.add) {
                const number = /^rule (\d+) /.exec(line)?.[1];
                if (!number) continue;

                const old = existing.find(
                    (entry) =>
                        entry.path.join("\n") === group.path.join("\n") && entry.line.startsWith(`rule ${number} `) && entry.line !== line
                );
                if (old && !group.remove.includes(old.line)) group.remove.push(old.line);
            }
        }

        // A log host, and an access-list SNMP takes, each stand alone: one that is gone is removed even when another is added beside it.
        // Compared as the dialect compares them, so a trap receiver's hidden community is the one wanted.
        const canon = RaisecomRos.DIALECT.canon!;
        const wantedLines = new Set(LineDiff.entries(desired, RaisecomRos.DIALECT).map((entry) => canon(entry.line)));
        const gone = existing.filter(
            (entry) => !entry.path.length && RaisecomRos.STANDALONE.test(entry.line) && !wantedLines.has(canon(entry.line))
        );

        if (gone.length) {
            let top = groups.find((group) => !group.path.length);
            if (!top) groups.push((top = { path: [], remove: [], add: [] }));
            for (const entry of gone) if (!top.remove.includes(entry.line)) top.remove.push(entry.line);
        }

        // A routing process goes once its interfaces and sessions let go of it, then a route-map or a list once nothing uses it.
        const top = groups.find((group) => !group.path.length);
        const lateRouting = [...RaisecomRosIsis.removed(top), ...RaisecomRosBgp.order(groups, desired)];

        // A VLAN is created in a list and removed one at a time, with `no vlan <id>`.
        LineDiff.vlanListChange(
            groups,
            "create vlan ",
            RaisecomRos.createdIds,
            (ids) => [`create vlan ${RaisecomRosRender.vlanList(ids)} active`],
            (ids) => ids.map((id) => `vlan ${id}`)
        );

        // The community VLANs print as one list too, and a gone one is taken out of it by itself.
        LineDiff.vlanListChange(
            groups,
            RaisecomRos.COMMUNITIES,
            (line) => RaisecomRos.idsOf(line.slice(RaisecomRos.COMMUNITIES.length)),
            (ids) => [`${RaisecomRos.COMMUNITIES}${RaisecomRosRender.vlanList(ids)}`],
            (ids) => [`${RaisecomRos.COMMUNITIES}${RaisecomRosRender.vlanList(ids)}`]
        );

        // A port takes layer 2 settings only once it is switched, and an address only once it is not.
        const switched = RaisecomRos.switchedPorts(current);
        for (const group of groups) {
            const isPort = group.path[0]?.startsWith("interface ") ?? false;
            const switches = group.add.some((line) => line.startsWith("switchport") || line.startsWith("port-channel"));
            const routes = group.add.some((line) => line.startsWith("ip address "));
            if (isPort && switches) group.add.unshift("portswitch");
            else if (routes && switched.has(group.path[0]!)) group.add.unshift("no portswitch");
        }

        // Putting an interface in a VRF, or taking it out, removes its IP settings, and a new OSPF network type sets its timers back to the type's own. So they are sent again after.
        const wanted = LineDiff.entries(desired, RaisecomRos.DIALECT);
        for (const group of groups) {
            const changed = [...group.add, ...group.remove];
            const reset = changed.some((line) => line.startsWith("ip vrf forwarding "))
                ? RaisecomRos.IP_SETTING
                : changed.some((line) => line.startsWith("ip ospf network "))
                  ? RaisecomRos.OSPF_TIMER
                  : undefined;
            if (!reset) continue;

            const settings = wanted
                .filter((entry) => entry.path.join("\n") === group.path.join("\n") && reset.test(entry.line))
                .map((entry) => entry.line);
            group.add = [...group.add.filter((line) => !settings.includes(line)), ...settings];
        }

        // A LAG is removed only once no port is in it, and a VRF once no interface is, so their removal goes after every other step.
        const lagRemovals: string[] = [];
        const holderRemovals = (line: string) => line.startsWith("interface port-channel") || RaisecomRos.VRF.test(line);

        for (const group of groups) {
            if (group.path.length) continue;
            lagRemovals.push(...group.remove.filter(holderRemovals));
            group.remove = group.remove.filter((line) => !holderRemovals(line));
        }

        // An access-list is removed only once no service holds it, so its removal goes after the top level lets go of it.
        const aclRemovals: string[] = [];

        for (const group of groups) {
            if (group.path.length) continue;
            aclRemovals.push(...group.remove.filter((line) => /^access-list \d+/.test(line)));
            group.remove = group.remove.filter((line) => !/^access-list \d+/.test(line));
        }

        // Editing an access-list means releasing every service holding it first, and binding the wanted ones after.
        const releaseAndBind = (group: Group) => {
            const pool = RaisecomRosServices.POOL.exec(group.path[0] ?? "")?.[1];
            if (pool) return { before: RaisecomRosServices.binds(existing, pool).map((line) => RaisecomRosUndo.of(line)), after: [] };

            const acl = /^access-list (\d+)/.exec(group.path[0] ?? "")?.[1];
            if (!acl) return { before: [], after: [] };

            // A port's filter is bound again only where it stays. A port that newly takes it binds it in its own step.
            const filter = `filter ingress access-list ${acl}`;
            const ports = RaisecomRos.filteredPorts(current, filter);
            const kept = ports.filter((port) => RaisecomRos.filteredPorts(desired, filter).includes(port));

            return {
                before: [
                    ...RaisecomRos.holders(current, acl).map((service) => `no ${service} access-list ${acl}`),
                    ...ports.flatMap((port) => [port, `no ${filter}`, RaisecomRos.DIALECT.leave]),
                ],
                after: [
                    ...RaisecomRos.holders(desired, acl).map((service) => `${service} access-list ${acl}`),
                    ...kept.flatMap((port) => [port, filter, RaisecomRos.DIALECT.leave]),
                ],
            };
        };

        // The hostname, users, and the privileged password are set at the `#` prompt, as configuration mode refuses them. A gone user goes with `no username`.
        const privileged: { show: string; send: string }[] = [];

        for (const group of groups) {
            if (group.path.length) continue;
            for (const line of group.remove.filter((each) => each.startsWith("user name "))) {
                privileged.push({ show: `- ${line}`, send: `no username ${line.split(" ")[2]}` });
            }
            privileged.push(
                ...group.add.filter((line) => RaisecomRos.PRIVILEGED.test(line)).map((line) => ({ show: `+ ${line}`, send: line }))
            );
            group.remove = group.remove.filter((line) => !line.startsWith("user name "));
            group.add = group.add.filter((line) => !RaisecomRos.PRIVILEGED.test(line));
        }

        const reservations = RaisecomRosServices.reservationSteps(groups, existing, LineDiff.entries(desired, RaisecomRos.DIALECT));

        // A route through a VLAN interface is refused until the interface exists, so routes come after the interfaces.
        const routes: string[] = [];

        for (const group of groups) {
            if (group.path.length) continue;
            routes.push(...group.add.filter((line) => line.startsWith("ip route ")));
            group.add = group.add.filter((line) => !line.startsWith("ip route "));
        }

        // The switch snoops once the trusted ports are set, so a DHCP server behind one is never cut off.
        const snooping: string[] = [];

        for (const group of groups) {
            if (group.path.length) continue;
            snooping.push(...group.add.filter((line) => RaisecomRos.SNOOPING.includes(line)));
            group.add = group.add.filter((line) => !RaisecomRos.SNOOPING.includes(line));
        }

        // A VLAN goes once its ports have left it, a private VLAN's own lines first.
        const vlanRemovals = RaisecomRos.vlanRemovals(groups);

        const planned = LineDiff.steps(
            groups.filter((group) => group.add.length || group.remove.length),
            RaisecomRos.DIALECT,
            releaseAndBind
        );

        if (privileged.length) {
            const title = privileged.every(({ send }) => send.startsWith("hostname ")) ? "hostname" : "at the # prompt";
            const show = privileged.map((each) => each.show);
            planned.unshift({ title, show, send: ["exit", ...privileged.map((each) => each.send), "config"] });
        }

        if (routes.length) planned.push({ title: "static routes", show: routes.map((line) => `+ ${line}`), send: routes });
        if (reservations.length)
            planned.push({ title: "DHCP reservations", show: reservations.map((line) => `+ ${line}`), send: reservations });
        if (snooping.length) planned.push({ title: "DHCP snooping and relay", show: snooping.map((line) => `+ ${line}`), send: snooping });

        if (lateRouting.length) {
            planned.push({
                title: "routing processes, route-maps, and lists no longer used",
                show: lateRouting.map((line) => `- ${line}`),
                send: lateRouting.map((line) => RaisecomRosUndo.of(line)),
            });
        }

        if (aclRemovals.length) {
            planned.push({
                title: "access-lists no longer used",
                show: aclRemovals.map((line) => `- ${line}`),
                send: aclRemovals.map((line) => RaisecomRosUndo.of(line)),
            });
        }

        if (vlanRemovals.length) {
            planned.push({
                title: "VLANs no longer used",
                show: vlanRemovals.map((line) => `- ${line}`),
                send: vlanRemovals.map((line) => RaisecomRosUndo.of(line)),
            });
        }

        if (lagRemovals.length) {
            const removeLags: Step = {
                title: "LAGs and VRFs no longer used",
                show: lagRemovals.map((line) => `- ${line}`),
                send: lagRemovals.map((line) => RaisecomRosUndo.of(line)),
            };
            planned.push(removeLags);
        }

        return { steps: planned, problems: [] };
    }

    override async apply(device: Device, _network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void> {
        const session = await RaisecomRos.open(device, options);
        const { channel } = session;
        // Bindings released for an access-list edit. A failure binds them again before anything else, so the list keeps guarding management.
        const released: string[] = [];

        try {
            await Ssh.send(channel, "config", RaisecomRos.COMMAND_TIMEOUT_MS);

            for (const step of plan.steps) {
                for (const line of step.send) {
                    let answer = await Ssh.send(channel, Secrets.substitute(line), RaisecomRos.LINE_TIMEOUT_MS, RaisecomRos.LINE_SETTLE_MS);
                    // A confirming line asks for `y` unless the change needs no confirming, when the device sets it at once.
                    const asks =
                        /[[(]y\/n[\])]|input 'y'/i.test(answer) || (RaisecomRos.CONFIRM.test(line) && !/set successfully/i.test(answer));
                    if (asks) answer += await Ssh.send(channel, "y", RaisecomRos.COMMAND_TIMEOUT_MS, RaisecomRos.SETTLE_MS);
                    if (RaisecomRos.REFUSED.test(answer))
                        throw new Error(`${step.title}: ${line}\n    device said: ${answer.trim().slice(0, RaisecomRos.ANSWER_CHARS)}`);

                    const release = RaisecomRos.RELEASE.exec(line);
                    if (release) released.push(release[1]!);
                    else if (released.includes(line)) released.splice(released.indexOf(line), 1);
                }
            }

            await Ssh.send(channel, "exit", RaisecomRos.COMMAND_TIMEOUT_MS);
        } catch (error) {
            await Ssh.send(channel, "end", RaisecomRos.COMMAND_TIMEOUT_MS).catch(() => undefined);
            await Ssh.send(channel, "config", RaisecomRos.COMMAND_TIMEOUT_MS).catch(() => undefined);
            for (const binding of released) await Ssh.send(channel, binding, RaisecomRos.COMMAND_TIMEOUT_MS).catch(() => undefined);
            if (released.length) console.log(`  bound again: ${released.join(", ")}`);
            session.close();
            throw error;
        }

        const proof = await session.fresh().catch(() => undefined);
        if (!proof)
            throw new Error(
                "applied, but a fresh login failed. Not written: a reboot restores the previous configuration. Recover from the console."
            );
        await Ssh.send(proof.channel, "write", RaisecomRos.SLOW_TIMEOUT_MS, RaisecomRos.WRITE_SETTLE_MS);
        proof.close();
        console.log("  applied, logged in again, written");
    }

    override bgpSessions(device: Device, session: ReadSession): Promise<BgpSession[]> {
        return RaisecomRosBgpSessions.read(device, session);
    }

    /** Each BGP session established before the apply must be established again. */
    override health(device: Device, _plan: Plan, options: HealthOptions = {}): Promise<HealthCheck> {
        return BgpHealth.check(this, device, options);
    }

    override readOnly(command: string): boolean {
        return RaisecomRos.READS.test(command);
    }

    /** One shell for every command, as the platform takes commands only there. */
    override async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        const session = await RaisecomRos.open(device, options);
        const shell = new ConsoleShell(session.channel, RaisecomRos.CONSOLE, ConsoleShell.SETTLE);

        return { run: (command, timeout) => shell.run(command, timeout), close: session.close };
    }

    /** The top level, and any block not in the order, comes first. */
    private static order(path: string[]): number {
        return RaisecomRos.BLOCK_ORDER.findIndex((pattern) => pattern.test(path[0] ?? "")) + 1;
    }

    /** A session that does not answer as ROS is refused, so nothing meant for it can reach another shell. */
    private static async open(device: Device, options: ReadOptions = {}): Promise<Session> {
        const session = options.console ? await RaisecomRos.openConsole(device) : await RaisecomRos.openSsh(device);

        const version = await Ssh.send(session.channel, "show version", RaisecomRos.PROMPT_TIMEOUT_MS, RaisecomRos.VERSION_SETTLE_MS);
        if (!version.includes("ROS")) {
            session.close();
            throw new Error(`${device.name} did not answer as ROS`);
        }

        await RaisecomRos.pagingOff(session.channel);
        return session;
    }

    private static async pagingOff(channel: ClientChannel): Promise<void> {
        await Ssh.send(channel, "terminal page-break disable", RaisecomRos.PROMPT_TIMEOUT_MS, RaisecomRos.SETTLE_MS);
    }

    private static async openSsh(device: Device): Promise<Session> {
        const { port, user, password, keys } = Secrets.loginOf(device);

        const client = await Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user,
            password,
            keys,
            hostKeys: RaisecomRos.HOST_KEYS,
        });
        const channel = await Ssh.shell(client);
        const close = () => {
            channel.end();
            client.end();
        };

        const banner = await Ssh.readUntil(channel, (text) => /[#>]\s*$/.test(text.trimEnd()), RaisecomRos.LOGIN_TIMEOUT_MS);
        if (!/[#>]\s*$/.test(banner.trimEnd())) {
            close();
            throw new Error(`${device.name} did not answer as ROS`);
        }

        return {
            channel,
            close,
            fresh: async () => {
                close();
                return Ssh.retrying(() => RaisecomRos.open(device));
            },
        };
    }

    private static async openConsole(device: Device): Promise<Session> {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);

        try {
            await SerialConsole.login(opened.channel, RaisecomRos.CONSOLE, user, password, console.password_only);
        } catch (error) {
            void opened.close();
            throw error;
        }

        const session: Session = {
            channel: opened.channel,
            close: () => {
                opened.channel.write(`${RaisecomRos.CONSOLE.logout}\n`);
                void opened.close();
            },
            fresh: async () => {
                await SerialConsole.login(opened.channel, RaisecomRos.CONSOLE, user, password, console.password_only);
                await RaisecomRos.pagingOff(opened.channel);
                return session;
            },
        };

        return session;
    }

    /** Takes out of the top level each VLAN that goes, and each private VLAN line, to be sent after the ports: private VLAN lines in their order, then the VLANs. */
    private static vlanRemovals(groups: Group[]): string[] {
        const top = groups.find((group) => !group.path.length);
        if (!top) return [];

        const rank = (line: string) => {
            const kind = RaisecomRos.PRIVATE_VLAN.findIndex((pattern) => pattern.test(line));
            return kind === -1 ? RaisecomRos.PRIVATE_VLAN.length : kind;
        };
        const late = top.remove.filter((line) => rank(line) < RaisecomRos.PRIVATE_VLAN.length || /^vlan \d+$/.test(line));
        top.remove = top.remove.filter((line) => !late.includes(line));
        return late.sort((a, b) => rank(a) - rank(b));
    }

    /** The ports, by their `interface` line, that the device has switched. The read leaves `portswitch` out, as the plan sends it where a port needs it. */
    private static switchedPorts(config: string): Set<string> {
        const ports = new Set<string>();
        let block: string | undefined;

        for (const line of config.split("\n").map((each) => each.trim())) {
            if (line.startsWith("interface ")) block = line;
            else if (line === "!") block = undefined;
            else if (block && line === "portswitch") ports.add(block);
        }

        return ports;
    }

    /** The ports, by their `interface` line, that filter what they take in with an access-list. */
    private static filteredPorts(config: string, filter: string): string[] {
        return LineDiff.entries(config, RaisecomRos.DIALECT)
            .filter((entry) => entry.line === filter && entry.path[0]?.startsWith("interface "))
            .map((entry) => entry.path[0]!);
    }

    /** Services holding an access-list. It cannot change while any of them does. */
    private static holders(config: string, acl: string): string[] {
        return [...config.matchAll(new RegExp(`^([a-z0-9-]+) access-list ${acl}$`, "gm"))].map((match) => match[1]!);
    }

    /** The VLAN IDs of a `create vlan 10,20-30 active` line. */
    private static createdIds(line: string): number[] {
        return RaisecomRos.idsOf(line.replace(/^create vlan /, "").replace(/ active$/, ""));
    }

    /** The VLAN IDs of a list such as `10,20-30`. */
    private static idsOf(list: string): number[] {
        const ids: number[] = [];

        for (const part of list.split(",")) {
            const [first, last] = part.split("-").map(Number);
            for (let id = first!; id <= (last ?? first!); id++) ids.push(id);
        }

        return ids;
    }
}
