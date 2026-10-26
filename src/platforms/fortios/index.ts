// Fortinet FortiOS 6.2, as on the FortiGate 3700D.
//
// The configuration is read and written as `config` blocks, the form `show` prints. A change applies as it is sent. Before a plan is sent the device is set to revert: a change not saved within the rollback time is undone by reloading the saved configuration, and Circuit reloads it at once when a line is refused. A fresh login proves access before the change is saved. Configuration transactions are not used: on 6.2 one keeps references its own deletions dropped, and one whose session is cut off keeps what it touched locked.

import type { Client, ClientChannel } from "ssh2";
import { Address } from "../../core/address";
import type { Neighbor } from "../../core/cabling";
import { Secrets } from "../../core/secrets";
import type { AclRule, Device, Family, FilterRule } from "../../schema";
import { SerialConsole, type ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Catalog } from "../catalog";
import { Derive } from "../derive";
import { type ApplyOptions, type OsSupport, type Plan, type ReadOptions, type ReadSession, Platform } from "../platform";
import { FortiOsFirewall } from "./firewall";
import { FortiOsNames } from "./names";
import { FortiOsPlan } from "./plan";
import { FortiOsRender } from "./render";
import { FortiOsRouting } from "./routing";
import { FortiOsBlock, FortiOsTree } from "./tree";
import { FortiOsVdoms } from "./vdoms";

/** What a session reads and writes: an SSH shell, or anything else that streams the CLI. */
export type Channel = {
    write(data: string): unknown;
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
    on(event: "close", listener: () => void): unknown;
    removeListener(event: "data", listener: (chunk: Buffer) => void): unknown;
    removeListener(event: "close", listener: () => void): unknown;
};

/** How a change that could cut access is guarded: the device reloads its saved configuration after `seconds` unless `prove` shows access survived. */
export type Guard = { seconds: number; prove: () => Promise<void> };

/** A CLI over a channel: one line at a time, and what the device printed until its prompt came back. */
export class FortiOsCli {
    /** The prompt at the end of what the device printed, `host # ` or `host (context) # `, or a question it waits on. */
    private static readonly PROMPT = /(?:^|\n)[^\n]*[#$] $/;
    static readonly QUESTION = /\(y\/n\)\s*$/;

    /** The pre-login banner, which waits for the reader to accept it. */
    static readonly BANNER = /\(Press 'a' to accept\):\s*$/;

    /** The device ended the session and asks for a login again. */
    private static readonly LOGGED_OUT = /(?:^|\n)[^\n]*login: $/;

    /** The pager the device stops at, and how it erases itself once answered. */
    private static readonly PAGER = /--More-- \r? *\r/g;

    /** The prompt that ended the last answer, which shows where the session is: `(port1)` inside an entry. */
    prompt = "";

    constructor(
        private readonly channel: Channel,
        private readonly newline = "\n"
    ) {}

    /** Wait for the prompt, after logging in. */
    async ready(timeout = 30_000): Promise<void> {
        await this.collect(timeout);
    }

    /** Send one line and return what the device printed after it, without the echo or the prompt. */
    async run(line: string, timeout = 60_000): Promise<string> {
        this.channel.write(line + this.newline);
        const output = await this.collect(timeout);

        const lines = output.split("\n");
        return lines.slice(1, -1).join("\n");
    }

    /** Answer a question the device asked. */
    answer(reply: "y" | "n", timeout = 60_000): Promise<string> {
        this.channel.write(reply);
        return this.collect(timeout);
    }

    /** What the device prints until its prompt or a question. A session the device ended, or that went silent, fails. */
    private collect(timeout: number): Promise<string> {
        return new Promise((done, fail) => {
            let raw = "";
            let settle: ReturnType<typeof setTimeout> | undefined;

            const text = () => raw.replace(FortiOsCli.PAGER, "").replace(/\r/g, "");

            const stop = () => {
                clearTimeout(limit);
                clearTimeout(settle);
                this.channel.removeListener("data", onData);
                this.channel.removeListener("close", onClose);
            };

            const finish = () => {
                stop();

                const output = text();
                this.prompt = output.split("\n").at(-1) ?? "";
                done(output);
            };

            const onData = (chunk: Buffer) => {
                raw += chunk.toString("utf8");
                if (raw.endsWith("--More-- ")) this.channel.write(" ");
                if (FortiOsCli.BANNER.test(raw)) this.channel.write("a");

                clearTimeout(settle);

                if (FortiOsCli.LOGGED_OUT.test(text())) {
                    stop();
                    fail(new Error("the device ended the session"));
                } else if (FortiOsCli.PROMPT.test(text()) || FortiOsCli.QUESTION.test(text())) {
                    settle = setTimeout(finish, 300);
                }
            };

            const onClose = () => {
                stop();
                fail(new Error("the device ended the session"));
            };

            const limit = setTimeout(() => {
                stop();
                fail(new Error(`no prompt within ${timeout / 1000} seconds: ${text().slice(-200)}`));
            }, timeout);

            this.channel.on("data", onData);
            this.channel.on("close", onClose);
        });
    }
}

/** A failure after which the device reloads its saved configuration, which still says to revert. */
class Reloaded extends Error {}

export class FortiOs extends Platform {
    /** How the FortiOS console asks for a login, and what moves it on from where the last session left it. */
    static readonly CONSOLE: ConsoleDialect = {
        login: /login: $/,
        password: /Password: $/,
        prompt: /[#$] $/,
        logout: "exit",
        others: [
            [FortiOsCli.BANNER, "a"],
            [/--More-- $/, "q"],
            [/\([^)\n]*\) [#$] $/, "end\n"],
        ],
    };

    /** The release this adapter renders for, and was proved on. */
    private static readonly SUPPORTED = "6.2";

    /** The longest name the platform takes for an interface, and for an address or service. */
    private static readonly NAME_LENGTH = { interface: 15, object: 79 } as const;

    /** Names the platform keeps for interfaces of its own. */
    private static readonly RESERVED_INTERFACES = new Set(["any", "modem", "ssl.root"]);

    /** What the device prints when it refuses a line. */
    private static readonly REFUSED =
        /Command fail\. Return code|Unknown action|parse error|discard the setting|MUST be set|Can not config|isn't supported|(?:^|\n)Invalid /;

    /** How long a device may take to come back from a reload of its configuration, and how often to try it. */
    private static readonly RELOAD = { attempts: 20, interval: 15_000 } as const;

    /** Commands that only read: `show`, `get`, a set of `diagnose` and `execute` commands. `diagnose sys session filter` sets only this session's filter; `diagnose sys session clear`, which ends sessions, is not here. `diagnose lldprx` shows what LLDP received. */
    private static readonly READS =
        /^(?:(?:show|get)\s|diagnose (?:sys session (?:filter|list|stat|full-stat)|sys top|hardware deviceinfo nic|npu np6 (?:dce|synproxy-stats|port-list|sse-stats)|netlink aggregate|debug crashlog read|lldprx (?:neighbor|port) (?:summary|details))\b|execute (?:ping|ping6|traceroute|sensor list)\b)/;

    /** A session filter, which holds only in the shell that set it. */
    private static readonly SESSION_FILTER = /^diagnose sys session filter\b/;

    readonly name = "fortios";

    readonly os: OsSupport = {
        name: "Fortinet FortiOS",
        versions: "6.2",
        provedOn: "FG-3700D, FortiOS 6.2.2",
        checked: true,
    };

    readonly extension = ".conf";

    override readonly console = FortiOs.CONSOLE;

    unsupported(device: Device): string[] {
        const found: string[] = [];

        found.push(...FortiOs.systemGaps(device));
        found.push(...FortiOs.managementGaps(device));
        found.push(...FortiOs.interfaceGaps(device));
        found.push(...FortiOs.staticGaps(device));
        found.push(...FortiOsRouting.gaps(device));
        found.push(...FortiOs.firewallGaps(device));
        found.push(...FortiOs.serviceGaps(device));

        if (device.stp) found.push("stp, ports are routed");
        found.push(...FortiOs.transparentGaps(device));
        found.push(...FortiOsVdoms.gaps(device));

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type === "vlan" && iface.mac) found.push(`interfaces.${name}.mac, which only RouterOS sets for now`);
        }
        if (Object.keys(device.vrfs ?? {}).length > FortiOsRender.VRFS) found.push(`vrfs, at most ${FortiOsRender.VRFS}`);

        for (const [name, vrf] of Object.entries(device.vrfs ?? {})) {
            if (vrf.description) found.push(`vrfs.${name}.description, the platform numbers a VRF and keeps no description`);
        }

        // Proved on a FG-3700D on FortiOS 6.2.2, in NAT mode. BFD on a multihop BGP session is refused in FortiOsRouting.gaps, for the reason the device showed.
        found.push(...Derive.unproved(device, ["bfd-timers", "static-route-bfd", "multihop-bfd"]));

        return found;
    }

