// Junos, as on the QFX series with its Enhanced Layer 2 Software.
//
// The configuration is read and written as `set` statements, one per line, the form `show configuration | display set` prints. A statement the render does not hold is deleted, at the shortest path that holds nothing the render wants. Changes stage in a candidate and take effect only at `commit`. `commit confirmed` rolls itself back unless confirmed, so access is proved by a fresh login before the commit is confirmed.

import type { Client, ClientChannel } from "ssh2";
import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Family, IP } from "../../schema";
import { ConsoleShell, SerialConsole, type ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Derive } from "../derive";
import { type ApplyOptions, type OsSupport, type Plan, type ReadOptions, type ReadSession, type Step, Platform } from "../platform";
import { JunosBgp } from "./bgp";
import { JunosNames, JunosRender } from "./render";

/** How a commit that could cut access is guarded: it rolls back after `minutes` unless `prove` shows access survived. */
export type Guard = { minutes: number; prove: () => Promise<void> };

export class Junos extends Platform {
    /** How the console asks for a login. Root lands in a shell, `%`, every other user in the CLI, `>`; a session left in configuration mode, `#`, leaves it first. Not yet proved on a device. */
    static readonly CONSOLE: ConsoleDialect = {
        // On a line of its own: the banner after a login says `Last login: ...`, and a chunk can end right after it.
        login: /(?:^|\n)login: $/,
        password: /Password:\s*$/,
        prompt: /[>%] $/,
        logout: "exit",
        others: [[/# $/, "exit configuration-mode\n"]],
    };

    /** The release this adapter renders for, and was proved on. */
    private static readonly SUPPORTED_MAJOR = 21;

    /** Statements the device keeps for itself: the release it runs and the number it gives each user. */
    private static readonly DEVICE_FACTS = [/^set version /, /^set system login user \S+ uid \d+$/];

    /** Names the platform keeps for its own system accounts. A user under one fails the commit check. */
    private static readonly SYSTEM_ACCOUNTS = new Set(["bind", "daemon", "kmem", "nobody", "operator", "sshd", "tty", "uucp"]);

    /** A value the device keeps hashed or encrypted, and the render writes as a marker, as one word both sides share. Each keeps the number of words. */
    private static readonly SECRETS: [RegExp, string][] = [
        [/ (?:encrypted-password|plain-text-password-value) (?:"[^"]*"|\S+)/, " password <secret>"],
        [/ (?:authentication-key|authentication-password) (?:"[^"]*"|\S+)/, " authentication-key <secret>"],
        [/ (?:privacy-key|privacy-password) (?:"[^"]*"|\S+)/, " privacy-key <secret>"],
        [/^set snmp community (?:"[^"]*"|\S+)/, "set snmp community <secret>"],
    ];

    /** Lists whose entries are named: a delete cannot stop at the list, `delete interfaces xe-0/0/1 unit`, only at an entry, `unit 0`. A leaf-list such as `vlan members` or `ciphers` can go whole. */
    private static readonly NAMED_LISTS = new Set([
        "address",
        "area",
        "as-path",
        "class",
        "collector",
        "community",
        "family",
        "file",
        "filter",
        "group",
        "host",
        "interface",
        "interfaces",
        "neighbor",
        "oid",
        "policer",
        "policy-statement",
        "pool",
        "prefix",
        "prefix-list",
        "qualified-next-hop",
        "range",
        "rib",
        "route",
        "security-level",
        "security-model",
        "security-name",
        "server",
        "server-group",
        "session",
        "storm-control-profiles",
        "term",
        "trap-group",
        "unit",
        "user",
        "view",
        "vlan",
        "vrrp-group",
    ]);

    /** A prompt at the end of what the device printed: `user@host> `, `user@host# `, or a shell's `% `. */
    private static readonly PROMPT = /[>#%] $/;

    /** The prompt in configuration mode, under its `[edit]` line. An echoed statement cannot end with it. */
    private static readonly EDIT_PROMPT = /\[edit[^\]\n]*\]\n[^\n]*# $/;

    /** What the device says when it refuses a statement in a load: `terminal:3:(14) syntax error: ...`. A warning, such as a statement not found, is not a refusal. */
    private static readonly REFUSED = /^terminal:\d+:\(\d+\) (?!warning)|^error: /m;

    /** Commands that only read. */
    private static readonly READS = /^show\s/;

    readonly name = "junos";

    readonly os: OsSupport = {
        name: "Juniper Junos",
        versions: "21",
        provedOn: "QFX5100-48S-6Q, Junos 21.4R3",
        checked: true,
    };

    readonly extension = ".conf";

    override readonly console = Junos.CONSOLE;

    unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type === "bridge") found.push(`interfaces.${name}, a bridge, which only FortiOS builds for now`);
            if (iface.type === "vlan" && iface.mac) found.push(`interfaces.${name}.mac, which only RouterOS sets for now`);
        }
        const names = new JunosNames(device);
        const users = device.users ?? {};

        const root = (users as Record<string, (typeof users)[keyof typeof users]>).root;
        if (!root) found.push("users without root, the platform needs a root password");
        if (root && root.role !== "admin") found.push("users.root.role, root is always admin");
        if (root?.description) found.push("users.root.description");
        if (device.connection.user === "root") found.push("connection.user root, which logs in to a shell rather than the CLI");

        for (const [name, user] of Object.entries(users)) {
            if (Junos.SYSTEM_ACCOUNTS.has(name)) found.push(`users.${name}, a name the platform keeps for a system account`);

            for (const key of user.ssh_keys ?? []) {
                const kind = key.split(" ")[0]!;
                if (!JunosRender.KEY_STATEMENT[kind]) found.push(`users.${name}.ssh_keys, a key of type ${kind}`);
            }
        }

        const management = device.management ?? {};

        for (const field of ["https", "api_tls", "privilege_password"] as const) {
            if (management[field]) found.push(`management.${field}`);
        }

        if (management.console) found.push("management.console, the console uses the device's users");
        if (management.interfaces) found.push("management.interfaces, which only FortiOS builds for now");
        if (management.native?.interfaces?.length) found.push("management.native.interfaces, NETCONF runs over IP only");
        if (management.ssh?.auth_timeout || management.ssh?.auth_retries) found.push("management.ssh.auth_timeout and auth_retries");

        for (const service of ["telnet", "ftp", "snmp"] as const) {
            if (management[service]?.port) found.push(`management.${service}.port`);
        }

        const system = device.system ?? {};

        if (system.release_channel) found.push("system.release_channel");
        if (system.transceiver_monitoring !== undefined) found.push("system.transceiver_monitoring, it is always on");
        if (system.dns?.serve) found.push("system.dns.serve");
        if (system.ip?.syn_cookies) found.push("system.ip.syn_cookies");
        if (system.logging?.local?.lines_per_file !== undefined) found.push("system.logging.local.lines_per_file, files rotate by size");

        // Time is answered only to its servers, which the filter names by address.
        if (system.ntp && !system.ntp.serve && system.ntp.servers.some((server) => !Address.isValid(server))) {
            found.push("system.ntp.servers by name while not serving, the filter keeping others out needs addresses");
        }

        for (const [name, port] of Object.entries(device.ports ?? {})) {
            if (!port) continue;

            const physical = names.port(name);

            if (physical.startsWith("em")) {
                for (const field of [
                    "access_vlan",
                    "trunk_vlans",
                    "native_vlan",
                    "lag",
                    "stp",
                    "storm_control",
                    "speed",
                    "vrrp",
                    "vrf",
                    "mtu",
                    "acl",
                    "ipv6_ra",
                ] as const) {
                    if (port[field] !== undefined) found.push(`ports.${name}.${field}, a management port only routes`);
                }
            }

            if (port.speed && !(port.speed === "1g" && physical.startsWith("ge-")))
                found.push(`ports.${name}.speed ${port.speed}, only a 1G optic in a 10G cage`);

            if (port.hardware_offload !== undefined) found.push(`ports.${name}.hardware_offload`);

            // A port filter cannot match the VLAN a frame is switched in: `learn-vlan-id` is refused on an ingress port.
            const acl = port.acl ? device.acls?.[port.acl] : undefined;
            if (acl?.some((rule) => rule.match?.vlan)) found.push(`acls.${port.acl} matching a VLAN, on port ${name}`);

            found.push(...Junos.routedGaps(`ports.${name}`, port));
            found.push(...Junos.switchedGaps(`ports.${name}`, port, device));
        }

        const loopbackTables = new Set<string>();

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type === "vxlan" || iface.type === "wireguard") {
                found.push(`interfaces.${name}, a ${iface.type}`);
                continue;
            }

            if (iface.hardware_offload !== undefined) found.push(`interfaces.${name}.hardware_offload`);
            if (iface.type === "loopback" && iface.ipv6_ra) found.push(`interfaces.${name}.ipv6_ra, on a loopback`);
            if (iface.type === "loopback" && iface.mtu !== undefined) found.push(`interfaces.${name}.mtu, on a loopback`);
            if (iface.type === "gre" && iface.vrrp?.length) found.push(`interfaces.${name}.vrrp, on a tunnel`);

            // A VLAN interface sends no larger packets than the ports carrying its VLAN take; the device warns and carries on.
            if (iface.type === "vlan" && iface.mtu !== undefined) {
                const smallest = Math.min(...Junos.carriers(device, iface.vlan));
                if (iface.mtu > smallest) found.push(`interfaces.${name}.mtu ${iface.mtu}, above the ${smallest} its VLAN's ports carry`);
            }

            found.push(...Junos.routedGaps(`interfaces.${name}`, iface));

            if (iface.type === "lag") found.push(...Junos.switchedGaps(`interfaces.${name}`, iface, device));

            if (iface.type === "loopback") {
                const table = iface.vrf ?? "";
                if (loopbackTables.has(table)) found.push(`interfaces.${name}, a second loopback in one routing table`);
                loopbackTables.add(table);
                if (iface.vrrp?.length) found.push(`interfaces.${name}.vrrp, on a loopback`);
            }
        }

        const ids = [...Derive.lagIds(device).values()];
        if (ids.length !== new Set(ids).size) found.push("interfaces, two LAGs with one number");

        if (device.stp?.priority !== undefined && device.stp.priority % 4096 !== 0) found.push("stp.priority, in steps of 4096");

        const routing = device.routing;
        found.push(...Junos.bgpGaps(device));

        const tables = new Map<string, number>();

        for (const route of routing?.static ?? []) {
            if (route.description) found.push(`routing.static ${route.prefix} description`);

            const table = `${route.vrf ?? ""} ${Address.split(route.prefix).addr}/${Address.split(route.prefix).len}`;
            tables.set(table, (tables.get(table) ?? 0) + 1);
        }

        for (const route of routing?.static ?? []) {
            const table = `${route.vrf ?? ""} ${Address.split(route.prefix).addr}/${Address.split(route.prefix).len}`;
            if (route.blackhole && tables.get(table)! > 1)
                found.push(`routing.static ${route.prefix}, a blackhole beside another route to the same prefix`);
        }

        for (const area of Object.values(routing?.ospf?.areas ?? {})) {
            for (const iface of Object.keys(area.interfaces)) {
                const settings = device.interfaces?.[iface] ?? device.ports?.[iface as keyof typeof device.ports];
                if (settings?.vrf) found.push(`routing.ospf on ${iface}, which routes in a VRF`);
            }
        }

        for (const field of ["firewall", "hardware_offload", "certificates"] as const) {
            if (device[field] !== undefined) found.push(field);
        }

        const relayed = new Set(Object.values(device.dhcp_relay ?? {}).map((relay) => relay.interface));

        for (const [name, server] of Object.entries(device.dhcp ?? {})) {
            // The device refuses a relay and a server on one interface: `Interface irb.10 already configured`.
            if (relayed.has(server.interface)) found.push(`dhcp.${name}.interface, which a DHCP relay also uses`);

            const settings = device.interfaces?.[server.interface] ?? device.ports?.[server.interface as keyof typeof device.ports];
            if (settings?.vrf) found.push(`dhcp.${name}.interface, which routes in a VRF`);
            if (Address.family(Address.host(server.network)) === "ipv6") found.push(`dhcp.${name}.network, IPv6`);
        }

        for (const [name, relay] of Object.entries(device.dhcp_relay ?? {})) {
            if (relay.servers.some((server) => Address.family(server) === "ipv6")) found.push(`dhcp_relay.${name}.servers, IPv6`);
        }

        const flow = device.flow_export;
        if (flow && flow.protocol !== "sflow") found.push(`flow_export.protocol ${flow.protocol}, the platform exports sFlow`);
        if (flow?.protocol === "sflow" && flow.sampling === undefined) found.push("flow_export.sampling, the platform samples");

        for (const name of flow?.interfaces ?? []) {
            if (names.members(name).some((port) => port.startsWith("em"))) found.push(`flow_export.interfaces ${name}, a management port`);
        }

        return found;
    }

    render(device: Device): string {
        return JunosRender.of(device);
    }

    async read(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<string> {
        if (options.console) {
            return Junos.onConsole(device, async (channel) => {
                await Junos.checkVersion((command) => Junos.run(channel, command), device);
                const output = await Junos.run(channel, "show configuration | display set | no-more", 180_000);
                if (!/^set /m.test(output)) throw new Error(`${device.name} returned no configuration`);

                return Junos.clean(output);
            });
        }

        const client = await Junos.login(device);

        try {
            await Junos.checkVersion((command) => Ssh.exec(client, command), device);
            const output = await Ssh.exec(client, "show configuration | display set | no-more", 180_000);
            if (!/^set /m.test(output)) throw new Error(`${device.name} returned no configuration`);

            return Junos.clean(output);
        } finally {
            client.end();
        }
    }

    /**
     * What changes, by section.
     *
     * A statement the render holds and the device does not is set. One the device holds and the render does not is deleted at the shortest path that holds nothing the render wants, so a removed port goes as a whole and a changed value goes alone. A hidden value ends a path by its name alone; a hidden name in a list, such as a community, stays `<redacted>` and the session names each entry when it sends the plan. A statement the device holds deactivated is activated when the render wants it.
     *
     * A policy, a filter or an import or export chain is ordered, so when anything in one changes it is deleted and set again whole, in the render's order. A path the render marks as generated, such as a prefix list `refresh` fills, keeps what the device holds.
     */
    plan(desired: string, current: string, options: Pick<ApplyOptions, "secrets">): Plan {
        const lines = (text: string, verb: string) => text.split("\n").filter((line) => line.startsWith(`${verb} `));

        const wanted = lines(desired, "set");
        const deactivated = lines(current, "deactivate");
        const generated = desired
            .split("\n")
            .filter((line) => line.startsWith(JunosBgp.GENERATED))
            .map((line) => Junos.wordsOf(line.slice(JunosBgp.GENERATED.length)).map(Junos.bare));

        const printed = lines(current, "set").filter((line) => !Junos.DEVICE_FACTS.some((fact) => fact.test(line)));
        const isGenerated = (line: string) =>
            generated.some((path) => Junos.keyOf(line).length > path.length && Junos.startsWith(Junos.keyOf(line), path));
        const existing = printed.filter((line) => !isGenerated(line));

        const join = (path: string[]) => path.join("\u0000");
        const wantedPaths = wanted.map(Junos.keyOf);
        const wantedKeys = new Set(wantedPaths.map(join));
        const existingKeys = new Set(existing.map((line) => join(Junos.keyOf(line))));

        const wantedUnder = (path: string[]) => wantedPaths.filter((other) => Junos.startsWith(other, path));

        const sections = new Map<string, { show: string[]; activate: string[]; remove: string[]; add: string[] }>();
        const sectionFor = (path: string[]) => {
            const name = Junos.sectionOf(path);
            if (!sections.has(name)) sections.set(name, { show: [], activate: [], remove: [], add: [] });
            return sections.get(name)!;
        };

        // Sections in the order the render lists them, then the ones only the device has.
        for (const path of wantedPaths) sectionFor(path);

        // Ordered blocks the render holds whose items or order differ from the device's are rewritten whole.
        const rewritten: string[][] = [];
        const blocks = new Map<string, string[]>();
        for (const path of wantedPaths) {
            const ordered = Junos.orderedBlockOf(path);
            if (ordered) blocks.set(join(ordered.block), ordered.block);
        }

        for (const block of blocks.values()) {
            const inBlock = (line: string) => Junos.startsWith(Junos.keyOf(line), block);
            const order = (all: string[]) => [...new Set(all.filter(inBlock).map((line) => Junos.orderedBlockOf(Junos.keyOf(line))!.item))];
            const keys = (all: string[]) =>
                all
                    .filter(inBlock)
                    .map((line) => join(Junos.keyOf(line)))
                    .sort()
                    .join("\n");

            const wantedHere = wanted.filter(inBlock);
            const existingHere = existing.filter(inBlock);
            if (join(order(wanted)) === join(order(existing)) && keys(wanted) === keys(existing)) continue;

            rewritten.push(block);
            const section = sectionFor(block);

            if (existingHere.length)
                section.remove.push(
                    `delete ${Junos.wordsOf(existingHere[0]!)
                        .slice(1, 1 + block.length)
                        .join(" ")}`
                );
            section.show.push(...existingHere.map((line) => `- ${line}`), ...wantedHere.map((line) => `+ ${line}`));
            section.add.push(...wantedHere);
        }

        const isRewritten = (line: string) => rewritten.some((block) => Junos.startsWith(Junos.keyOf(line), block));

        const removed: string[][] = [];

        for (const line of existing) {
            if (isRewritten(line)) continue;

            const path = Junos.keyOf(line);
            if (wantedKeys.has(join(path))) continue;
            // The render extends this statement, so setting the longer one replaces it.
            if (wantedUnder(path).length) continue;

            let length = 1;
            while (wantedUnder(path.slice(0, length)).length) length++;
            while (length < path.length && !Junos.canStopAt(path, length - 1)) length++;

            const hidden = path.indexOf("<secret>");
            if (hidden >= 0 && hidden < length && !Junos.NAMED_LISTS.has(path[hidden - 1]!)) length = hidden;

            removed.push(Junos.wordsOf(line).slice(1, 1 + length));
        }

        // A path inside another removed path goes with it.
        const isInside = (path: string[], other: string[]) =>
            other.length < path.length && other.every((word, index) => Junos.bare(path[index]!) === Junos.bare(word));
        const removals = removed.filter(
            (path, index) =>
                !removed.some((other) => isInside(path, other)) && removed.findIndex((other) => join(other) === join(path)) === index
        );

        const isRemoved = (line: string) => removals.some((path) => Junos.startsWith(Junos.keyOf(line), path.map(Junos.bare)));

        for (const path of removals) {
            const section = sectionFor(path.map(Junos.bare));
            section.remove.push(`delete ${path.join(" ")}`);

            const under = existing.filter((line) => Junos.startsWith(Junos.keyOf(line), path.map(Junos.bare)));
            section.show.push(...under.map((line) => `- ${line}`));
        }

        for (const line of deactivated) {
            const path = Junos.wordsOf(line).slice(1);
            if (!wantedUnder(path.map(Junos.bare)).length) continue;

            const section = sectionFor(path.map(Junos.bare));
            section.activate.push(`activate ${path.join(" ")}`);
            section.show.push(`+ activate ${path.join(" ")}`);
        }

        // A statement the device extends with one it keeps is there already: the device prints only the longest.
        const extended = (path: string[]) => printed.some((line) => !isRemoved(line) && Junos.startsWith(Junos.keyOf(line), path));

        for (const line of wanted) {
            if (isRewritten(line)) continue;

            const path = Junos.keyOf(line);
            const isNew = !existingKeys.has(join(path)) && !extended(path);
            const rotated = options.secrets && line.includes("<secret:");
            if (!isNew && !rotated) continue;

            const section = sectionFor(path);
            section.add.push(line);
            section.show.push(`+ ${line}`);

            // A community is named by its value, so a new value is a second community. The device's go first.
            const clear = "delete snmp community <redacted>";
            if (rotated && line.startsWith("set snmp community ") && !section.remove.includes(clear)) section.remove.push(clear);
        }

        const steps: Step[] = [...sections]
            .filter(([, section]) => section.show.length)
            .map(([title, section]) => ({ title, show: section.show, send: [...section.activate, ...section.remove, ...section.add] }));

        return { steps, problems: [] };
    }

    async apply(device: Device, _network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void> {
        if (options.console) {
            await Junos.onConsole(device, async (channel, relogin) => {
                await Junos.checkVersion((command) => Junos.run(channel, command), device);

                // A fresh login on the console ends the session that holds the candidate, so the proof logs in again and takes the candidate back to confirm the commit.
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

    /** Replace a prefix list `refresh` fetched. It cannot cut access, so it is committed without a rollback. */
    async fill(device: Device, _network: readonly Device[], set: string, _family: Family, prefixes: string[]): Promise<void> {
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

    readOnly(command: string): boolean {
        return Junos.READS.test(command);
    }

    /** Over SSH, each command runs on its own, as the read does. */
    async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        if (options.console) {
            const opened = await Junos.openConsole(device);
            const shell = new ConsoleShell(opened.channel, Junos.CONSOLE, ConsoleShell.SETTLE);

            return {
                run: (command, timeout) => shell.run(command, timeout),
                close: () => {
                    shell.logout();
                    opened.close();
                },
            };
        }

        const client = await Junos.login(device);
        return { run: (command, timeout) => Ssh.exec(client, command, timeout), close: () => client.end() };
    }

    /** A statement's words; a quoted value is one word with its quotes. */
    private static wordsOf(statement: string): string[] {
        return statement.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    }

    /** A word as the platform means it, without quotes or escapes, so a value quoted on one side and not on the other compares equal. */
    private static bare(word: string): string {
        return word.startsWith('"') ? word.slice(1, -1).replace(/\\(.)/g, "$1") : word;
    }

    /** A statement in the form both sides compare in: its words, secrets as one marker, quotes dropped. */
    private static keyOf(statement: string): string[] {
        let canonical = statement;
        for (const [pattern, replacement] of Junos.SECRETS) canonical = canonical.replace(pattern, replacement);

        return Junos.wordsOf(canonical).slice(1).map(Junos.bare);
    }

    /** The device prints a password as a hash, an SNMP key as a reversible cipher, and a community as itself. None leave the read. */
    private static scrub(text: string): string {
        return text
            .replace(/ ## SECRET-DATA$/gm, "")
            .replace(/((?:encrypted-password|authentication-key|privacy-key) )(?:"[^"]*"|\S+)/g, "$1<redacted>")
            .replace(/^(set snmp community )(?:"[^"]*"|\S+)/gm, "$1<redacted>")
            .replace(/"\$\d\$[^"]*"/g, "<redacted>");
    }

    /** The configuration's statements from what `show configuration | display set` printed. */
    private static clean(output: string): string {
        const statements = output
            .replace(/\r/g, "")
            .split("\n")
            .map((line) => line.trimEnd())
            .filter((line) => /^(set|deactivate) /.test(line))
            .filter((line) => !Junos.DEVICE_FACTS.some((fact) => fact.test(line)));

        return Junos.scrub(statements.join("\n") + "\n");
    }

    /** Whether a delete may stop after `path[index]`. Below the top level a named list may not; `vlan` names a list except in `vlan members`. */
    private static canStopAt(path: string[], index: number): boolean {
        if (index === 0 || !Junos.NAMED_LISTS.has(path[index]!)) return true;

        return path[index] === "vlan" && path[index + 1] === "members";
    }

    /** The section a statement belongs to, for a reviewer: `interfaces xe-0/0/1`, `system login`, `snmp`. */
    private static sectionOf(path: string[]): string {
        return path.slice(0, 2).join(" ");
    }

    /**
     * The ordered block a statement sits in, and its item there: a policy's or a filter's term, or one policy of an import or export chain. The device keeps their order, and `set` adds at the end.
     */
    private static orderedBlockOf(path: string[]): { block: string[]; item: string } | undefined {
        if (path[0] === "policy-options" && path[1] === "policy-statement" && path[3] === "term") {
            return { block: path.slice(0, 3), item: path[4]! };
        }

        if (path[0] === "firewall" && path[1] === "family" && path[3] === "filter" && path[5] === "term") {
            return { block: path.slice(0, 5), item: path[6]! };
        }

        const chain = path.length - 2;
        if (path[0] === "protocols" && (path[chain] === "import" || path[chain] === "export")) {
            return { block: path.slice(0, chain + 1), item: path[chain + 1]! };
        }

        return undefined;
    }

    /** Whether a path starts with another. */
    private static startsWith(path: string[], prefix: string[]): boolean {
        return prefix.every((word, index) => path[index] === word);
    }

    private static async login(device: Device): Promise<Client> {
        const { port, user, password } = Secrets.loginOf(device);

        return Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user,
            password,
        });
    }

    /** Refuse a device on a release this adapter was not proved on, before anything is read or sent. */
    private static async checkVersion(ask: (command: string) => Promise<string>, device: Device): Promise<void> {
        const version = await ask("show version | match Junos:");
        const release = /Junos: (\d+)\.(\S+)/.exec(version);

        if (!release) throw new Error(`${device.name} did not say which Junos it runs: ${version.slice(0, 200)}`);
        if (Number(release[1]) !== Junos.SUPPORTED_MAJOR) {
            throw new Error(
                `${device.name} runs Junos ${release[1]}.${release[2]}; this adapter renders for Junos ${Junos.SUPPORTED_MAJOR}`
            );
        }
    }

    /** Send one line and wait for the prompt to come back. */
    private static async run(channel: ClientChannel, line: string, timeout = 60_000): Promise<string> {
        channel.write(`${line}\n`);
        const output = await Ssh.readUntil(channel, (text) => Junos.PROMPT.test(text.replace(/\r/g, "")), timeout, 300);
        return output.replace(/\r/g, "");
    }

    /** Send one line in configuration mode and wait for its prompt to come back. */
    private static async edit(channel: ClientChannel, line: string, timeout = 60_000): Promise<string> {
        channel.write(`${line}\n`);
        const output = await Ssh.readUntil(channel, (text) => Junos.EDIT_PROMPT.test(text.replace(/\r/g, "")), timeout, 300);
        return output.replace(/\r/g, "");
    }

    /** Log in on the console and open the CLI. Returns the console, a way to log in afresh, and how to let the console go. */
    private static async openConsole(device: Device) {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);

        // The CLI is opened on a prompt asked for after the login, since the login's own prompt is already read.
        const login = async () => {
            await SerialConsole.login(opened.channel, Junos.CONSOLE, user, password, console.passwordOnly);
            const ready = Junos.openCli(opened.channel);
            opened.channel.write("\n");
            await ready;
        };

        try {
            await login();
        } catch (error) {
            opened.close();
            throw error;
        }

        return { channel: opened.channel, login, close: opened.close };
    }

    /** Log in on the console, open the CLI, and run `work` in it with a way to log in afresh. Logs out after. */
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
            opened.close();
        }
    }

    /** An interactive CLI with paging off. Root lands in a shell and starts the CLI from there. */
    private static async openCli(channel: ClientChannel): Promise<void> {
        const banner = await Ssh.readUntil(channel, (text) => Junos.PROMPT.test(text.replace(/\r/g, "")), 20_000, 500);
        if (/% $/.test(banner.replace(/\r/g, ""))) await Junos.run(channel, "cli");

        await Junos.run(channel, "set cli screen-length 0");
        await Junos.run(channel, "set cli screen-width 0");
        await Junos.run(channel, "set cli complete-on-space off");
    }

    /**
     * A delete through a name the read redacted, `delete snmp community <redacted>`, as one delete for each entry the device holds there. The names stay in the session.
     */
    private static async named(channel: ClientChannel, line: string): Promise<string[]> {
        const words = Junos.wordsOf(line).slice(1);
        const at = words.indexOf("<redacted>");
        if (at < 0) return [line];

        // `show` cannot stop at a list either, so the list's parent is shown and its entries picked out.
        const shown = await Junos.edit(channel, `show ${words.slice(0, at - 1).join(" ")} | display set`);
        const inList = (statement: string[]) =>
            statement[0] === "set" && words.slice(0, at).every((word, index) => statement[index + 1] === word);
        const names = new Set(
            shown
                .split("\n")
                .map(Junos.wordsOf)
                .filter(inList)
                .map((statement) => statement[at + 1]!)
        );

        return [...names].map((name) => `delete ${[...words.slice(0, at), name, ...words.slice(at + 1)].join(" ")}`);
    }

    /**
     * Load the plan into an exclusive candidate and check it. With a guard, commit it to roll back after `minutes`, prove access, then confirm; without one, commit it outright.
     *
     * Deletions go before the statements that are set, so a path deleted and set again in one plan ends up set.
     */
    private static async configure(channel: ClientChannel, plan: Plan, guard?: Guard, paced = false): Promise<void> {
        const sent = plan.steps.flatMap((step) => step.send);

        const entered = await Junos.run(channel, "configure exclusive");
        if (!/Entering configuration mode/.test(entered) || /^error: /m.test(entered)) {
            throw new Error(`the candidate could not be locked: ${entered.trim().slice(0, 300)}`);
        }

        const deletions: string[] = [];
        for (const line of sent.filter((line) => line.startsWith("delete "))) deletions.push(...(await Junos.named(channel, line)));

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
        await Ssh.readUntil(channel, (text) => text.includes("[Type ^D at a new line to end input]"), 20_000, 300);

        // A serial console has no flow control: statements sent at once overrun it and arrive garbled. There, each waits for the echo of the one before.
        for (const line of ordered) {
            const statement = Secrets.substitute(line);
            channel.write(`${statement}\n`);
            if (paced) await Ssh.readUntil(channel, (text) => text.replace(/\r/g, "").includes(statement.slice(-24)), 20_000, 50);
        }

        const loaded = await Junos.edit(channel, "\u0004", 300_000);
        const refused = loaded.split("\n").filter((line) => Junos.REFUSED.test(line));
        if (refused.length) throw await discard(`the device refused the plan, nothing was applied:\n    ${refused.join("\n    ")}`);

        const checked = await Junos.edit(channel, "commit check", 600_000);
        if (!/configuration check succeeds/.test(checked)) {
            throw await discard(`commit check failed, nothing was applied:\n    ${checked.trim().split("\n").slice(1, 20).join("\n    ")}`);
        }

        if (!guard) {
            const committed = await Junos.edit(channel, "commit comment circuit", 600_000);
            if (!/commit complete/.test(committed))
                throw await discard(`commit failed, nothing was applied:
    ${committed.trim().slice(0, 300)}`);

            await Junos.run(channel, "exit configuration-mode");
            return;
        }

        const { minutes, prove } = guard;
        const committed = await Junos.edit(channel, `commit confirmed ${minutes} comment circuit`, 600_000);
        if (!/commit complete/.test(committed)) {
            throw await discard(`commit failed, nothing was applied:\n    ${committed.trim().split("\n").slice(1, 20).join("\n    ")}`);
        }

        console.log(`  committed; it rolls back in ${minutes} minutes unless access is proved`);

        try {
            await prove();
        } catch (error) {
            // The session still open restores the previous configuration at once; if it cannot, the device does when the time runs out.
            await Junos.edit(channel, "rollback 1", 60_000).catch(() => undefined);
            await Junos.edit(channel, "commit comment circuit-restore", 600_000).catch(() => undefined);
            await Junos.run(channel, "exit configuration-mode").catch(() => undefined);
            throw new Error(
                `a fresh login failed (${(error as Error).message}); the previous configuration is restored, at the latest in ${minutes} minutes`
            );
        }

        const confirmed = await Junos.edit(channel, "commit comment circuit-confirmed", 600_000);
        if (!/commit complete/.test(confirmed)) {
            throw new Error(
                `access was proved but the confirmation failed; the device rolls back in ${minutes} minutes:\n    ${confirmed.trim().slice(0, 300)}`
            );
        }

        await Junos.run(channel, "exit configuration-mode");
        console.log("  logged in again, commit confirmed");
    }

    /** The plan that replaces a prefix list's entries with what a registry returned. */
    private static fillPlan(set: string, prefixes: string[]): Plan {
        const list = `policy-options prefix-list ${set}`;
        const send = [`delete ${list}`, `set ${list}`, ...prefixes.map((prefix) => `set ${list} ${prefix}`)];
        return { steps: [{ title: list, show: [], send }], problems: [] };
    }

    /** The IP MTU of every port and LAG that carries a VLAN; 1500 where none is given. */
    private static carriers(device: Device, vlan: string): number[] {
        const sizes = [1500];
        const carrying = [...Object.values(device.ports ?? {}), ...Object.values(device.interfaces ?? {})];

        for (const settings of carrying) {
            if (!settings || !("access_vlan" in settings || "trunk_vlans" in settings)) continue;

            const members = [settings.access_vlan, settings.native_vlan, ...(settings.trunk_vlans ?? [])];
            if (members.includes(vlan)) sizes.push(settings.mtu ?? 1500);
        }

        return sizes.length > 1 ? sizes.slice(1) : sizes;
    }

    /** BGP settings Junos 21 has no statement for, and policy steps it cannot take. */
    private static bgpGaps(device: Device): string[] {
        const found: string[] = [];
        const bgp = device.routing?.bgp;

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const settings = JunosBgp.settingsOf(device, neighbor);
            if (settings.role) found.push(`routing.bgp.neighbors.${name}.role, Junos 21 has no BGP roles`);
            // IPv4 routes over an IPv6 session need a local IPv4 address the config has no field for.
            if (Address.family(neighbor.address) === "ipv6" && settings.families?.includes("ipv4")) {
                found.push(`routing.bgp.neighbors.${name}.families ipv4 over an IPv6 session`);
            }

            if (settings.keepalive !== undefined)
                found.push(`routing.bgp.neighbors.${name}.keepalive, the platform keeps it at a third of hold_time`);
        }

        for (const server of device.routing?.rpki ?? []) {
            if (server.description) found.push(`routing.rpki ${server.address} description`);
        }

        for (const [name, rules] of Object.entries(device.policies ?? {})) {
            rules.forEach((rule, index) => {
                const where = `policies.${name}[${index}]`;
                if (rule.set?.preferred_source) found.push(`${where}.set.preferred_source`);
                if (rule.match?.prefix && rule.match.prefix_length) found.push(`${where}.match.prefix with prefix_length`);
            });
        }

        return found;
    }

    /** Layer 3 settings the platform cannot express on a port or an interface. */
    private static routedGaps(
        where: string,
        settings: { addresses?: readonly (string | { address: string; peer: string })[]; vrrp?: readonly { id: number; address: IP }[] }
    ): string[] {
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

        if (typeof settings.stp === "object" && !device.stp) found.push(`${where}.stp while spanning tree is off on the device`);

        return found;
    }
}
