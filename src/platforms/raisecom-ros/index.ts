// Raisecom ROS, as on the RAX700 series.
//
// An interface, an access-list or an OSPF process opens a block, `!` closes it, and `no` removes a line. Commands apply as they arrive and persist only on `write`. There is no rollback, so management is proved reachable in a fresh session before anything is written: a reboot then restores what was there before.

import type { ClientChannel } from "ssh2";
import { Address } from "../../core/address";
import type { Neighbor } from "../../core/cabling";
import { Secrets } from "../../core/secrets";
import type { Device } from "../../schema";
import { ConsoleShell, SerialConsole, type ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Catalog } from "../catalog";
import { Derive } from "../derive";
import { LineDiff, type Dialect, type Group } from "../line-diff";
import { type ApplyOptions, type OsSupport, type Plan, type ReadOptions, type ReadSession, type Step, Platform } from "../platform";
import { RaisecomRosRender } from "./render";

/** A session, and how to prove access in a fresh login: a new SSH session, or logging out and in again on the console. */
export type Session = { channel: ClientChannel; close: () => void; fresh: () => Promise<Session> };

export class RaisecomRos extends Platform {
    /** How the console asks for a login and shows its prompt. Not yet proved on a device: the RAX721's console was never cabled to a jump host. */
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
        // Implied by any layer 2 setting on a port; the plan sends it where needed.
        "portswitch",
        // A port's speed or duplex set back to auto prints as the default it is, and `no duplex` is refused.
        "speed auto",
        "duplex auto",
    ];

    /** Lines whose opposite is not `no` and the line. */
    private static readonly OPPOSITES: [RegExp, string][] = [
        [/^mode manual$/, "mode lacp"],
        [/^ip ospf passive-interface enable$/, "ip ospf passive-interface disable"],
        [/^lldp disable$/, "lldp enable"],
        [/^spanning-tree disable$/, "spanning-tree enable"],
        [/^switchport mode trunk$/, "switchport mode access"],
        [/^telnet-server disable$/, "telnet-server enable"],
        [/^shutdown$/, "no shutdown"],
        // The device refuses `no storm-control mode`; kbps is its default and prints nothing.
        [/^storm-control mode pps$/, "storm-control mode kbps"],
    ];

    /** Lines whose removal takes only their keyword, not their value. */
    private static readonly UNDO_BY_KEYWORD =
        /^(description|switchport access vlan|switchport trunk native vlan|switchport trunk allowed vlan|storm-control broadcast|ip address|port-channel|ip ospf cost|ip ospf network)\b/;

    private static readonly DIALECT: Dialect = {
        block: /^(interface |access-list |router ospf )/,
        indented: false,
        terminator: "!",
        ignore: (line) => line.startsWith("!") || RaisecomRos.DEVICE_FACTS.some((fact) => line.startsWith(fact)),
        undo: RaisecomRos.undo,
        leave: "exit",
        // A password prints as a cipher and renders as a marker; both are a secret.
        canon: (line) =>
            line
                .replace(/password (cipher )?(\S+)/, "password <secret>")
                .replace(/community <secret:\w+>/, "community <redacted>")
                // An SNMPv3 user prints its localized keys and renders its passphrases; both are secrets.
                .replace(
                    /^snmp-server user (\S+) (?:authentication|authkey) (\S+) \S+ (?:privacy|privkey)\s+(\S+) \S+$/,
                    "snmp-server user $1 $2 $3 <secret>"
                )
                // An access group prints a notify view the render leaves to its default.
                .replace(/^(snmp-server access \S+ read \S+) notify internet (usm \S+)$/, "$1 $2"),
        // A LAG exists before a port joins it, and an OSPF process comes after the interfaces it names.
        order: (path) => {
            const header = path[0] ?? "";
            if (header.startsWith("interface port-channel")) return 1;
            if (header.startsWith("interface ")) return 2;
            if (header.startsWith("router ospf")) return 3;
            return 0;
        },
    };

    /** The firmware offers only an `ssh-rsa` host key, so that one is allowed for this platform alone. Key exchange, cipher and MAC still negotiate modern ones. */
    private static readonly HOST_KEYS = ["ssh-rsa"];

    /** How long a dump may go quiet before the prompt, as on a lossy path where a retransmit stalls it for seconds, and how long it may take in all. */
    private static readonly DUMP_QUIET = 30_000;
    private static readonly DUMP_LIMIT = 150_000;

    /** What the device prints when it refuses a line. */
    private static readonly REFUSED = /^(%|Error|Incomplete|Unrecognized)|can not|cannot |is in use|Wrong parameter|invalid|unsuccessful/im;

    /** Lines that ask for `y` and do nothing without it. */
    private static readonly CONFIRM = /^(portswitch|switchport trunk allowed vlan|switchport mode)/;

    /** A service letting go of an access-list, so the list can change. */
    private static readonly RELEASE = /^no (\S+ access-list \d+)$/;

    /** Commands that only read. A `?` sent by a script is run, so a line with one is refused. */
    private static readonly READS = /^show\s[^?]*$/;

    readonly name = "raisecom-ros";

    readonly os: OsSupport = {
        name: "Raisecom ROS",
        versions: "6.5",
        provedOn: "RAX721-C-6C48, ROS 6.5.2",
        checked: false,
    };

    readonly extension = ".txt";

    override readonly console = RaisecomRos.CONSOLE;

    unsupported(device: Device): string[] {
        const found: string[] = [];

        if (device.management?.interfaces) found.push("management.interfaces, which only FortiOS builds for now");

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type === "bridge") found.push(`interfaces.${name}, a bridge, which only FortiOS builds for now`);
            if (iface.type === "vlan" && iface.mac) found.push(`interfaces.${name}.mac, which only RouterOS sets for now`);
        }

        for (const [name, port] of Object.entries(device.ports ?? {})) {
            if (!port) continue;

            for (const field of ["speed", "acl", "mtu", "addresses", "vrrp", "vrf"] as const) {
                if (port[field] !== undefined) found.push(`ports.${name}.${field}`);
            }

            if (port.lldp === true) found.push(`ports.${name}.lldp true, LLDP is turned on per device`);
            if (typeof port.stp === "object" || port.stp === true) found.push(`ports.${name}.stp other than false`);
            const storm = port.storm_control;
            if (storm && (storm.multicast || storm.unknown_unicast || (storm.broadcast && "percent" in storm.broadcast))) {
                found.push(`ports.${name}.storm_control other than broadcast in pps`);
            }
        }

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type === "lag") {
                for (const field of ["addresses", "vrrp", "vrf", "mtu", "storm_control", "stp"] as const) {
                    if (iface[field] !== undefined) found.push(`interfaces.${name}.${field}, a LAG here only switches`);
                }
                continue;
            }

            if (iface.type !== "vlan") {
                found.push(`interfaces.${name}, a ${iface.type}`);
                continue;
            }

            for (const field of ["vrf", "description", "mtu", "ipv6_ra"] as const) {
                if (iface[field] !== undefined) found.push(`interfaces.${name}.${field}`);
            }

            for (const entry of iface.addresses ?? []) {
                const address = typeof entry === "string" ? entry : entry.address;
                if (Address.family(address) === "ipv6") found.push(`interfaces.${name}.addresses ${address}, only IPv4 here`);
            }

            for (const group of iface.vrrp ?? []) {
                if (Address.family(group.address) === "ipv6") found.push(`interfaces.${name}.vrrp for IPv6`);
            }
        }

        const routing = device.routing;

        for (const field of ["bgp", "rpki"] as const) {
            if (routing?.[field]) found.push(`routing.${field}`);
        }

        const ospf = routing?.ospf;
        if (ospf?.families?.includes("ipv6")) found.push("routing.ospf for IPv6");

        for (const [areaId, area] of Object.entries(ospf?.areas ?? {})) {
            for (const [name, settings] of Object.entries(area.interfaces)) {
                if (device.interfaces?.[name]?.type !== "vlan")
                    found.push(`routing.ospf.areas.${areaId}.${name}, OSPF runs on VLAN interfaces here`);
                if (settings?.bfd) found.push(`routing.ospf.areas.${areaId}.${name}.bfd`);
            }
        }

        for (const route of routing?.static ?? []) {
            if (!route.via || route.vrf || Address.family(route.prefix) === "ipv6") {
                found.push(`routing.static ${route.prefix}, only an IPv4 next hop in the default table`);
            }

            if (route.description || route.distance) found.push(`routing.static ${route.prefix} description and distance`);
        }

        for (const [name, vlan] of Object.entries(device.vlans ?? {})) {
            if (vlan.description) found.push(`vlans.${name}.description`);
        }

        const UNSUPPORTED_SECTIONS = [
            "firewall",
            "dhcp",
            "dhcp_relay",
            "acls",
            "policies",
            "prefix_sets",
            "hardware_offload",
            "certificates",
            "vrfs",
            "flow_export",
        ] as const;

        for (const field of UNSUPPORTED_SECTIONS) {
            if (device[field] !== undefined) found.push(field);
        }

        const management = device.management ?? {};

        for (const field of ["http", "https", "api", "api_tls", "ftp", "native", "console"] as const) {
            if (management[field]) found.push(`management.${field}`);
        }

        for (const [name, user] of Object.entries(management.snmp?.users ?? {})) {
            if (!RaisecomRosRender.SNMP_AUTH[user.auth])
                found.push(`management.snmp.users.${name}.auth ${user.auth}, the platform authenticates with SHA1 or MD5`);
        }

        if (management.snmp?.contact || management.snmp?.location) found.push("management.snmp.contact and location");
        if (management.ssh?.weak_crypto) found.push("management.ssh.weak_crypto");

        if (device.lldp && device.lldp !== true) found.push("lldp.interfaces, LLDP is per device");
        if (device.stp?.mode && device.stp.mode !== "mstp") found.push("stp.mode other than mstp");

        for (const [name, user] of Object.entries(device.users ?? {})) {
            if (user.role !== "admin") found.push(`users.${name}.role other than admin`);
        }

        const system = device.system ?? {};

        if (system.dns || system.logging || system.release_channel || system.banner || system.ntp?.serve) {
            found.push("system.dns, logging, release_channel, banner and ntp.serve");
        }

        found.push(...Derive.switchUnsupported(device));
        found.push(...Derive.unproved(device));

        return found;
    }

    render(device: Device): string {
        return RaisecomRosRender.of(device);
    }

    /** What the device runs, credentials scrubbed. */
    async read(device: Device, _network: readonly Device[], options: ReadOptions = {}): Promise<string> {
        const { channel, close } = await RaisecomRos.open(device, options);

        try {
            // Without paging off the dump stops halfway with no error. A complete dump ends at the prompt, so the read waits for it through a pause of the device's own or a stall on a lossy path; one that never gets there is read again rather than planned against.
            let dump = "";
            for (let attempt = 1; ; attempt++) {
                dump = await RaisecomRos.dump(channel);
                if (/[#>]\s*$/.test(dump.replace(/\r/g, "").trimEnd())) break;
                if (attempt === 3) throw new Error(`${device.name} returned an incomplete configuration three times`);
                // What the device still prints of the cut dump ends before the next one starts.
                await Ssh.send(channel, "", 30_000, 6000);
            }
            const lines = dump.replace(/\r/g, "").split("\n");
            const start = lines.findIndex((line) => line.trim().startsWith("!ROS version"));
            if (start < 0) throw new Error(`${device.name} returned no configuration`);

            // The prompt is not configuration; uptime, clock and boot count change on an untouched device.
            const body = lines.slice(start).filter((line) => line.startsWith("!") || !/[#>]\s*$/.test(line.trim()));
            const text = body
                .join("\n")
                .replace(/^!(System (up )?time|Boot times):.*\n/gm, "")
                .trim();
            // An SNMPv3 user prints localized keys, which authenticate as well as the passphrase.
            return LineDiff.scrub(text + "\n").replace(/(authkey \S+|privkey\s+\S+) \S+/g, "$1 <redacted>");
        } finally {
            close();
        }
    }

    /** Read `show running-config` until it ends at the prompt, or until it goes quiet for too long or takes too long in all. */
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
                quiet = setTimeout(finish, RaisecomRos.DUMP_QUIET);
                if (ended(output)) settle = setTimeout(finish, 1_000);
            };

            const limit = setTimeout(finish, RaisecomRos.DUMP_LIMIT);
            quiet = setTimeout(finish, RaisecomRos.DUMP_QUIET);
            channel.on("data", onData);
            channel.write("show running-config\n");
        });
    }

    /** The LLDP neighbors from `show lldp remote detail`, which spells each port in full. The short form abbreviates ports (`TGE1/3/3`) and pads columns, so a name with a space cannot be told apart there. */
    async neighbors(device: Device, _network: readonly Device[], options: ReadOptions = {}): Promise<Neighbor[]> {
        const session = await this.session(device, options);

        try {
            return RaisecomRos.lldpRemotes(await session.run("show lldp remote detail", 60_000), device);
        } finally {
            session.close();
        }
    }

    /**
     * The neighbors in `show lldp remote detail`: a `<port> has N remotes:` line per port, then a block per remote of `Key: value` lines. A long value wraps onto lines that start with spaces, cut mid-word.
     *
     * A remote without a system name is named by its chassis ID. A port the catalog does not have, such as the out-of-band port, is left out.
     */
    static lldpRemotes(text: string, device: Device): Neighbor[] {
        const tidy = (port: string) => port.replace(/\s+/g, "").toLowerCase();
        const ports = new Map(
            Catalog.ports(device.platform, device.model).map((port) => [tidy(Catalog.spell(device.platform, device.model, port)), port])
        );

        const neighbors: Neighbor[] = [];
        let port: string | undefined;
        let remote: Record<string, string> | undefined;
        let key: string | undefined;

        const finish = () => {
            const system = remote?.SysName?.trim() || remote?.ChassisId?.trim();
            if (port && system) neighbors.push({ port, system, remote_port: remote?.PortId?.trim() ?? "" });

            remote = undefined;
            key = undefined;
        };

        for (const line of text.replace(/\r/g, "").split("\n")) {
            const header = /^(\S+) has\s+\d+ remotes:/.exec(line);
            if (header) {
                finish();
                port = ports.get(tidy(header[1]!));
                continue;
            }

            if (/^Remote \d+\s*$/.test(line)) {
                finish();
                remote = {};
                continue;
            }

            if (!remote) continue;

            const field = /^([A-Za-z][^:]*?):\s*(.*)$/.exec(line);
            if (field) {
                key = field[1]!;
                remote[key] = field[2]!;
            } else if (key && /^\s+\S/.test(line)) remote[key] += line.trimStart();
            else key = undefined;
        }

        finish();
        return neighbors;
    }

    plan(desired: string, current: string, options: ApplyOptions): Plan {
        const compared = LineDiff.compare(desired, current, RaisecomRos.DIALECT);
        const groups = options.secrets ? LineDiff.withSecrets(compared, desired, RaisecomRos.DIALECT) : compared;

        // An access-list rule is not overwritten by one with the same number; the old one is removed first.
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

        // A VLAN is created in a list and removed one at a time, with `no vlan <id>`.
        LineDiff.vlanListChange(
            groups,
            "create vlan ",
            RaisecomRos.createdIds,
            (ids) => [`create vlan ${RaisecomRosRender.vlanList(ids)} active`],
            (ids) => ids.map((id) => `vlan ${id}`)
        );

        // A port takes layer 2 settings only once it is switched.
        for (const group of groups) {
            const isPort = group.path[0]?.startsWith("interface ") ?? false;
            const switches = group.add.some((line) => line.startsWith("switchport") || line.startsWith("port-channel"));
            if (isPort && switches) group.add.unshift("portswitch");
        }

        // A LAG is removed only once no port is in it, so its removal goes after every other step.
        const lagRemovals: string[] = [];

        for (const group of groups) {
            if (group.path.length) continue;
            lagRemovals.push(...group.remove.filter((line) => line.startsWith("interface port-channel")));
            group.remove = group.remove.filter((line) => !line.startsWith("interface port-channel"));
        }

        // Editing the access-list means releasing every service holding it first, and binding the wanted ones after.
        const managementAcl = RaisecomRosRender.MANAGEMENT_ACL;
        const releaseAndBind = (group: Group) => {
            if (group.path[0] !== `access-list ${managementAcl}`) return { before: [], after: [] };

            return {
                before: RaisecomRos.holders(current).map((service) => `no ${service} access-list ${managementAcl}`),
                after: RaisecomRos.holders(desired).map((service) => `${service} access-list ${managementAcl}`),
            };
        };

        const planned = LineDiff.steps(
            groups.filter((group) => group.add.length || group.remove.length),
            RaisecomRos.DIALECT,
            releaseAndBind
        );

        if (lagRemovals.length) {
            const removeLags: Step = {
                title: "LAGs no longer used",
                show: lagRemovals.map((line) => `- ${line}`),
                send: lagRemovals.map(RaisecomRos.undo),
            };
            planned.push(removeLags);
        }

        return { steps: planned, problems: [] };
    }

    async apply(device: Device, _network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void> {
        const session = await RaisecomRos.open(device, options);
        const { channel } = session;
        // Bindings released for an access-list edit. A failure binds them again before anything else, so the list keeps guarding management.
        const released: string[] = [];

        try {
            await Ssh.send(channel, "config", 10_000);

            for (const step of plan.steps) {
                for (const line of step.send) {
                    let answer = await Ssh.send(channel, Secrets.substitute(line), 20_000, 2000);
                    // A confirming line asks for `y` unless the change needs no confirming, when the device sets it at once.
                    const asks =
                        /[[(]y\/n[\])]|input 'y'/i.test(answer) || (RaisecomRos.CONFIRM.test(line) && !/set successfully/i.test(answer));
                    if (asks) answer += await Ssh.send(channel, "y", 10_000, 1000);
                    if (RaisecomRos.REFUSED.test(answer))
                        throw new Error(`${step.title}: ${line}\n    device said: ${answer.trim().slice(0, 300)}`);

                    const release = RaisecomRos.RELEASE.exec(line);
                    if (release) released.push(release[1]!);
                    else if (released.includes(line)) released.splice(released.indexOf(line), 1);
                }
            }

            await Ssh.send(channel, "exit", 10_000);
        } catch (error) {
            await Ssh.send(channel, "end", 10_000).catch(() => undefined);
            await Ssh.send(channel, "config", 10_000).catch(() => undefined);
            for (const binding of released) await Ssh.send(channel, binding, 10_000).catch(() => undefined);
            if (released.length) console.log(`  bound again: ${released.join(", ")}`);
            session.close();
            throw error;
        }

        const proof = await session.fresh().catch(() => undefined);
        if (!proof)
            throw new Error(
                "applied, but a fresh login failed. Not written: a reboot restores the previous configuration. Recover from the console."
            );
        await Ssh.send(proof.channel, "write", 60_000, 3000);
        proof.close();
        console.log("  applied, login proved, written");
    }

    readOnly(command: string): boolean {
        return RaisecomRos.READS.test(command);
    }

    /** One shell for every command, as the platform takes commands only there. */
    async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        const session = await RaisecomRos.open(device, options);
        const shell = new ConsoleShell(session.channel, RaisecomRos.CONSOLE, ConsoleShell.SETTLE);

        return { run: (command, timeout) => shell.run(command, timeout), close: session.close };
    }

    private static undo(line: string): string {
        for (const [pattern, opposite] of RaisecomRos.OPPOSITES) if (pattern.test(line)) return opposite;
        if (/^rule \d+/.test(line)) return `no ${line.split(" ").slice(0, 2).join(" ")}`;

        // A VRRP group goes with its address; its other settings return to their defaults by keyword. Preemption is on unless turned off.
        const vrrp = /^(no )?vrrp (\d+) (ip \S+|priority|timers advertise-interval|preempt)/.exec(line);
        if (vrrp) return vrrp[1] ? `vrrp ${vrrp[2]} preempt` : `no vrrp ${vrrp[2]} ${vrrp[3]}`;

        const ospfProcess = /^router ospf (\d+)/.exec(line);
        if (ospfProcess) return `no router ospf ${ospfProcess[1]}`;

        // An SNMPv3 user, its group and its access are each removed by their name alone.
        const snmpUser = /^snmp-server user (\S+)/.exec(line);
        if (snmpUser) return `no snmp-server user ${snmpUser[1]}`;

        const snmpGroup = /^snmp-server group \S+ user (\S+) usm$/.exec(line);
        if (snmpGroup) return `no snmp-server group user ${snmpGroup[1]} usm`;

        const snmpAccess = /^snmp-server access (\S+) .* usm (\S+)$/.exec(line);
        if (snmpAccess) return `no snmp-server access ${snmpAccess[1]} usm ${snmpAccess[2]}`;

        const keyword = RaisecomRos.UNDO_BY_KEYWORD.exec(line);
        if (keyword) return `no ${keyword[1]}`;

        return `no ${line}`;
    }

    /** An interactive shell, paging off, over SSH or on the console. A session that does not answer as ROS is refused, so nothing meant for it can reach another shell. */
    private static async open(device: Device, options: ReadOptions = {}): Promise<Session> {
        const session = options.console ? await RaisecomRos.consoleShell(device) : await RaisecomRos.sshShell(device);

        const version = await Ssh.send(session.channel, "show version", 15_000, 1500);
        if (!version.includes("ROS")) {
            session.close();
            throw new Error(`${device.name} did not answer as ROS`);
        }

        await Ssh.send(session.channel, "terminal page-break disable", 15_000, 1000);
        return session;
    }

    private static async sshShell(device: Device): Promise<Session> {
        const { port, user, password } = Secrets.loginOf(device);

        const client = await Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user,
            password,
            hostKeys: RaisecomRos.HOST_KEYS,
        });
        const channel = await Ssh.shell(client);
        const close = () => {
            channel.end();
            client.end();
        };

        const banner = await Ssh.readUntil(channel, (text) => /[#>]\s*$/.test(text.trimEnd()), 30_000);
        if (!/[#>]\s*$/.test(banner.trimEnd())) {
            close();
            throw new Error(`${device.name} did not answer as ROS`);
        }

        return {
            channel,
            close,
            fresh: async () => {
                close();
                return RaisecomRos.open(device);
            },
        };
    }

    private static async consoleShell(device: Device): Promise<Session> {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);

        try {
            await SerialConsole.login(opened.channel, RaisecomRos.CONSOLE, user, password, console.passwordOnly);
        } catch (error) {
            opened.close();
            throw error;
        }

        const session: Session = {
            channel: opened.channel,
            close: () => {
                opened.channel.write(`${RaisecomRos.CONSOLE.logout}\n`);
                opened.close();
            },
            fresh: async () => {
                await SerialConsole.login(opened.channel, RaisecomRos.CONSOLE, user, password, console.passwordOnly);
                await Ssh.send(opened.channel, "terminal page-break disable", 15_000, 1000);
                return session;
            },
        };

        return session;
    }

    /** Services holding the management access-list. It cannot change while any of them does. */
    private static holders(config: string): string[] {
        return [...config.matchAll(new RegExp(`^([a-z0-9-]+) access-list ${RaisecomRosRender.MANAGEMENT_ACL}$`, "gm"))].map(
            (match) => match[1]!
        );
    }

    /** The VLAN IDs of a `create vlan 10,20-30 active` line. */
    private static createdIds(line: string): number[] {
        const list = line.replace(/^create vlan /, "").replace(/ active$/, "");
        const ids: number[] = [];

        for (const part of list.split(",")) {
            const [first, last] = part.split("-").map(Number);
            for (let id = first!; id <= (last ?? first!); id++) ids.push(id);
        }

        return ids;
    }
}
