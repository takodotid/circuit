// Junos on the QFX series, with its Enhanced Layer 2 Software. The configuration is read and written as `set` statements. Changes stage in a candidate, and `commit confirmed` rolls back unless a fresh login confirms it.

import type { Client, ClientChannel } from "ssh2";
import { Address } from "../../core/address";
import type { Neighbor } from "../../core/cabling";
import { Secrets } from "../../core/secrets";
import type { Device, Family, Lag, Port, Routed } from "../../model";
import { ConsoleShell, SerialConsole } from "../../transport/console";
import type { ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import type { TestedFeature } from "../../core/derive";
import { Platform } from "../platform";
import type { ApplyOptions, OsSupport, Plan, ReadOptions, ReadSession } from "../platform";
import { JunosBgp } from "./bgp";
import { JunosNames } from "./names";
import { JunosPlan } from "./plan";
import { JunosRender } from "./render";

/** How a commit that could cut access is guarded: it rolls back after `minutes` unless `prove` shows access survived. */
export type Guard = { minutes: number; prove: () => Promise<void> };

export class Junos extends Platform {
    /** Root lands in a shell, `%`, and every other user in the CLI, `>`. A session left in configuration mode, `#`, leaves it first. Not yet tested on a device. */
    static readonly CONSOLE: ConsoleDialect = {
        // On a line of its own, because the banner after a login says `Last login: ...` and a chunk can end there.
        login: /(?:^|\n)login: $/,
        password: /Password:\s*$/,
        prompt: /[>%] $/,
        logout: "exit",
        others: [[/# $/, "exit configuration-mode\n"]],
    };

    private static readonly SUPPORTED_MAJOR = 21;

    private static readonly COMMAND_TIMEOUT_MS = 60_000;
    private static readonly PROMPT_TIMEOUT_MS = 20_000;
    private static readonly READ_TIMEOUT_MS = 180_000;
    private static readonly LOAD_TIMEOUT_MS = 300_000;
    private static readonly COMMIT_TIMEOUT_MS = 600_000;
    private static readonly SETTLE_MS = 300;
    private static readonly BANNER_SETTLE_MS = 500;
    private static readonly ECHO_SETTLE_MS = 50;

    /** The end of an echoed statement that a paced load waits for. */
    private static readonly ECHO_TAIL_CHARS = 24;

    /** How much of the device's answer an error shows. */
    private static readonly ANSWER_CHARS = 300;
    private static readonly ANSWER_LINES = 19;
    private static readonly VERSION_CHARS = 200;

    private static readonly DEFAULT_MTU = 1500;
    private static readonly STP_PRIORITY_STEP = 4096;

    /** A user with one of these names fails the commit check: the platform keeps them for system accounts. */
    private static readonly SYSTEM_ACCOUNTS = new Set(["bind", "daemon", "kmem", "nobody", "operator", "sshd", "tty", "uucp"]);

    /** `user@host> `, `user@host# `, or a shell's `% `. */
    private static readonly PROMPT = /[>#%] $/;

    /** The prompt in configuration mode, under its `[edit]` line. An echoed statement cannot end with it. */
    private static readonly EDIT_PROMPT = /\[edit[^\]\n]*\]\n[^\n]*# $/;

    /** A refusal in a load, such as `terminal:3:(14) syntax error: ...`. A warning, such as a statement not found, is not one. */
    private static readonly REFUSED = /^terminal:\d+:\(\d+\) (?!warning)|^error: /m;

    /** The detail form as XML: the brief form leaves out the far port, and its table pads columns that a description can fill. */
    private static readonly LLDP_NEIGHBORS = "show lldp neighbors detail | display xml | no-more";

    private static readonly READS = /^show\s/;

    private static readonly TESTED: readonly TestedFeature[] = [
        "bfd-timers",
        "static-route-bfd",
        "multihop-bfd",
        "mac-limit",
        "ethertype-filter",
        "port-binding",
    ];

    override readonly name = "junos";

    override readonly os: OsSupport = {
        name: "Juniper Junos",
        versions: "21",
        testedOn: "QFX5100-48S-6Q, Junos 21.4R3",
        checked: true,
    };

    override readonly extension = ".conf";

    override readonly console = Junos.CONSOLE;

    override unsupported(device: Device): string[] {
        const found: string[] = [];
        const interfaces = Derive.interfaces(device);

        for (const { name, kind } of interfaces) {
            if (kind === "bridge") found.push(`interfaces.bridge.${name}, a bridge, which only FortiOS builds for now`);
            if (kind === "vlan_interface" && device.interfaces?.vlan_interface?.[name]?.mac)
                found.push(`interfaces.vlan_interface.${name}.mac, which only RouterOS sets for now`);
        }
        const names = new JunosNames(device);
        const users = device.system?.users ?? {};

        const root = users.root;
        if (!root) found.push("system.users without root, the platform needs a root password");
        if (root && root.role !== "admin") found.push("system.users.root.role, root is always admin");
        if (root?.description) found.push("system.users.root.description");
        if (device.connection.user === "root") found.push("connection.user root, which logs in to a shell rather than the CLI");

        for (const [name, user] of Object.entries(users)) {
            if (!user) continue;
            if (Junos.SYSTEM_ACCOUNTS.has(name)) found.push(`system.users.${name}, a name the platform keeps for a system account`);

            for (const key of user.ssh_keys ?? []) {
                const kind = key.split(" ")[0]!;
                if (!JunosRender.KEY_STATEMENT[kind]) found.push(`system.users.${name}.ssh_keys, a key of type ${kind}`);
            }
        }

        const management = device.management ?? {};

        for (const field of ["https", "api_tls", "privilege_password"] as const) {
            if (management[field]) found.push(`management.${field}`);
        }

        if (management.console) found.push("management.console, the console uses the device's users");
        if (management.interfaces) found.push("management.interfaces, which only FortiOS builds for now");
        if (management.native_protocol?.interfaces?.length) found.push("management.native_protocol.interfaces, NETCONF runs over IP only");
        if (management.ssh?.auth_timeout || management.ssh?.auth_retries) found.push("management.ssh.auth_timeout and auth_retries");

        if (management.telnet?.port) found.push("management.telnet.port");
        if (management.ftp?.port) found.push("management.ftp.port");
        if (device.monitoring?.snmp?.port) found.push("monitoring.snmp.port");

        const system = device.system ?? {};

        if (system.release_channel) found.push("system.release_channel");
        if (device.monitoring?.transceivers !== undefined) found.push("monitoring.transceivers, it is always on");
        if (device.services?.dns_server) found.push("services.dns_server");
        if (system.ip_stack?.syn_cookies) found.push("system.ip_stack.syn_cookies");
        if (system.logging?.local?.lines_per_file !== undefined) found.push("system.logging.local.lines_per_file, files rotate by size");

        // Time is answered only to its servers, which the filter names by address.
        if (system.ntp && !device.services?.ntp_server && system.ntp.servers.some((server) => !Address.isValid(server))) {
            found.push("system.ntp.servers by name without services.ntp_server, the filter keeping others out needs addresses");
        }

        for (const [name, port] of Derive.ports(device)) {
            const where = `interfaces.ethernet.${name}`;
            const physical = names.port(name);

            if (physical.startsWith("em")) {
                for (const field of [
                    "access_vlan",
                    "trunk_vlans",
                    "native_vlan",
                    "in_lag",
                    "stp",
                    "storm_control",
                    "speed",
                    "vrrp",
                    "vrf",
                    "mtu",
                    "ingress_acl",
                    "ipv6_ra",
                ] as const) {
                    if (port[field] !== undefined) found.push(`${where}.${field}, a management port only routes`);
                }
            }

            if (port.speed && !(port.speed === "1g" && physical.startsWith("ge-")))
                found.push(`${where}.speed ${port.speed}, only a 1G optic in a 10G cage`);

            if (port.hardware_offload !== undefined) found.push(`${where}.hardware_offload`);

            // A port filter cannot match the VLAN a frame is switched in: `learn-vlan-id` is refused on an ingress port.
            const acl = port.ingress_acl ? device.switching?.acls?.[port.ingress_acl] : undefined;
            if (acl?.some((rule) => rule.if?.vlan)) found.push(`switching.acls.${port.ingress_acl} matching a VLAN, on port ${name}`);

            found.push(...Junos.routedGaps(where, port));
            found.push(...Junos.switchedGaps(where, port, device));
        }

        // A match takes one address and one VLAN here.
        for (const [name, rules] of Object.entries(device.switching?.acls ?? {})) {
            (rules ?? []).forEach((rule, index) => {
                for (const field of ["src", "dst", "vlan"] as const) {
                    if (Array.isArray(rule.if?.[field]))
                        found.push(`switching.acls.${name}[${index}].if.${field}, a list: write one rule for each`);
                }
            });
        }

        const loopbackTables = new Set<string>();

        for (const { name, kind, settings } of interfaces) {
            const where = `interfaces.${kind}.${name}`;

            if (kind === "vxlan" || kind === "wireguard") {
                found.push(`${where}, a ${kind}`);
                continue;
            }

            if (settings.hardware_offload !== undefined) found.push(`${where}.hardware_offload`);
            if (kind === "loopback" && settings.ipv6_ra) found.push(`${where}.ipv6_ra, on a loopback`);
            if (kind === "loopback" && settings.mtu !== undefined) found.push(`${where}.mtu, on a loopback`);
            if (kind === "gre" && settings.vrrp?.length) found.push(`${where}.vrrp, on a tunnel`);

            // A VLAN interface sends no larger packets than the ports carrying its VLAN take. The device only warns.
            const vlanInterface = kind === "vlan_interface" ? device.interfaces?.vlan_interface?.[name] : undefined;
            if (vlanInterface?.mtu !== undefined) {
                const smallest = Math.min(...Junos.carrierMtus(device, vlanInterface.vlan));
                if (vlanInterface.mtu > smallest)
                    found.push(`${where}.mtu ${vlanInterface.mtu}, above the ${smallest} its VLAN's ports carry`);
            }

            found.push(...Junos.routedGaps(where, settings));

            const lag = kind === "lag" ? device.interfaces?.lag?.[name] : undefined;
            if (lag) found.push(...Junos.switchedGaps(where, lag, device));

            if (kind === "loopback") {
                const table = settings.vrf ?? "";
                if (loopbackTables.has(table)) found.push(`${where}, a second loopback in one routing table`);
                loopbackTables.add(table);
                if (settings.vrrp?.length) found.push(`${where}.vrrp, on a loopback`);
            }
        }

        const ids = [...Derive.lagIds(device).values()];
        if (ids.length !== new Set(ids).size) found.push("interfaces.lag, two LAGs with one number");

        const stp = device.switching?.stp;
        if (stp?.priority !== undefined && stp.priority % Junos.STP_PRIORITY_STEP !== 0)
            found.push("switching.stp.priority, in steps of 4096");

        const routing = device.routing;
        found.push(...Junos.bgpGaps(device));

        const tables = new Map<string, number>();

        for (const route of routing?.static_routes ?? []) {
            if (route.description) found.push(`routing.static_routes ${route.prefix} description`);
            // The render writes the next hop alone, so the interface would be lost.
            if (route.next_hop && route.interface)
                found.push(`routing.static_routes ${route.prefix} next_hop with interface, write only one of them`);

            const table = `${route.vrf ?? ""} ${Address.split(route.prefix).addr}/${Address.split(route.prefix).len}`;
            tables.set(table, (tables.get(table) ?? 0) + 1);
        }

        for (const route of routing?.static_routes ?? []) {
            const table = `${route.vrf ?? ""} ${Address.split(route.prefix).addr}/${Address.split(route.prefix).len}`;
            if (route.blackhole && tables.get(table)! > 1)
                found.push(`routing.static_routes ${route.prefix}, a blackhole beside another route to the same prefix`);
        }

        for (const area of Object.values(routing?.ospf?.areas ?? {})) {
            for (const [iface, settings] of Object.entries(area.interfaces)) {
                if (settings && Derive.settings(device, iface)?.vrf) found.push(`routing.ospf on ${iface}, which routes in a VRF`);
            }
        }

        if (device.firewall !== undefined) found.push("firewall");
        if (system.hardware_offload !== undefined) found.push("system.hardware_offload");
        if (system.certificates !== undefined) found.push("system.certificates");

        const services = device.services ?? {};
        const relayed = new Set(Object.values(services.dhcp_relay ?? {}).map((relay) => relay.interface));

        for (const [name, server] of Object.entries(services.dhcp_server ?? {})) {
            // The device refuses a relay and a server on one interface: `Interface irb.10 already configured`.
            if (relayed.has(server.interface)) found.push(`services.dhcp_server.${name}.interface, which a DHCP relay also uses`);

            if (Derive.settings(device, server.interface)?.vrf) found.push(`services.dhcp_server.${name}.interface, which routes in a VRF`);
            if (Address.family(Address.host(server.network)) === "ipv6") found.push(`services.dhcp_server.${name}.network, IPv6`);
        }

        for (const [name, relay] of Object.entries(services.dhcp_relay ?? {})) {
            if (relay.servers.some((server) => Address.family(server) === "ipv6")) found.push(`services.dhcp_relay.${name}.servers, IPv6`);
        }

        const flow = device.monitoring?.flow_export;
        if (flow && flow.protocol !== "sflow") found.push(`monitoring.flow_export.protocol ${flow.protocol}, the platform exports sFlow`);
        if (flow?.protocol === "sflow" && flow.sampling === undefined) found.push("monitoring.flow_export.sampling, the platform samples");

        for (const name of flow?.interfaces ?? []) {
            if (names.members(name).some((port) => port.startsWith("em")))
                found.push(`monitoring.flow_export.interfaces ${name}, a management port`);
        }

        found.push(...Derive.untested(device, Junos.TESTED));
        found.push(...Derive.unbuilt(device));

        return found;
    }

    override render(device: Device): string {
        return JunosRender.of(device);
    }

    override async read(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<string> {
        if (options.console) {
            return Junos.onConsole(device, async (channel) => {
                await Junos.checkVersion((command) => Junos.run(channel, command), device);
                const output = await Junos.run(channel, "show configuration | display set | no-more", Junos.READ_TIMEOUT_MS);
                if (!/^set /m.test(output)) throw new Error(`${device.name} returned no configuration`);

                return Junos.configurationOf(output);
            });
        }

        const client = await Junos.login(device);

        try {
            await Junos.checkVersion((command) => Ssh.exec(client, command), device);
            const output = await Ssh.exec(client, "show configuration | display set | no-more", Junos.READ_TIMEOUT_MS);
            if (!/^set /m.test(output)) throw new Error(`${device.name} returned no configuration`);

            return Junos.configurationOf(output);
        } finally {
            client.end();
        }
    }

    override async neighbors(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<Neighbor[]> {
        if (options.console) {
            return Junos.onConsole(device, async (channel) => {
                await Junos.checkVersion((command) => Junos.run(channel, command), device);
                return Junos.neighborsOf(device, await Junos.run(channel, Junos.LLDP_NEIGHBORS));
            });
        }

        const client = await Junos.login(device);

        try {
            await Junos.checkVersion((command) => Ssh.exec(client, command), device);
            return Junos.neighborsOf(device, await Ssh.exec(client, Junos.LLDP_NEIGHBORS));
        } finally {
            client.end();
        }
    }

    /** Our port by Circuit's name, and the far end by its system name, or its chassis ID when it sends none. */
    static neighborsOf(device: Device, xml: string): Neighbor[] {
        const names = new JunosNames(device);
        const ports = new Map<string, string>();

        // A 10G cage is `xe-` or `ge-` by its optic, so both spellings lead to the port.
        for (const port of Catalog.ports(device.platform, device.model)) {
            const name = names.port(port);
            ports.set(name, port);
            ports.set(
                name.replace(/^(?:xe|ge)-/, (prefix) => (prefix === "xe-" ? "ge-" : "xe-")),
                port
            );
        }

        const field = (block: string, tag: string) => {
            const value = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block)?.[1]?.trim();
            return value ? Junos.unescapeXml(value) : undefined;
        };

        const blocks = xml.split("<lldp-neighbor-information>").slice(1);

        return blocks.flatMap((block) => {
            const local = field(block, "lldp-local-interface") ?? field(block, "lldp-local-port-id");
            const port = local && ports.get(local);
            const system = field(block, "lldp-remote-system-name") ?? field(block, "lldp-remote-chassis-id");
            const remotePort = field(block, "lldp-remote-port-id");

            return port && system && remotePort ? [{ port, system, remote_port: remotePort }] : [];
        });
    }

    private static unescapeXml(text: string): string {
        const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
        return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name]!);
    }

    override plan(desired: string, current: string, options: Pick<ApplyOptions, "secrets">): Plan {
        return JunosPlan.of(desired, current, options);
    }

    override async apply(device: Device, _network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void> {
        if (options.console) {
            await Junos.onConsole(device, async (channel, relogin) => {
                await Junos.checkVersion((command) => Junos.run(channel, command), device);

                // A fresh login on the console ends the session holding the candidate, so the proof takes the candidate back to confirm.
                await Junos.configure(
                    channel,
                    plan,
                    {
                        minutes: options.rollback,
                        prove: async () => {
                            await Junos.run(channel, "exit configuration-mode");
                            await relogin();
                            await Junos.run(channel, "configure exclusive");
                        },
                    },
                    true
                );
            });
            return;
        }

        const client = await Junos.login(device);

        try {
            await Junos.checkVersion((command) => Ssh.exec(client, command), device);

            const channel = await Ssh.shell(client);
            await Junos.openCli(channel);

            await Junos.configure(channel, plan, {
                minutes: options.rollback,
                prove: async () => {
                    const proof = await Junos.login(device);
                    proof.end();
                },
            });

            channel.end();
        } finally {
            client.end();
        }
    }

    /** A prefix list cannot cut access, so it is committed without a rollback. */
    override async fill(device: Device, _network: readonly Device[], set: string, _family: Family, prefixes: string[]): Promise<void> {
        const client = await Junos.login(device);

        try {
            await Junos.checkVersion((command) => Ssh.exec(client, command), device);

            const channel = await Ssh.shell(client);
            await Junos.openCli(channel);
            await Junos.configure(channel, Junos.fillPlan(set, prefixes));
            channel.end();

            console.log(`  ${set}: ${prefixes.length} prefixes on the device`);
        } finally {
            client.end();
        }
    }

    override readOnly(command: string): boolean {
        return Junos.READS.test(command);
    }

    /** Over SSH, each command runs on its own, as the read does. */
    override async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        if (options.console) {
            const opened = await Junos.openConsole(device);
            const shell = new ConsoleShell(opened.channel, Junos.CONSOLE, ConsoleShell.SETTLE);

            return {
                run: (command, timeout) => shell.run(command, timeout),
                close: () => {
                    shell.logout();
                    void opened.close();
                },
            };
        }

        const client = await Junos.login(device);
        return { run: (command, timeout) => Ssh.exec(client, command, timeout), close: () => client.end() };
    }

    /** The device prints a password as a hash, an SNMP key as a reversible cipher, and a community as itself. None leave the read. */
    private static scrub(text: string): string {
        return text
            .replace(/ ## SECRET-DATA$/gm, "")
            .replace(/((?:encrypted-password|authentication-key|privacy-key) )(?:"[^"]*"|\S+)/g, "$1<redacted>")
            .replace(/^(set snmp community )(?:"[^"]*"|\S+)/gm, "$1<redacted>")
            .replace(/"\$\d\$[^"]*"/g, "<redacted>");
    }

    private static configurationOf(output: string): string {
        const statements = output
            .replace(/\r/g, "")
            .split("\n")
            .map((line) => line.trimEnd())
            .filter((line) => /^(set|deactivate) /.test(line))
            .filter((line) => !JunosPlan.DEVICE_FACTS.some((fact) => fact.test(line)));

        return Junos.scrub(`${statements.join("\n")}\n`);
    }

    private static async login(device: Device): Promise<Client> {
        const { port, user, password, keys } = Secrets.loginOf(device);

        return Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user,
            password,
            keys,
        });
    }

    private static async checkVersion(ask: (command: string) => Promise<string>, device: Device): Promise<void> {
        const version = await ask("show version | match Junos:");
        const release = /Junos: (\d+)\.(\S+)/.exec(version);

        if (!release) throw new Error(`${device.name} did not say which Junos it runs: ${version.slice(0, Junos.VERSION_CHARS)}`);
        if (Number(release[1]) !== Junos.SUPPORTED_MAJOR) {
            throw new Error(
                `${device.name} runs Junos ${release[1]}.${release[2]}; this adapter renders for Junos ${Junos.SUPPORTED_MAJOR}`
            );
        }
    }

    private static async run(channel: ClientChannel, line: string, timeout = Junos.COMMAND_TIMEOUT_MS): Promise<string> {
        channel.write(`${line}\n`);
        const output = await Ssh.readUntil(channel, (text) => Junos.PROMPT.test(text.replace(/\r/g, "")), timeout, Junos.SETTLE_MS);
        return output.replace(/\r/g, "");
    }

    private static async edit(channel: ClientChannel, line: string, timeout = Junos.COMMAND_TIMEOUT_MS): Promise<string> {
        channel.write(`${line}\n`);
        const output = await Ssh.readUntil(channel, (text) => Junos.EDIT_PROMPT.test(text.replace(/\r/g, "")), timeout, Junos.SETTLE_MS);
        return output.replace(/\r/g, "");
    }

    private static async openConsole(device: Device) {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);

        // The CLI is opened on a prompt asked for after the login, since the login's own prompt is already read.
        const login = async () => {
            await SerialConsole.login(opened.channel, Junos.CONSOLE, user, password, console.password_only);
            const ready = Junos.openCli(opened.channel);
            opened.channel.write("\n");
            await ready;
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
        const opened = await Junos.openConsole(device);

        try {
            const result = await work(opened.channel, opened.login);
            opened.channel.write(`${Junos.CONSOLE.logout}\n`);
            return result;
        } finally {
            void opened.close();
        }
    }

    /** Root lands in a shell, so it starts the CLI from there. */
    private static async openCli(channel: ClientChannel): Promise<void> {
        const banner = await Ssh.readUntil(
            channel,
            (text) => Junos.PROMPT.test(text.replace(/\r/g, "")),
            Junos.PROMPT_TIMEOUT_MS,
            Junos.BANNER_SETTLE_MS
        );
        if (banner.replace(/\r/g, "").endsWith("% ")) await Junos.run(channel, "cli");

        await Junos.run(channel, "set cli screen-length 0");
        await Junos.run(channel, "set cli screen-width 0");
        await Junos.run(channel, "set cli complete-on-space off");
    }

    /** A delete through a name the read redacted, `delete snmp community <redacted>`, as one delete for each entry the device holds there. The names stay in the session. */
    private static async namedDeletes(channel: ClientChannel, line: string): Promise<string[]> {
        const words = JunosPlan.wordsOf(line).slice(1);
        const at = words.indexOf("<redacted>");
        if (at === -1) return [line];

        // `show` cannot stop at a list either, so the list's parent is shown and its entries picked out.
        const shown = await Junos.edit(channel, `show ${words.slice(0, at - 1).join(" ")} | display set`);
        const inList = (statement: string[]) =>
            statement[0] === "set" && words.slice(0, at).every((word, index) => statement[index + 1] === word);
        const names = new Set(
            shown
                .split("\n")
                .map(JunosPlan.wordsOf)
                .filter(inList)
                .map((statement) => statement[at + 1]!)
        );

        return [...names].map((name) => `delete ${[...words.slice(0, at), name, ...words.slice(at + 1)].join(" ")}`);
    }

    /** With a guard, the commit rolls back after `minutes` unless access is tested and the commit confirmed. Deletions go before the statements that are set, so a path deleted and set again ends up set. */
    private static async configure(channel: ClientChannel, plan: Plan, guard?: Guard, paced = false): Promise<void> {
        const sent = plan.steps.flatMap((step) => step.send);

        const entered = await Junos.run(channel, "configure exclusive");
        if (!/Entering configuration mode/.test(entered) || /^error: /m.test(entered)) {
            throw new Error(`the candidate could not be locked: ${entered.trim().slice(0, Junos.ANSWER_CHARS)}`);
        }

        const deletions: string[] = [];
        for (const line of sent.filter((line) => line.startsWith("delete "))) deletions.push(...(await Junos.namedDeletes(channel, line)));

        const ordered = [
            ...sent.filter((line) => line.startsWith("activate ")),
            ...deletions,
            ...sent.filter((line) => line.startsWith("set ")),
        ];

        const discard = async (reason: string) => {
            await Junos.edit(channel, "rollback 0").catch(() => undefined);
            await Junos.run(channel, "exit configuration-mode").catch(() => undefined);
            return new Error(reason);
        };

        channel.write("load set terminal\n");
        await Ssh.readUntil(
            channel,
            (text) => text.includes("[Type ^D at a new line to end input]"),
            Junos.PROMPT_TIMEOUT_MS,
            Junos.SETTLE_MS
        );

        // A serial console has no flow control: statements sent at once overrun it and arrive garbled. There, each waits for the echo of the one before.
        for (const line of ordered) {
            const statement = Secrets.substitute(line);
            channel.write(`${statement}\n`);
            if (!paced) continue;

            const tail = statement.slice(-Junos.ECHO_TAIL_CHARS);
            await Ssh.readUntil(channel, (text) => text.replace(/\r/g, "").includes(tail), Junos.PROMPT_TIMEOUT_MS, Junos.ECHO_SETTLE_MS);
        }

        const loaded = await Junos.edit(channel, "\u0004", Junos.LOAD_TIMEOUT_MS);
        const refused = loaded.split("\n").filter((line) => Junos.REFUSED.test(line));
        if (refused.length) throw await discard(`the device refused the plan, nothing was applied:\n    ${refused.join("\n    ")}`);

        const checked = await Junos.edit(channel, "commit check", Junos.COMMIT_TIMEOUT_MS);
        if (!/configuration check succeeds/.test(checked)) {
            throw await discard(`commit check failed, nothing was applied:\n    ${Junos.excerpt(checked)}`);
        }

        if (!guard) {
            const committed = await Junos.edit(channel, "commit comment circuit", Junos.COMMIT_TIMEOUT_MS);
            if (!/commit complete/.test(committed))
                throw await discard(`commit failed, nothing was applied:
    ${committed.trim().slice(0, Junos.ANSWER_CHARS)}`);

            await Junos.run(channel, "exit configuration-mode");
            return;
        }

        const { minutes, prove } = guard;
        const committed = await Junos.edit(channel, `commit confirmed ${minutes} comment circuit`, Junos.COMMIT_TIMEOUT_MS);
        if (!/commit complete/.test(committed)) {
            throw await discard(`commit failed, nothing was applied:\n    ${Junos.excerpt(committed)}`);
        }

        console.log(`  committed; it rolls back in ${minutes} minutes unless Circuit logs in again`);

        try {
            await prove();
        } catch (error) {
            // The session still open restores the previous configuration at once. If it cannot, the device does when the time runs out.
            await Junos.edit(channel, "rollback 1").catch(() => undefined);
            await Junos.edit(channel, "commit comment circuit-restore", Junos.COMMIT_TIMEOUT_MS).catch(() => undefined);
            await Junos.run(channel, "exit configuration-mode").catch(() => undefined);
            throw new Error(
                `a fresh login failed (${(error as Error).message}); the previous configuration is restored, at the latest in ${minutes} minutes`,
                { cause: error }
            );
        }

        const confirmed = await Junos.edit(channel, "commit comment circuit-confirmed", Junos.COMMIT_TIMEOUT_MS);
        if (!/commit complete/.test(confirmed)) {
            throw new Error(
                `Circuit logged in again, but the confirmation failed; the device rolls back in ${minutes} minutes:\n    ${confirmed.trim().slice(0, Junos.ANSWER_CHARS)}`
            );
        }

        await Junos.run(channel, "exit configuration-mode");
        console.log("  logged in again, commit confirmed");
    }

    /** The lines of an answer after its echo. */
    private static excerpt(answer: string): string {
        return answer
            .trim()
            .split("\n")
            .slice(1, 1 + Junos.ANSWER_LINES)
            .join("\n    ");
    }

    private static fillPlan(set: string, prefixes: string[]): Plan {
        const list = `policy-options prefix-list ${set}`;
        const send = [`delete ${list}`, `set ${list}`, ...prefixes.map((prefix) => `set ${list} ${prefix}`)];
        return { steps: [{ title: list, show: [], send }], problems: [] };
    }

    /** The IP MTU of each port and LAG that carries a VLAN, or the default when none does. */
    private static carrierMtus(device: Device, vlan: string): number[] {
        const sizes = [Junos.DEFAULT_MTU];
        const carrying: (Port | Lag | undefined)[] = [
            ...Derive.ports(device).map(([, settings]) => settings),
            ...Object.values(device.interfaces?.lag ?? {}),
        ];

        for (const settings of carrying) {
            if (!settings || !("access_vlan" in settings || "trunk_vlans" in settings)) continue;

            const members = [settings.access_vlan, settings.native_vlan, ...(settings.trunk_vlans ?? [])];
            if (members.includes(vlan)) sizes.push(settings.mtu ?? Junos.DEFAULT_MTU);
        }

        return sizes.length > 1 ? sizes.slice(1) : sizes;
    }

    /** BGP settings Junos 21 has no statement for, and policy steps it cannot take. */
    private static bgpGaps(device: Device): string[] {
        const found: string[] = [];
        const bgp = device.routing?.bgp;

        if (bgp && bgp.asn === undefined) found.push("routing.bgp.asn, absent: write it here or in circuit.ts");

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            if (!neighbor) continue;

            const settings = JunosBgp.settingsOf(device, neighbor);
            if (settings.role) found.push(`routing.bgp.neighbors.${name}.role, Junos 21 has no BGP roles`);
            if (settings.ttl_security)
                found.push(
                    `routing.bgp.neighbors.${name}.ttl_security, Junos BGP sets only the TTL it sends, and has no setting that drops packets arriving with less than 255`
                );
            // IPv4 routes over an IPv6 session need a local IPv4 address the config has no field for.
            if (Address.family(neighbor.address) === "ipv6" && settings.address_families?.includes("ipv4")) {
                found.push(`routing.bgp.neighbors.${name}.address_families ipv4 over an IPv6 session`);
            }

            if (settings.keepalive !== undefined)
                found.push(`routing.bgp.neighbors.${name}.keepalive, the platform keeps it at a third of hold_time`);

            if (settings.route_reflector_client && !bgp?.cluster_id)
                found.push(
                    `routing.bgp.neighbors.${name}.route_reflector_client without routing.bgp.cluster_id: Junos needs a cluster ID, so write one`
                );
        }

        const clients = Object.values(bgp?.neighbors ?? {}).some(
            (neighbor) => neighbor && JunosBgp.settingsOf(device, neighbor).route_reflector_client
        );
        if (bgp?.cluster_id && !clients)
            found.push("routing.bgp.cluster_id without a route_reflector_client: Junos holds the cluster ID on its clients' sessions");

        for (const server of device.routing?.rpki ?? []) {
            if (server.description) found.push(`routing.rpki ${server.address} description`);
        }

        for (const [name, rules] of Object.entries(device.routing?.policies ?? {})) {
            (rules ?? []).forEach((rule, index) => {
                const where = `routing.policies.${name}[${index}]`;
                if ("communities" in rule && rule.communities !== undefined)
                    found.push(`${where}.communities, a rule the platform does not write`);
                if (!JunosBgp.isRouteRule(rule)) return;

                if (rule.set?.preferred_source) found.push(`${where}.set.preferred_source`);
                if (rule.if?.prefix && rule.if.prefix_length) found.push(`${where}.if.prefix with prefix_length`);
            });
        }

        // A rule takes its family from its prefix set, so a set holds one.
        for (const [name, set] of Object.entries(device.routing?.prefix_sets ?? {})) {
            const families = new Set(JunosBgp.prefixesOf(set ?? { prefixes: [] }).map((prefix) => Address.family(Address.host(prefix))));
            if (families.size > 1)
                found.push(`routing.prefix_sets.${name}.prefixes of both families, a policy rule takes its family from them`);
        }

        return found;
    }

    private static routedGaps(where: string, settings: Pick<Routed, "addresses" | "vrrp">): string[] {
        const found: string[] = [];
        const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

        if (settings.addresses?.some((entry) => typeof entry !== "string")) found.push(`${where}.addresses with a peer`);

        for (const group of settings.vrrp ?? []) {
            if (Address.family(group.address) === "ipv6") found.push(`${where}.vrrp ${group.id}, IPv6`);
            else if (!JunosRender.vrrpAddress(addresses, group))
                found.push(`${where}.vrrp ${group.id}, no address of the interface holds ${group.address}`);
        }

        return found;
    }

    /** Storm control in a form a profile holds: one threshold in percent for every kind. */
    private static switchedGaps(where: string, settings: Parameters<typeof JunosRender.stormProfile>[0], device: Device): string[] {
        const found: string[] = [];
        const storm = Object.values(settings.storm_control ?? {});

        if (storm.some((threshold) => "pps" in threshold)) found.push(`${where}.storm_control in pps, the platform takes percent`);
        else if (new Set(storm.map((threshold) => ("percent" in threshold ? threshold.percent : 0))).size > 1) {
            found.push(`${where}.storm_control, one threshold for every kind`);
        }

        if (typeof settings.stp === "object" && !device.switching?.stp) found.push(`${where}.stp while spanning tree is off on the device`);

        // The limit and the filter sit on the switching family. The filter and an ACL would both be its input filter.
        const switched = settings.access_vlan || settings.trunk_vlans;
        const inLag = "in_lag" in settings && settings.in_lag;

        for (const field of ["mac_limit", "ethertypes", "bound_to"] as const) {
            if (settings[field] === undefined) continue;

            if (inLag) found.push(`${where}.${field}, on a LAG member: set it on the LAG`);
            else if (!switched) found.push(`${where}.${field}, on a port or LAG that switches no VLAN`);
        }

        if (settings.ethertypes && "ingress_acl" in settings && settings.ingress_acl)
            found.push(`${where}.ethertypes with an ingress_acl, the port takes one filter`);
        if (settings.bound_to && settings.ethertypes) found.push(`${where}.bound_to with ethertypes, the port takes one filter`);
        if (settings.bound_to && "ingress_acl" in settings && settings.ingress_acl)
            found.push(`${where}.bound_to with an ingress_acl, the port takes one filter`);

        return found;
    }
}
