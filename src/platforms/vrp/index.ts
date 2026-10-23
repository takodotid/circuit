// Huawei VRP, as on the CE series.
//
// Configuration reads as blocks indented under their header, `#` between blocks, and `undo` to remove a line. Changes stage in a candidate and take effect only at `commit`, so a refused line leaves nothing applied: the candidate is cleared. `commit` does not write to flash; `save` does, and without it a reboot brings the old configuration back. There is no scheduler to restore from, so access is proved by a fresh login before saving.

import type { Client, ClientChannel } from "ssh2";
import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device } from "../../schema";
import { ConsoleShell, SerialConsole, type ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Derive } from "../derive";
import { LineDiff, type Dialect, type Group } from "../line-diff";
import { type ApplyOptions, type OsSupport, type Plan, type ReadOptions, type ReadSession, Platform } from "../platform";
import { VrpRender } from "./render";

export class Vrp extends Platform {
    /** How the console asks for a login: the same question to change the password, always answered no, a system view left with `return`, and the line's banner after a logout or a refused password answered with Enter. Not yet proved on a device. */
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
        "drop-profile",
        "dcb ",
        "diffserv domain",
        "vlan reserved",
        "interface MEth",
        "interface NULL",
        "stack",
        "vm-manager",
        "return",
        "authentication-scheme default",
        "authorization-scheme default",
        "accounting-scheme default",
        "domain default",
        "Info:",
        // Derived from the switch's MAC once SNMP is on.
        "snmp-agent local-engineid",
    ];

    /** Lines whose removal takes only their keyword, not their value. */
    private static readonly UNDO_BY_KEYWORD =
        /^(description|name|port default vlan|port link-type|port trunk pvid vlan|set authentication password|eth-trunk|ip binding vpn-instance|ssh server cipher|ssh server hmac|ssh server key-exchange|info-center max-logfile-number|info-center source default channel \d+ log level|info-center loghost \S+|alarm \S+ severity|ip route-static bfd \S+|mac-address limit)\b/;

    /** Lines a new line of the same kind replaces whole, so the old one is not undone first. */
    private static readonly REPLACED_WHOLE = /^(ip route-static bfd \S+) /;

    private static readonly DIALECT: Dialect = {
        block: /^(interface |vlan \d+$|acl number |aaa$|user-interface |ospf \d+|ip vpn-instance |bfd$|alarm$)/,
        indented: true,
        terminator: "#",
        ignore: (line) => Vrp.DEVICE_FACTS.some((fact) => line.startsWith(fact)),
        undo: Vrp.undo,
        leave: "quit",
        // The console refuses to drop its password while password login is still on.
        first: /^authentication-mode /,
        canon: Vrp.canon,
        order: Vrp.order,
    };

    /** The platform offers an ECDSA host key it then signs wrongly, so RSA is asked for. */
    private static readonly HOST_KEYS = ["ssh-rsa"];

    /** What the device prints when it refuses a line. */
    private static readonly REFUSED = /^\s*Error|Unrecognized command|Incomplete command|Wrong parameter|Too many parameters/m;

    /** A setting whose password the platform asks for interactively: the command, then the password, then the password again. */
    private static readonly INTERACTIVE =
        /^(snmp-agent usm-user v3 \S+ (?:authentication|privacy)-mode \S+) cipher <secret:([A-Za-z0-9_./:-]+)>$/;

    private static readonly NOT_SAVED = "Not saved: a reboot restores the previous configuration.";

    /** Commands that only read. A `?` sent by a script is run, not taken as help, so a line with one is refused. */
    private static readonly READS = /^display\s[^?]*$/;

    readonly name = "vrp";

    readonly os: OsSupport = {
        name: "Huawei VRP",
        versions: "V200R005",
        provedOn: "CE6855-48S6Q-HI, V200R005C00SPC800",
        checked: false,
    };

    readonly extension = ".cfg";

    override readonly console = Vrp.CONSOLE;

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
                if (port[field] !== undefined) found.push(`ports.${name}.${field}, ports are switched; use a VLAN interface`);
            }

            for (const field of ["mac_limit", "ethertypes"] as const) {
                if (port[field] !== undefined && port.lag) found.push(`ports.${name}.${field} on a LAG member, set it on the LAG`);
            }

            if (port.lldp === true && !device.lldp) found.push(`ports.${name}.lldp true while LLDP is off on the device`);
            const storm = Object.values(port.storm_control ?? {});
            if (storm.some((threshold) => "pps" in threshold)) found.push(`ports.${name}.storm_control in pps, the platform takes percent`);
        }

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "vlan" && iface.type !== "lag") found.push(`interfaces.${name}, a ${iface.type}`);
            if (iface.type === "lag" && iface.addresses?.length) found.push(`interfaces.${name}.addresses, LAGs are switched`);
            if (iface.type === "lag" && iface.mac_limit !== undefined) found.push(`interfaces.${name}.mac_limit, on a LAG is not proved`);
            if (iface.type === "lag" && iface.ethertypes) found.push(`interfaces.${name}.ethertypes, on a LAG is not proved`);
            if (iface.mtu !== undefined) found.push(`interfaces.${name}.mtu`);
            if (iface.ipv6_ra) found.push(`interfaces.${name}.ipv6_ra`);
            for (const group of iface.vrrp ?? [])
                if (Address.family(group.address) === "ipv6") found.push(`interfaces.${name}.vrrp for IPv6`);
        }

        for (const [name, vrf] of Object.entries(device.vrfs ?? {})) {
            if (vrf.description) found.push(`vrfs.${name}.description`);
        }

        const routing = device.routing;
        if (routing?.bgp) found.push("routing.bgp");
        if (routing?.rpki) found.push("routing.rpki");
        if (routing?.ospf?.families?.includes("ipv6")) found.push("routing.ospf for IPv6");

        const bfd = routing?.bfd;
        if (bfd && !(Number.isInteger(bfd.interval) && bfd.interval >= 50 && bfd.interval <= 1000))
            found.push("routing.bfd.interval, between 50 and 1000 ms on the platform");
        if (bfd && !(Number.isInteger(bfd.multiplier) && bfd.multiplier >= 3 && bfd.multiplier <= 50))
            found.push("routing.bfd.multiplier, between 3 and 50 on the platform");

        for (const route of routing?.static ?? []) {
            if (!route.bfd) continue;

            const where = `routing.static ${route.prefix} bfd`;
            if (route.vrf) found.push(`${where} in a VRF, not proved`);
            else if (!route.via || Address.family(route.via) !== "ipv4") found.push(`${where}, needs an IPv4 via`);
            else if (!VrpRender.localAddressTo(device, route.via))
                found.push(`${where}, the device has no address on the network of ${route.via}`);
        }

        for (const [index, route] of (routing?.static ?? []).entries()) {
            if (route.description && Address.family(Address.split(route.prefix).addr) === "ipv6")
                found.push(`routing.static[${index}].description for IPv6`);
        }

        for (const field of ["firewall", "dhcp", "acls", "policies", "prefix_sets", "hardware_offload", "certificates"] as const) {
            if (device[field] !== undefined) found.push(field);
        }

        for (const [name, relay] of Object.entries(device.dhcp_relay ?? {})) {
            if (device.interfaces?.[relay.interface]?.type !== "vlan")
                found.push(`dhcp_relay.${name}.interface, relays run on VLAN interfaces`);
        }

        // The platform reserves this name.
        if (device.users && "admin" in device.users) found.push("users.admin, the platform reserves the name");

        const management = device.management ?? {};

        for (const field of ["http", "https", "api", "api_tls", "ftp", "native", "privilege_password"] as const) {
            if (management[field]) found.push(`management.${field}`);
        }

        if (management.ssh?.auth_timeout || management.ssh?.auth_retries) found.push("management.ssh.auth_timeout and auth_retries");

        if (device.lldp && device.lldp !== true) found.push("lldp.interfaces, use lldp on the ports instead");

        const system = device.system ?? {};

        if (system.dns || system.release_channel || system.banner) found.push("system.dns, release_channel and banner");

        const local = system.logging?.local;
        if (local?.lines_per_file !== undefined)
            found.push("system.logging.local.lines_per_file, the platform sizes a log file in megabytes");
        if (local?.files !== undefined && !(Number.isInteger(local.files) && local.files >= 3 && local.files <= 500))
            found.push("system.logging.local.files, between 3 and 500 on the platform");

        for (const collector of system.logging?.remote ?? []) {
            if (Address.family(collector.address) === "ipv6") found.push(`system.logging.remote ${collector.address}, IPv6 is not proved`);
        }

        for (const source of management.snmp?.allow ?? []) {
            if (Address.family(Address.split(source).addr) === "ipv6") found.push(`management.snmp.allow ${source}, IPv6 is not proved`);
        }

        if (system.transceiver_monitoring !== undefined) found.push("system.transceiver_monitoring");

        // SNMP takes sources of its own here, in an ACL of its own.
        found.push(...Derive.switchUnsupported(device).filter((field) => !field.startsWith("management.snmp.allow")));
        found.push(...Derive.unproved(device, ["alarm-severity", "bfd-timers", "static-route-bfd", "mac-limit", "ethertype-filter"]));

        const flow = device.flow_export;
        if (flow && flow.protocol !== "sflow") found.push(`flow_export.protocol ${flow.protocol}, the platform exports sFlow`);
        const sampling = flow?.protocol === "sflow" ? flow.sampling : undefined;
        const samplingInRange = sampling !== undefined && Number.isInteger(sampling) && sampling >= 4096 && sampling <= 4_294_967_295;

        if (flow?.protocol === "sflow" && !samplingInRange) {
            found.push("flow_export.sampling, required and between 4096 and 4294967295: the platform samples, one packet in 4096 at most");
        }

        return found;
    }

    render(device: Device): string {
        return VrpRender.of(device);
    }

    /** What the device runs, credentials scrubbed. */
    async read(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<string> {
        if (options.console) {
            return Vrp.onConsole(device, async (channel) =>
                Vrp.configurationOf(device, await Ssh.send(channel, "display current-configuration", 120_000, 3000))
            );
        }

        const client = await Vrp.login(device);

        try {
            const channel = await Vrp.shell(client);
            const dump = await Ssh.send(channel, "display current-configuration", 120_000, 3000);
            channel.end();

            return Vrp.configurationOf(device, dump);
        } finally {
            client.end();
        }
    }

    /**
     * What changes, in the order the platform accepts.
     *
     * A VLAN list changes by ID. VLANs no longer used go first, with their VLAN interfaces, so their names and numbers are free before a new VLAN takes them: a VLAN name is unique, and a VLAN with an interface cannot be removed. The whole plan is one candidate, so going first leaves nothing half done.
     */
    plan(desired: string, current: string, options: ApplyOptions): Plan {
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
        Vrp.replaceRules(groups, current);
        Vrp.emptyAlarmView(groups, current);
        Vrp.keepReplacedWhole(groups);

        const top = groups.find((group) => group.path.length === 0);
        const removedBatch = top?.remove.find((line) => line.startsWith("vlan batch ")) ?? "";
        const removedIds = removedBatch ? Vrp.batchIds(removedBatch) : [];

        const firstRemovals = [
            ...removedIds.map((id) => `interface Vlanif${id}`).filter((line) => top?.remove.includes(line)),
            ...removedIds.map((id) => `vlan ${id}`).filter((line) => top?.remove.includes(line)),
            ...(removedBatch ? [removedBatch] : []),
        ];

        // An ACL still bound to a service cannot be removed, so ACLs go after every binding has moved.
        const lastRemovals = top?.remove.filter((line) => /^acl number \d+$/.test(line)) ?? [];

        if (top) top.remove = top.remove.filter((line) => !firstRemovals.includes(line) && !lastRemovals.includes(line));

        const planned = LineDiff.steps(
            groups.filter((group) => group.add.length || group.remove.length),
            Vrp.DIALECT
        );

        if (firstRemovals.length) {
            // `undo vlan batch` removes a VLAN's own settings with it, so only the interfaces and the list are sent.
            const sent = firstRemovals.filter((line) => !/^vlan \d+$/.test(line)).map(Vrp.undo);
            planned.unshift({ title: "VLANs no longer used", show: firstRemovals.map((line) => `- ${line}`), send: sent });
        }

        if (lastRemovals.length) {
            planned.push({ title: "ACLs no longer used", show: lastRemovals.map((line) => `- ${line}`), send: lastRemovals.map(Vrp.undo) });
        }

        return { steps: planned, problems: [] };
    }

    async apply(device: Device, _network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void> {
        // On the console, a fresh login on the same console is the proof, and the save is sent in it.
        if (options.console) {
            await Vrp.onConsole(device, async (channel, relogin) => {
                await Vrp.commitPlan(channel, plan);
                await relogin().catch((error: Error) => {
                    throw new Error(`committed, but a fresh login on the console failed: ${error.message}. ${Vrp.NOT_SAVED}`);
                });
                await Vrp.save(channel);
            });

            console.log("  committed, login proved, saved");
            return;
        }

        const client = await Vrp.login(device);
        const channel = await Vrp.shell(client);

        try {
            await Vrp.commitPlan(channel, plan);

            const proof = await Vrp.login(device).catch(() => undefined);
            if (!proof)
                throw new Error(`committed, but a fresh login failed. ${Vrp.NOT_SAVED} Recover over the open session or the console.`);
            proof.end();

            await Vrp.save(channel);
        } finally {
            channel.end();
            client.end();
        }

        console.log("  committed, login proved, saved");
    }

    readOnly(command: string): boolean {
        return Vrp.READS.test(command);
    }

    /** One shell for every command, as the platform takes commands only there. */
    async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        if (options.console) {
            const opened = await Vrp.openConsole(device);
            const shell = new ConsoleShell(opened.channel, Vrp.CONSOLE, ConsoleShell.SETTLE);

            return {
                run: (command, timeout) => shell.run(command, timeout),
                close: () => {
                    shell.logout();
                    opened.close();
                },
            };
        }

        const client = await Vrp.login(device);
        const channel = await Vrp.shell(client).catch((error: Error) => {
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

    private static undo(line: string): string {
        // A negated line is undone by stating it.
        if (line.startsWith("undo ")) return line.slice("undo ".length);
        // An ACL rule is removed by its number.
        if (/^rule \d+/.test(line)) return `undo ${line.split(" ").slice(0, 2).join(" ")}`;

        const keyword = Vrp.UNDO_BY_KEYWORD.exec(line);
        if (keyword) return `undo ${keyword[1]}`;
        // A static route is removed by its destination and next hop; its preference, description or BFD after them is refused.
        if (/^ipv6 route-static |^ip route-static /.test(line)) return `undo ${line.replace(/ (preference|description|bfd) .*$/, "")}`;
        // Storm control is removed per kind, without its rates.
        if (line.startsWith("storm control ")) return `undo ${line.replace(/ (min-rate|max-rate).*$/, "")}`;

        return `undo ${line}`;
    }

    /** Secrets the device prints as ciphers and the render writes as markers compare equal. */
    private static canon(line: string): string {
        return line.replace(/((?:password|community read|-mode \S+) )(?:irreversible-)?cipher \S+/g, "$1cipher <secret>");
    }

    /** Blocks other blocks refer to come first: VRFs, VLANs, the ACL and users, then device-wide lines, then LAGs, ports, VLAN interfaces, OSPF and logins. */
    private static order(path: string[]): number {
        const header = path[0] ?? "";
        if (!header) return 1;

        if (/^(ip vpn-instance|vlan |acl number|aaa|bfd)/.test(header)) return 0;

        if (header.startsWith("interface Eth-Trunk")) return 2;

        if (header.startsWith("interface Vlanif")) return 4;

        if (header.startsWith("interface ")) return 3;

        if (header.startsWith("ospf ")) return 5;

        return 6;
    }

    /**
     * A log host the config no longer has is removed. One at the default level prints as `info-center loghost <address>`, whose head is the bare command, so a new log host would otherwise seem to replace it.
     */
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

    /** An ACL rule sent over a rule of the same number merges into it: `rule 10 deny` over `rule 10 permit source A` leaves `rule 10 deny source A`. A changed rule is undone first. */
    private static replaceRules(groups: Group[], current: string): void {
        const existing = LineDiff.entries(current, Vrp.DIALECT);

        for (const group of groups) {
            if (!group.path[0]?.startsWith("acl number ")) continue;

            for (const line of group.add) {
                const rule = /^rule \d+ /.exec(line)?.[0];
                if (!rule) continue;

                const old = existing.find((entry) => entry.path.join("\n") === group.path.join("\n") && entry.line.startsWith(rule));
                if (old && !group.remove.includes(old.line)) group.remove.push(old.line);
            }
        }
    }

    /** A static route's BFD template sent again replaces the old one whole, options left out included, so the old one is not undone: a route still uses it. */
    private static keepReplacedWhole(groups: Group[]): void {
        const kind = (line: string) => Vrp.REPLACED_WHOLE.exec(line)?.[1];

        for (const group of groups) {
            const added = new Set(group.add.map(kind).filter(Boolean));
            group.remove = group.remove.filter((line) => !added.has(kind(line)));
        }
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
        const { port, user, password } = Secrets.loginOf(device);

        return Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user,
            password,
            hostKeys: Vrp.HOST_KEYS,
        });
    }

    /**
     * An interactive shell at the user prompt, paging off.
     *
     * Every login asks whether to change the password. Answering yes replaces it at once and every stored credential with it, so the answer is always no. Anything sent before the question is answered is taken as the answer.
     */
    private static async shell(client: Client): Promise<ClientChannel> {
        const channel = await Ssh.shell(client);
        const banner = await Ssh.readUntil(
            channel,
            (text) => /Change now\? ?\[Y\/N\]/i.test(text) || /<[^>]+>\s*$/.test(text),
            15_000,
            1500
        );
        if (/Change now\?/i.test(banner)) await Ssh.send(channel, "N", 10_000, 1500);
        await Ssh.send(channel, "screen-length 0 temporary", 10_000, 1500);
        return channel;
    }

    /** Log in on the console with paging off. Returns the console, a way to log in afresh, and how to let the console go. */
    private static async openConsole(device: Device) {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);

        const login = async () => {
            await SerialConsole.login(opened.channel, Vrp.CONSOLE, user, password, console.passwordOnly);
            await Ssh.send(opened.channel, "screen-length 0 temporary", 10_000, 1500);
        };

        try {
            await login();
        } catch (error) {
            opened.close();
            throw error;
        }

        return { channel: opened.channel, login, close: opened.close };
    }

    /** Log in on the console with paging off, run `work` with a way to log in afresh, and log out. */
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
            opened.close();
        }
    }

    /** The configuration in a dump, without the prompt or the stamp of the last change. */
    private static configurationOf(device: Device, dump: string): string {
        const lines = dump.replace(/\r/g, "").split("\n");
        const start = lines.findIndex((line) => line.startsWith("!Software Version"));
        if (start < 0) throw new Error(`${device.name} returned no configuration`);

        const body = lines.slice(start).filter((line) => !/^<.*>$/.test(line.trim()) && !line.startsWith("!Last configuration"));
        return LineDiff.scrub(body.join("\n").trim() + "\n");
    }

    /** Send one line, answering a confirmation, and return what the device said. */
    private static async sendLine(channel: ClientChannel, line: string): Promise<string> {
        const interactive = Vrp.INTERACTIVE.exec(line.trim());
        if (interactive) {
            const [, command, reference] = interactive;
            const password = Secrets.valueOf(reference!);
            let answer = await Ssh.send(channel, command!, 15_000, 900);
            answer += await Ssh.send(channel, password, 15_000, 900);
            answer += await Ssh.send(channel, password, 15_000, 900);
            return answer;
        }

        let answer = await Ssh.send(channel, Secrets.substitute(line), 20_000, 800);
        if (/\[Y\/N\]/i.test(answer)) answer += await Ssh.send(channel, "Y", 20_000, 800);
        return answer;
    }

    /** Send a plan into the candidate and commit it. A refused line clears the candidate, which leaves the device as it was. */
    private static async commitPlan(channel: ClientChannel, plan: Plan): Promise<void> {
        try {
            await Ssh.send(channel, "system-view", 10_000, 1500);

            for (const step of plan.steps) {
                for (const line of step.send) {
                    const answer = await Vrp.sendLine(channel, line);
                    if (Vrp.REFUSED.test(answer))
                        throw new Error(`${step.title}: ${line}\n    device said: ${answer.trim().slice(0, 300)}`);
                }
            }

            const committed = await Ssh.send(channel, "commit", 60_000, 3000);
            if (Vrp.REFUSED.test(committed)) throw new Error(`commit refused: ${committed.trim().slice(0, 300)}`);
            await Ssh.send(channel, "quit", 10_000);
        } catch (error) {
            await Ssh.send(channel, "clear configuration candidate", 10_000).catch(() => undefined);
            throw error;
        }
    }

    /** Save what runs, so a reboot keeps it. */
    private static async save(channel: ClientChannel): Promise<void> {
        const saving = await Ssh.send(channel, "save", 20_000, 2000);
        if (/\[Y\/N\]/i.test(saving)) await Ssh.send(channel, "Y", 60_000, 5000);
    }
}