    render(device: Device): string {
        return FortiOsRender.of(device);
    }

    read(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<string> {
        return FortiOs.withCli(device, (cli) => FortiOs.readConfig(cli, device), options);
    }

    /** The LLDP neighbors the device received, read with `diagnose lldprx neighbor details`. A port hears LLDP only while it, or the aggregate it is in, has `lldp-reception` on. */
    neighbors(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<Neighbor[]> {
        return FortiOs.withCli(
            device,
            async (cli) => {
                await FortiOs.checkVersion(cli, device);
                const details = await FortiOs.inGlobal(cli, device, () => cli.run("diagnose lldprx neighbor details"));
                return FortiOs.neighborsOf(details, device);
            },
            options
        );
    }

    /**
     * The neighbors in what `diagnose lldprx neighbor details` prints, one `lldprx.neighbor.<n>.<field>: <value>` line per field: `port.txt` is our port, `port.id.data` the far port and `system.name.data` the far device. Our port is given Circuit's name. A neighbor that sent no system name or port is left out.
     */
    static neighborsOf(text: string, device: Device): Neighbor[] {
        const fields = new Map<string, Map<string, string>>();

        for (const [, number, field, value] of text.matchAll(/^lldprx\.neighbor\.(\d+)\.([\w.]+): ?(.*)$/gm)) {
            if (!fields.has(number!)) fields.set(number!, new Map());
            fields.get(number!)!.set(field!, value!.trim());
        }

        const circuitName = new Map(
            Catalog.ports(device.platform, device.model).map((port) => [Catalog.spell(device.platform, device.model, port), port])
        );
        const found: Neighbor[] = [];

        for (const neighbor of fields.values()) {
            const port = neighbor.get("port.txt");
            const system = neighbor.get("system.name.data");
            const remote = neighbor.get("port.id.data");
            if (!port || !system || !remote) continue;

            found.push({ port: circuitName.get(port) ?? port, system, remote_port: remote });
        }

        return found;
    }

    plan(desired: string, current: string, options: ApplyOptions): Plan {
        return FortiOsVdoms.plan(desired, current, (want, have) => FortiOsPlan.of(want, have, options));
    }

    async apply(device: Device, network: readonly Device[], changes: Plan, options: ApplyOptions): Promise<void> {
        await FortiOs.applyOnce(device, changes, options);

        // Switching the operation mode makes changes of its own, such as a static route in each family and memory logging on, which a plan made before it could not see. One more pass, planned against what the device now runs, takes them back.
        const switched = changes.steps.some((step) => step.send.some((line) => line.startsWith("set opmode ")));
        if (!switched) return;

        const again = this.plan(FortiOsRender.of(device), await this.read(device, network, options), options);
        if (!again.steps.length) return;

        console.log("  the operation mode changed; applying what it added on its own");
        await FortiOs.applyOnce(device, again, options);
    }

    /** Replace a prefix list `refresh` fetched. It cannot cut access, so it is sent without a guard, and saved as it goes. `purge` asks to confirm, and is answered yes. */
    async fill(device: Device, _network: readonly Device[], set: string, family: Family, prefixes: string[]): Promise<void> {
        await FortiOs.withCli(device, async (cli) => {
            await FortiOs.checkVersion(cli, device);

            const lines = FortiOs.fillLines(set, family, prefixes);
            for (const line of device.vdoms ? FortiOsVdoms.wrap({ kind: "vdom", vdom: FortiOsVdoms.ROOT }, lines) : lines) {
                let answer = await cli.run(line);
                if (FortiOsCli.QUESTION.test(cli.prompt) && line === "purge") answer = await cli.answer("y");
                if (FortiOs.REFUSED.test(answer)) throw new Error(`${set}: ${line}\n    device said: ${answer.trim().slice(0, 300)}`);
            }

            console.log(`  ${set}: ${prefixes.length} prefixes on the device`);
        });
    }

    readOnly(command: string): boolean {
        return FortiOs.READS.test(command);
    }

    /** Over SSH, each command runs on its own until a session filter is set. The filter holds only in the shell that set it, so it and every command after it run in one shell. */
    async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        if (options.console) {
            const opened = await FortiOs.openConsole(device);

            return {
                run: (command, timeout) => opened.cli.run(command, timeout),
                close: () => void FortiOs.consoleLogout(opened.cli).finally(opened.close),
            };
        }

        const client = await FortiOs.login(device);
        let shell: { channel: ClientChannel; cli: FortiOsCli } | undefined;

        return {
            run: async (command, timeout) => {
                if (!shell && !FortiOs.SESSION_FILTER.test(command)) return Ssh.exec(client, command, timeout);

                if (!shell) {
                    const channel = await Ssh.shell(client, 4000);
                    shell = { channel, cli: new FortiOsCli(channel) };
                    await shell.cli.ready();
                }

                return shell.cli.run(command, timeout);
            },
            close: () => {
                shell?.channel.end();
                client.end();
            },
        };
    }

    /** The lines that replace a prefix list's entries with what a registry returned: every entry is purged, then each prefix added, matching it and anything more specific. */
    static fillLines(set: string, family: Family, prefixes: string[]): string[] {
        const list = new FortiOsBlock();
        prefixes.forEach((prefix, index) => {
            const rule = list.entry(index + 1);
            const network = FortiOsNames.network(prefix);
            rule.set(family === "ipv4" ? "prefix" : "prefix6", family === "ipv4" ? FortiOsNames.subnet(network) : network);
            if (Address.split(network).len < FortiOsRouting.BITS[family]) rule.set("le", FortiOsRouting.BITS[family]);
        });

        return [
            `config ${FortiOsRouting.PREFIX_LIST[family]}`,
            `edit ${FortiOsTree.quote(set)}`,
            "config rule",
            "purge",
            ...FortiOsTree.lines(list).map((line) => line.trim()),
            "end",
            "next",
            "end",
        ];
    }

    /**
     * A line with each secret's value in place, escaped inside its quotes. A certificate's key from a variable is PEM encoded as one line of base64, and is sent as the PEM it holds. A file saved with Windows line endings is sent with plain ones: the CLI takes each carriage return as a line of its own, and refuses the key, `Invalid private key`. A `?`, which the CLI takes as a call for help, is typed literally.
     */
    static withSecrets(line: string): string {
        const key = line.startsWith("set private-key ");

        const filled = line.replace(Secrets.MARKER, (_, reference: string) => {
            const value = Secrets.valueOf(reference);
            const text = key && !value.includes("-----BEGIN") ? Buffer.from(value, "base64").toString("utf8").trim() : value;
            return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        });

        return filled.replace(/\r\n?/g, "\n").replace(/\?/g, "\u0016?");
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

    /** Log out of a console, so no session is left open on it. */
    private static async consoleLogout(cli: FortiOsCli): Promise<void> {
        await FortiOs.leave(cli).catch(() => undefined);
        await cli.run("exit", 10_000).catch(() => undefined);
    }

    /** Log in on the console and open the CLI. Returns the CLI, a way to log in afresh on the same console, and how to let the console go. */
    private static async openConsole(device: Device) {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);
        const login = () => SerialConsole.login(opened.channel, FortiOs.CONSOLE, user, password, console.passwordOnly);

        try {
            await login();
        } catch (error) {
            opened.close();
            throw error;
        }

        return { cli: new FortiOsCli(opened.channel), relogin: login, close: opened.close };
    }

    /** Log in on the console, open the CLI, and run `work` in it. `work` is also given a way to log in afresh on the same console. */
    private static async consoleSession<T>(
        device: Device,
        work: (cli: FortiOsCli, relogin: () => Promise<void>) => Promise<T>
    ): Promise<T> {
        const opened = await FortiOs.openConsole(device);

        try {
            const result = await work(opened.cli, opened.relogin);
            await FortiOs.consoleLogout(opened.cli);
            return result;
        } finally {
            opened.close();
        }
    }

    /** Log in, open the CLI, and run `work` in it: through the console when asked, else over SSH. */
    private static async withCli<T>(device: Device, work: (cli: FortiOsCli) => Promise<T>, options: ReadOptions = {}): Promise<T> {
        if (options.console) return FortiOs.consoleSession(device, (cli) => work(cli));

        const client = await FortiOs.login(device);

        try {
            const channel = await Ssh.shell(client, 4000);
            const cli = new FortiOsCli(channel);
            await cli.ready();

            const result = await work(cli);
            channel.end();
            return result;
        } finally {
            client.end();
        }
    }

    /** Refuse a device on a release this adapter was not proved on, before anything is read or sent. Gives what `get system status` printed. */
    private static async checkVersion(cli: FortiOsCli, device: Device): Promise<string> {
        const status = await cli.run("get system status");
        const version = /^Version: \S+ v(\d+)\.(\d+)\.(\d+)/m.exec(status);

        if (!version) throw new Error(`${device.name} did not say which FortiOS it runs: ${status.slice(0, 200)}`);
        if (`${version[1]}.${version[2]}` !== FortiOs.SUPPORTED) {
            throw new Error(
                `${device.name} runs FortiOS ${version[1]}.${version[2]}.${version[3]}; this adapter renders for FortiOS ${FortiOs.SUPPORTED}`
            );
        }

        return status;
    }

    /** Run `work` among the device's own settings: inside `config global` on a device with VDOMs, as it is on one without. */
    private static async inGlobal<T>(cli: FortiOsCli, device: Device | boolean, work: () => Promise<T>): Promise<T> {
        const multi = typeof device === "boolean" ? device : Boolean(device.vdoms);
        if (!multi) return work();

        await cli.run("config global");
        try {
            return await work();
        } finally {
            await FortiOs.leave(cli);
        }
    }

    /** Secrets the device prints: a password or an SNMPv3 key as a cipher, a certificate's key encrypted, and the SNMP community in clear. None leave the read. */
    private static scrub(text: string): string {
        const root = FortiOsTree.parse(text);

        for (const { block } of root.blocks.get("system snmp community")?.entries.values() ?? []) {
            if (block.settings.has("name")) block.settings.set("name", '"<redacted>"');
        }

        const hide = (block: FortiOsBlock) => {
            for (const [key, value] of block.settings) {
                if (value.startsWith("ENC ")) block.settings.set(key, "ENC <redacted>");
                if (key === "private-key") block.settings.set(key, '"<redacted>"');
            }

            for (const child of block.blocks.values()) hide(child);
            for (const entry of block.entries.values()) hide(entry.block);
        };
        hide(root);

        return FortiOsTree.print(root);
    }

    /** Every section Circuit manages, as the device holds it, credentials scrubbed. */
    private static async readConfig(cli: FortiOsCli, device: Device): Promise<string> {
        const status = await FortiOs.checkVersion(cli, device);
        const show = (section: string) =>
            cli.run(`${FortiOsRender.FULL.includes(section) ? "show full-configuration" : "show"} ${section}`, 120_000);
        const parts: string[] = [];

        if (/^Virtual domain configuration: (multiple|split-task)/m.test(status)) {
            parts.push(...(await FortiOs.readVdoms(cli, device, show)));
        } else {
            for (const section of FortiOsRender.SECTIONS) parts.push(await show(section));
        }

        const text = parts.join("\n");
        if (!/^config system global$/m.test(text)) throw new Error(`${device.name} returned no configuration`);

        return FortiOs.scrub(FortiOsPlan.clean(text));
    }

    /**
     * A device in multi-VDOM mode, read where each section lives: the device's own under `config global`, the rest in `root`, and a management VDOM's sections named as the render names them. A VDOM that does not exist yet is not entered, since `edit` would make it.
     */
    private static async readVdoms(cli: FortiOsCli, device: Device, show: (section: string) => Promise<string>): Promise<string[]> {
        const management = FortiOsVdoms.managementOf(device);
        if (!management) throw new Error(`${device.name} runs several VDOMs and its config has no vdoms; write vdoms.management`);

        const parts: string[] = [];
        const inVdom = async (vdom: string, sections: readonly string[]) => {
            await cli.run("config vdom");
            await cli.run(`edit ${vdom}`);
            try {
                for (const section of sections) {
                    const text = await show(section);
                    parts.push(vdom === FortiOsVdoms.ROOT ? text : FortiOsVdoms.named(vdom, text));
                }
            } finally {
                await FortiOs.leave(cli);
            }
        };

        const listed = await FortiOs.inGlobal(cli, true, async () => {
            for (const section of FortiOsRender.SECTIONS.filter((one) => FortiOsVdoms.GLOBAL.has(one))) parts.push(await show(section));
            return FortiOsVdoms.listed(await cli.run("diagnose sys vd list"));
        });

        await inVdom(
            FortiOsVdoms.ROOT,
            FortiOsRender.SECTIONS.filter((one) => !FortiOsVdoms.GLOBAL.has(one))
        );
        if (listed.includes(management)) await inVdom(management, FortiOsVdoms.MANAGEMENT_SECTIONS);

        return parts;
    }

    /** Leave every `config` and `edit` level, back to the top prompt. */
    private static async leave(cli: FortiOsCli): Promise<void> {
        for (let level = 0; level < 10 && /\(.*\) [#$] $/.test(cli.prompt); level++) await cli.run("end");
    }

    /** Send the lines that set how the device saves changes. */
    private static async saving(cli: FortiOsCli, mode: "revert" | "automatic", multi: boolean, seconds?: number): Promise<void> {
        const lines = ["config system global", `set cfg-save ${mode}`, ...(seconds ? [`set cfg-revert-timeout ${seconds}`] : []), "end"];

        for (const line of multi ? FortiOsVdoms.wrap({ kind: "global" }, lines) : lines) {
            const answer = await cli.run(line);
            if (FortiOs.REFUSED.test(answer)) throw new Error(`the device refused ${line}: ${answer.trim().slice(0, 300)}`);
        }
    }

    /**
     * Send a plan line by line, each applied as it arrives. The device is first set to revert what is not saved, so a refused line or a fresh login that fails reloads its saved configuration. Once access is proved the change is saved, and changes save themselves again.
     */
    private static async configure(cli: FortiOsCli, plan: Plan, guard: Guard, multi: boolean): Promise<void> {
        const minutes = guard.seconds / 60;
        await FortiOs.saving(cli, "revert", multi, guard.seconds);

        // The session still open reloads the saved configuration at once; if it cannot, the device does when the time runs out.
        const restore = async (reason: string) => {
            await FortiOs.leave(cli).catch(() => undefined);
            await FortiOs.inGlobal(cli, multi, () => cli.run("execute cfg reload")).catch(() => undefined);
            return new Reloaded(
                `${reason}\n    the device reloads its saved configuration, which undoes what was sent, at the latest in ${minutes} minutes`
            );
        };

        for (const step of plan.steps) {
            for (const line of step.send) {
                const answer = await cli.run(FortiOs.withSecrets(line)).catch((error: Error) => error);
                if (answer instanceof Error) throw await restore(`${step.title}: ${line}\n    ${answer.message}`);
                if (/System will reload/.test(answer)) {
                    throw new Reloaded(
                        `${step.title}: ${line}\n    the rollback time ran out while the plan was sent, and the device is reloading its saved configuration`
                    );
                }

                if (FortiOs.REFUSED.test(answer))
                    throw await restore(`${step.title}: ${line}\n    device said: ${answer.trim().slice(0, 300)}`);

                // No line of a plan should ask; one that does is answered no and treated as refused.
                if (FortiOsCli.QUESTION.test(cli.prompt)) {
                    await cli.answer("n").catch(() => undefined);
                    throw await restore(`${step.title}: ${line}\n    device asked: ${cli.prompt.trim()}`);
                }
            }
        }

        console.log(`  sent; the device reloads its saved configuration in ${minutes} minutes unless access is proved`);

        try {
            await guard.prove();
        } catch (error) {
            throw await restore(`a fresh login failed: ${(error as Error).message}`);
        }

        const saved = await FortiOs.inGlobal(cli, multi, () => cli.run("execute cfg save", 120_000));
        if (!/config saved|no config to be saved/.test(saved)) {
            throw new Error(
                `access was proved but the save failed; the device reverts in ${minutes} minutes:\n    ${saved.trim().slice(0, 300)}`
            );
        }

        await FortiOs.saving(cli, "automatic", multi);
        console.log("  logged in again, saved");
    }

    /**
     * Once the device is back from a reload, set it to save changes on its own again: the saved configuration still says to revert. Setting it saves what runs, so it is set only once the device says nothing is left to reload; until then the reload is asked for again.
     */
    private static async settle(device: Device, options: ReadOptions): Promise<string> {
        for (let attempt = 0; attempt < FortiOs.RELOAD.attempts; attempt++) {
            await new Promise((done) => setTimeout(done, FortiOs.RELOAD.interval));

            const settled = await FortiOs.withCli(
                device,
                async (cli) => {
                    const reloaded = await FortiOs.inGlobal(cli, device, () => cli.run("execute cfg reload"));
                    if (!/no config to be reloaded/.test(reloaded)) return false;
                    await FortiOs.saving(cli, "automatic", Boolean(device.vdoms));
                    return true;
                },
                options
            ).catch(() => false);
            if (settled) return "the device is back and saves changes on its own again";
        }

        return "the device did not come back in time and still reverts every change; set `cfg-save automatic` under `config system global` (in `config global` on a device with VDOMs)";
    }

    private static async applyOnce(device: Device, plan: Plan, options: ApplyOptions): Promise<void> {
        const seconds = options.rollback * 60;

        try {
            // Through the console, a fresh login on the same console proves the change left the device's logins working; over SSH, a fresh SSH session proves the management path too.
            if (options.console) {
                await FortiOs.consoleSession(device, async (cli, relogin) => {
                    await FortiOs.checkVersion(cli, device);
                    await FortiOs.configure(cli, plan, { seconds, prove: relogin }, Boolean(device.vdoms));
                });
                return;
            }

            await FortiOs.withCli(device, async (cli) => {
                await FortiOs.checkVersion(cli, device);

                await FortiOs.configure(
                    cli,
                    plan,
                    {
                        seconds,
                        prove: async () => {
                            const proof = await FortiOs.login(device);
                            proof.end();
                        },
                    },
                    Boolean(device.vdoms)
                );
            });
        } catch (error) {
            if (!(error instanceof Reloaded)) throw error;
            throw new Error(`${error.message}\n    ${await FortiOs.settle(device, options)}`);
        }
    }

    /**
     * What transparent mode, which a bridge needs, leaves out: every address but one IPv4 management address outside the bridges, routing beyond static routes for it, NAT and DHCP. Without a management address the device is reached through its console and answers no service.
     */
    private static transparentGaps(device: Device): string[] {
        if (!FortiOsNames.isTransparent(device)) return [];

        const found: string[] = [];
        const where = "in transparent mode, which a bridge needs";
        const management = FortiOsNames.transparentManagement(device);

        if (device.connection.host && device.connection.host !== (management && Address.host(management.address)))
            found.push(`connection.host, ${where}: only the management address, one IPv4 address outside the bridges`);

        const holders = [
            ...Object.entries(device.ports ?? {}).map(([name, port]) => [`ports.${name}`, name, port?.addresses] as const),
            ...Object.entries(device.interfaces ?? {}).map(([name, iface]) => [`interfaces.${name}`, name, iface.addresses] as const),
        ];

        for (const [path, name, addresses] of holders) {
            const extra = (addresses ?? []).filter(
                (entry) => !(typeof entry === "string" && management && name === management.name && entry === management.address)
            );
            if (extra.length) found.push(`${path}.addresses, ${where}: one IPv4 address in all, outside the bridges, for management`);
        }

        const routing = device.routing;
        if (routing?.bgp || routing?.ospf) found.push(`routing, ${where}: static routes only`);
        if (routing?.bfd) found.push(`routing.bfd, ${where}: BFD is proved in NAT mode only`);

        for (const [index, route] of (routing?.static ?? []).entries()) {
            const at = `routing.static[${index}]`;
            if (!management) found.push(`${at}, ${where}: a route needs the management address`);
            if (!route.via || Address.family(route.via) !== "ipv4" || route.interface || route.blackhole || route.vrf)
                found.push(`${at}, ${where}: only an IPv4 next hop, for the management address`);
            if (route.bfd) found.push(`${at}.bfd, ${where}: BFD is proved in NAT mode only`);
        }

        if (device.firewall?.nat) found.push(`firewall.nat, ${where}`);
        if (device.dhcp && Object.keys(device.dhcp).length) found.push(`dhcp, ${where}`);

        if (!management) {
            const services = device.management ?? {};
            for (const service of ["ssh", "telnet", "http", "https", "api", "api_tls", "snmp", "native"] as const) {
                if (services[service]) found.push(`management.${service}, ${where}: the device has no management address to answer on`);
            }
        }

        return found;
    }

    private static systemGaps(device: Device): string[] {
        const found: string[] = [];
        const system = device.system ?? {};

        if (system.timezone && !FortiOsRender.zoneOf(system.timezone))
            found.push(`system.timezone ${system.timezone}, the platform has no zone for it`);
        if (system.release_channel) found.push("system.release_channel, the platform's firmware has no release channel to follow");
        if (system.transceiver_monitoring !== undefined)
            found.push("system.transceiver_monitoring, the platform reads optics without being told");
        if (system.ip?.syn_cookies) found.push("system.ip.syn_cookies, the platform has a SYN proxy per DoS policy, not SYN cookies");

        const local = system.logging?.local;
        if (local?.files !== undefined || local?.lines_per_file !== undefined) {
            found.push("system.logging.local.files and lines_per_file, logs kept in memory do not rotate into files");
        }

        if ((system.logging?.remote?.length ?? 0) > FortiOsRender.COLLECTORS)
            found.push(`system.logging.remote, at most ${FortiOsRender.COLLECTORS} collectors`);

        const servers = system.dns?.servers ?? [];
        for (const family of ["ipv4", "ipv6"] as const) {
            if (servers.filter((server) => Address.family(server) === family).length > FortiOsRender.RESOLVERS.device) {
                found.push(`system.dns.servers, at most ${FortiOsRender.RESOLVERS.device} of each family`);
            }
        }

        return found;
    }

    private static managementGaps(device: Device): string[] {
        const found: string[] = [];
        const management = device.management ?? {};

        if (management.api || management.api_tls) found.push("management.api and api_tls, the API is served by management.https");
        if (management.ftp) found.push("management.ftp, the platform has no FTP service");
        if (management.console) found.push("management.console, the console logs in with the device's users");
        if (management.privilege_password) found.push("management.privilege_password, the platform has no privileged mode");
        if (management.native?.interfaces?.length) found.push("management.native.interfaces, FortiManager access runs over IP only");
        if (management.native?.port) found.push("management.native.port, FortiManager access listens on 541");
        if (management.ssh?.auth_retries)
            found.push("management.ssh.auth_retries, the platform counts failed logins per source, not per connection");

        for (const [name, user] of Object.entries(management.snmp?.users ?? {})) {
            if (user.auth === "sha256")
                found.push(`management.snmp.users.${name}.auth sha256, the platform authenticates with SHA1 or MD5`);
        }

        for (const [name, user] of Object.entries(device.users ?? {})) {
            if ((user.ssh_keys?.length ?? 0) > FortiOsRender.SSH_KEYS)
                found.push(`users.${name}.ssh_keys, at most ${FortiOsRender.SSH_KEYS}`);
        }

        return found;
    }

    /** Every name the platform knows a port by. */
    private static portNames(device: Device): Set<string> {
        return new Set(Catalog.ports(device.platform, device.model).map((port) => Catalog.spell(device.platform, device.model, port)));
    }

    private static interfaceGaps(device: Device): string[] {
        const found: string[] = [];
        const vlanInterfaces = new Set(
            Object.values(device.interfaces ?? {}).flatMap((iface) => (iface.type === "vlan" ? [iface.vlan as string] : []))
        );

        for (const [name, vlan] of Object.entries(device.vlans ?? {})) {
            if (vlan.description) found.push(`vlans.${name}.description, a VLAN interface holds its own`);
        }

        for (const [name, port] of Object.entries(device.ports ?? {})) {
            if (!port) continue;

            const where = `ports.${name}`;
            const speedClass = name.split("-")[0]!;
            if (port.speed && !FortiOsRender.SPEEDS[speedClass]?.[port.speed])
                found.push(`${where}.speed ${port.speed}, not in a ${speedClass} cage`);

            for (const field of ["access_vlan", "native_vlan", "stp", "storm_control"] as const) {
                if (port[field] !== undefined) found.push(`${where}.${field}, ports are routed`);
            }

            if (port.hardware_offload !== undefined)
                found.push(`${where}.hardware_offload, offload is decided per policy, which can match many interfaces`);

            if (port.lag) {
                for (const field of ["addresses", "mtu", "vrrp", "vrf", "lldp", "trunk_vlans", "ipv6_ra", "acl"] as const) {
                    if (port[field] !== undefined) found.push(`${where}.${field}, a LAG member takes its settings from the LAG`);
                }
            }

            const acl = port.acl ? device.acls?.[port.acl] : undefined;
            if (acl) found.push(...FortiOs.aclGaps(`acls.${port.acl}`, acl));

            found.push(...FortiOs.trunkGaps(where, name, port.trunk_vlans, vlanInterfaces, device));
            found.push(...FortiOs.routedGaps(where, port, false));
        }

        const ports = FortiOs.portNames(device);

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            const where = `interfaces.${name}`;

            if (iface.type === "wireguard") {
                found.push(`${where}, a wireguard: the platform has no WireGuard`);
                continue;
            }

            if (name.length > FortiOs.NAME_LENGTH.interface)
                found.push(`${where}, a name longer than ${FortiOs.NAME_LENGTH.interface} characters`);
            if (ports.has(name) || FortiOs.RESERVED_INTERFACES.has(name))
                found.push(`${where}, a name the platform gives a port of its own`);
            if (iface.hardware_offload !== undefined)
                found.push(`${where}.hardware_offload, offload is decided per policy, which can match many interfaces`);

            if (iface.type === "lag") {
                if (iface.id !== undefined) found.push(`${where}.id, the platform names a LAG by its key`);
                for (const field of ["access_vlan", "native_vlan", "stp", "storm_control"] as const) {
                    if (iface[field] !== undefined) found.push(`${where}.${field}, LAGs are routed`);
                }

                found.push(...FortiOs.trunkGaps(where, name, iface.trunk_vlans, vlanInterfaces, device));
            }

            if (iface.type === "vlan" && !FortiOsRender.vlanParent(device, iface.vlan)) {
                found.push(`${where}, VLAN ${iface.vlan} must be carried tagged by exactly one port or LAG`);
            }

            if (iface.type === "loopback") {
                if (iface.mtu !== undefined) found.push(`${where}.mtu, a loopback has no MTU of its own`);
                if (iface.vrrp?.length) found.push(`${where}.vrrp, a loopback runs no VRRP`);
            }

            if (iface.type === "gre" || iface.type === "vxlan") {
                if (!FortiOsNames.holderOf(device, iface.local)) found.push(`${where}.local, no interface holds ${iface.local}`);
                if (Address.family(iface.local) !== Address.family(iface.remote)) found.push(`${where}, endpoints of two families`);
                if (iface.vrrp?.length) found.push(`${where}.vrrp, on a tunnel`);
                if (iface.ipv6_ra) found.push(`${where}.ipv6_ra, on a tunnel`);
            }

            if (iface.type === "gre") {
                for (const entry of iface.addresses ?? []) {
                    if (typeof entry !== "string" && Address.family(Address.host(entry.address)) === "ipv6")
                        found.push(`${where}.addresses, a peer on an IPv6 address`);
                }

                const ipv4 = (iface.addresses ?? []).filter(
                    (entry) => Address.family(Address.host(typeof entry === "string" ? entry : entry.address)) === "ipv4"
                );
                if (ipv4.some((entry) => typeof entry === "string"))
                    found.push(`${where}.addresses, an IPv4 address on a tunnel takes its peer`);
                if (ipv4.length > 1) found.push(`${where}.addresses, one IPv4 address`);
            }

            found.push(...FortiOs.routedGaps(where, iface, iface.type === "gre"));
        }

        // LLDP runs on ports and aggregates; a VLAN interface has no LLDP settings.
        if (device.lldp && typeof device.lldp === "object") {
            for (const name of device.lldp.interfaces) {
                const settings = device.interfaces?.[name];
                if (settings && settings.type !== "lag") found.push(`lldp.interfaces ${name}, a ${settings.type}`);
            }
        }

        return found;
    }

    /** A port or LAG carries tagged only VLANs that have an interface here, and is the only one carrying each. */
    private static trunkGaps(
        where: string,
        name: string,
        vlans: readonly string[] | undefined,
        withInterface: Set<string>,
        device: Device
    ): string[] {
        const found: string[] = [];

        for (const vlan of vlans ?? []) {
            if (!withInterface.has(vlan)) {
                found.push(`${where}.trunk_vlans ${vlan}, a VLAN with no interface here: the platform routes and does not switch`);
            } else if (FortiOsRender.vlanParent(device, vlan) !== name) {
                found.push(`${where}.trunk_vlans ${vlan}, which another port or LAG also carries`);
            }
        }

        return found;
    }

    /** Layer 3 settings the platform cannot express on a port or an interface. Only a tunnel takes an address with a peer. */
    private static routedGaps(
        where: string,
        settings: {
            addresses?: readonly (string | { address: string; peer: string })[];
            vrrp?: readonly { id: number; address: string }[];
        },
        tunnel: boolean
    ): string[] {
        const found: string[] = [];

        if (!tunnel && settings.addresses?.some((entry) => typeof entry !== "string"))
            found.push(`${where}.addresses with a peer, which only a tunnel takes`);

        for (const group of settings.vrrp ?? []) {
            if (Address.family(group.address) === "ipv6") found.push(`${where}.vrrp ${group.id}, IPv6: the platform runs VRRP for IPv4`);
        }

        return found;
    }

    /** An ACL as the platform's, which only drop: every drop comes before any accept, and no rule limits a rate or matches a VLAN. */
    private static aclGaps(where: string, rules: readonly AclRule<string>[]): string[] {
        const found: string[] = [];

        if (FortiOsFirewall.acceptsBeforeDrop(rules)) found.push(`${where}, an accept before a drop: the platform's ACLs only drop`);

        rules.forEach((rule, index) => {
            if (rule.rate) found.push(`${where}[${index}].rate`);
            if (rule.match?.vlan) found.push(`${where}[${index}].match.vlan, a port's ACL sees no VLAN`);
        });

        return found;
    }

    private static staticGaps(device: Device): string[] {
        const found: string[] = [];
        const seen = new Set<string>();

        for (const route of device.routing?.static ?? []) {
            const where = `routing.static ${route.prefix}`;

            if (route.vrf && route.bfd) found.push(`${where}.bfd, BFD in a VRF is not proved on a device yet`);
            if (route.vrf && route.blackhole)
                found.push(`${where}, a blackhole in a VRF: a route takes the VRF of the interface it leaves through`);
            if (route.vrf && route.interface && FortiOsNames.settingsOf(device, route.interface)?.vrf !== route.vrf) {
                found.push(`${where}.interface, which is not in VRF ${route.vrf}`);
            }

            if (route.via && !route.interface && !route.blackhole && !FortiOsNames.interfaceFor(device, route.via, route.vrf)) {
                found.push(`${where} via ${route.via}, no interface's own network in its table holds the next hop`);
            }

            // The device refuses a second route identical to one it has: `Duplicated entry`.
            const key = [
                Address.split(route.prefix).addr,
                Address.split(route.prefix).len,
                route.via,
                route.interface,
                route.blackhole,
                route.distance,
                route.vrf,
            ].join(" ");
            if (seen.has(key)) found.push(`${where}, the same route twice`);
            seen.add(key);
        }

        return found;
    }

    private static firewallGaps(device: Device): string[] {
        const found: string[] = [];
        const fw = device.firewall;
        if (!fw) return found;

        if (fw.filter?.output) found.push("firewall.filter.output, the platform filters no traffic it sends itself");
        if (fw.untracked) found.push("firewall.untracked, every session is tracked");

        for (const helper of fw.helpers ?? []) {
            if (!FortiOsRender.HELPERS[helper]) found.push(`firewall.helpers ${helper}, the platform has no helper for it`);
        }

        for (const chain of ["forward", "input"] as const) {
            (fw.filter?.[chain]?.rules ?? []).forEach((rule, index) =>
                found.push(...FortiOs.ruleGaps(`firewall.filter.${chain}[${index}]`, rule, chain, device))
            );
        }

        (fw.nat?.source ?? []).forEach((rule, index) => {
            const where = `firewall.nat.source[${index}]`;
            const match = rule.match;

            if (FortiOsFirewall.familiesOf(device, match).includes("ipv6") && (match?.family === "ipv6" || match?.src || match?.dst)) {
                found.push(`${where}, IPv6: central NAT translates IPv4`);
            }

            if (rule.action === "dnat") found.push(`${where}.action dnat, in source NAT`);
            if (rule.action === "snat" && Address.family(rule.to) === "ipv6") found.push(`${where}.to, IPv6: central NAT translates IPv4`);
            if (match?.dst_port !== undefined) found.push(`${where}.match.dst_port, central NAT matches the source port only`);
            if (Array.isArray(match?.src_port)) found.push(`${where}.match.src_port, one port or range`);
            if (rule.action === "snat" && rule.to_port !== undefined && match?.src_port === undefined)
                found.push(`${where}.to_port, without match.src_port`);
            if ((match?.src && match.src_set) || (match?.dst && match.dst_set))
                found.push(`${where}.match, a prefix and a set on one side`);
            if (match?.state || match?.tcp_flags) found.push(`${where}.match.state and tcp_flags`);
        });

        (fw.nat?.destination ?? []).forEach((rule, index) => {
            const where = `firewall.nat.destination[${index}]`;
            const match = rule.match;

            if (rule.action !== "dnat") {
                found.push(`${where}.action ${rule.action}, in destination NAT`);
                return;
            }

            if (!match?.dst || Address.split(match.dst.includes("/") ? match.dst : `${match.dst}/32`).len !== 32) {
                found.push(`${where}.match.dst, one IPv4 address the virtual IP answers on`);
            }

            const sources = match?.src ? [match.src] : match?.src_set ? (fw.address_sets?.[match.src_set] ?? []) : [];
            if (Address.family(rule.to) === "ipv6" || sources.some((source) => Address.family(Address.host(source)) === "ipv6"))
                found.push(`${where}, IPv6`);
            if (match?.dst_port !== undefined && Array.isArray(match.dst_port)) found.push(`${where}.match.dst_port, one port or range`);
            if (match?.dst_port !== undefined && match.protocol !== "tcp" && match.protocol !== "udp") {
                found.push(`${where}.match.protocol, tcp or udp with a port`);
            }

            if (match?.dst_port === undefined && (match?.protocol || rule.to_port)) {
                found.push(`${where}.match.dst_port, a protocol or port is forwarded by its port`);
            }

            if (match?.src && match.src_set) found.push(`${where}.match, a prefix and a set on one side`);

            for (const field of ["dst_set", "src_port", "out_interface", "state", "tcp_flags", "family"] as const) {
                if (match?.[field] !== undefined) found.push(`${where}.match.${field}`);
            }
        });

        for (const name of Object.keys(fw.address_sets ?? {})) {
            if (name.length > FortiOs.NAME_LENGTH.object)
                found.push(`firewall.address_sets.${name}, a name longer than ${FortiOs.NAME_LENGTH.object} characters`);
            if (name.startsWith("circuit-"))
                found.push(`firewall.address_sets.${name}, a name Circuit keeps for the sources of management`);
        }

        return found;
    }

    /** A filter rule the platform cannot express. */
    private static ruleGaps(where: string, rule: FilterRule<string, string>, chain: "forward" | "input", device: Device): string[] {
        const found: string[] = [];
        const match = rule.match;
        const state = match?.state ?? [];

        // The platform is stateful: replies pass on their own, and a rule matches a session's first packet.
        if (state.some((one) => one === "invalid" || one === "untracked")) found.push(`${where}.match.state ${state.join(", ")}`);
        else if (state.length && rule.action !== "accept") found.push(`${where}.match.state, on a rule that does not accept`);

        if (match?.tcp_flags) found.push(`${where}.match.tcp_flags, the platform matches no TCP flags`);
        if ((match?.src && match.src_set) || (match?.dst && match.dst_set)) found.push(`${where}.match, a prefix and a set on one side`);
        if (FortiOsFirewall.isImplied(rule)) return found;

        const families = FortiOsFirewall.familiesOf(device, match);
        if (!families.length) found.push(`${where}, its addresses share no family`);

        if (match?.src && match.dst && Address.family(Address.host(match.src)) !== Address.family(Address.host(match.dst))) {
            found.push(`${where}, a source and destination of two families`);
        }

        for (const family of families) {
            if (FortiOsFirewall.serviceOf(match, family).name.length > FortiOs.NAME_LENGTH.object)
                found.push(`${where}.match ports, too many for one service`);
        }

        if (chain === "input") {
            if (match?.out_interface) found.push(`${where}.match.out_interface, on traffic to the device`);
            if (rule.action === "reject") found.push(`${where}.action reject, the platform drops traffic to itself silently`);
            if (rule.offload) found.push(`${where}.offload, on traffic to the device`);
        }

        return found;
    }

    private static serviceGaps(device: Device): string[] {
        const found: string[] = [];

        for (const [name, server] of Object.entries(device.dhcp ?? {})) {
            if (Address.family(Address.host(server.network)) === "ipv6")
                found.push(`dhcp.${name}.network, IPv6: DHCPv6 hands out no gateway`);
            if ((server.dns?.length ?? 0) > FortiOsRender.RESOLVERS.dhcp)
                found.push(`dhcp.${name}.dns, at most ${FortiOsRender.RESOLVERS.dhcp}`);
        }

        const flow = device.flow_export;
        if (flow?.protocol === "ipfix") found.push("flow_export.protocol ipfix, the platform exports sFlow and NetFlow 9");
        if (flow && flow.collectors.length > 1) found.push("flow_export.collectors, one collector");
        for (const name of flow?.interfaces ?? []) {
            const type = device.interfaces?.[name]?.type;
            if (type === "gre" || type === "vxlan")
                found.push(`flow_export.interfaces ${name}, a tunnel: the platform samples the interface it leaves through`);
        }
        if (flow?.protocol === "netflow-v9" && flow.sampling !== undefined)
            found.push("flow_export.sampling, NetFlow here exports every flow");
        if (flow?.protocol === "sflow" && (flow.sampling === undefined || flow.sampling < 10 || flow.sampling > 99999)) {
            found.push("flow_export.sampling, required and from 10 to 99999: the platform samples");
        }

        return found;
    }
}
