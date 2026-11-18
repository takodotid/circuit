// Fortinet FortiOS 6.2, as on the FortiGate 3700D.
//
// The configuration is read and written as `config` blocks, the form `show` prints. A change applies as it is sent. Before a plan is sent the device is set to revert: a change not saved within the rollback time is undone by reloading the saved configuration, and Circuit reloads it at once when a line is refused. A fresh login tests access before the change is saved. Configuration transactions are not used: on 6.2 one keeps references its own deletions dropped, and one whose session is cut off keeps what it touched locked.

import type { Client, ClientChannel } from "ssh2";
import { Address } from "../../core/address";
import type { Neighbor } from "../../core/cabling";
import { Secrets } from "../../core/secrets";
import type { Device, Family, Finding } from "../../model";
import { SerialConsole, type ConsoleDialect } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { Catalog } from "../../core/catalog";
import { type ApplyOptions, type OsSupport, type Plan, type ReadOptions, type ReadSession, Platform } from "../platform";
import { FortiOsCli, type Guard } from "./cli";
import { FortiOsNames } from "./names";
import { FortiOsPlan } from "./plan";
import { FortiOsRender } from "./render";
import { FortiOsRouting } from "./routing";
import { FortiOsBlock, FortiOsTree } from "./tree";
import { FortiOsUnsupported } from "./unsupported";
import { FortiOsVdoms } from "./vdoms";

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

    /** The release this adapter renders for, and was tested on. */
    private static readonly SUPPORTED = "6.2";

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
        testedOn: "FG-3700D, FortiOS 6.2.2",
        checked: true,
    };

    readonly extension = ".conf";

    override readonly console = FortiOs.CONSOLE;

    /** A management VDOM that cannot work: named `root`, listing a LAG's port instead of the LAG, or with a route that leaves through an interface outside it or goes nowhere. */
    checks(device: Device): Finding[] {
        return FortiOsVdoms.problems(device).map((message) => ({ level: "error", device: device.name, message }));
    }

    unsupported(device: Device): string[] {
        return FortiOsUnsupported.of(device);
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
            for (const line of device.system?.vdoms ? FortiOsVdoms.wrap({ kind: "vdom", vdom: FortiOsVdoms.ROOT }, lines) : lines) {
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
        const { port, user, password, keys } = Secrets.loginOf(device);

        return Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user,
            password,
            keys,
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
        const login = () => SerialConsole.login(opened.channel, FortiOs.CONSOLE, user, password, console.password_only);

        try {
            await login();
        } catch (error) {
            void opened.close();
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
            void opened.close();
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

    /** Refuse a device on a release this adapter was not tested on, before anything is read or sent. Gives what `get system status` printed. */
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
        const multi = typeof device === "boolean" ? device : Boolean(device.system?.vdoms);
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
            for (const section of [...FortiOsRender.SECTIONS, ...FortiOsRender.OPTIONAL_SECTIONS]) parts.push(await show(section));
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
        if (!management) throw new Error(`${device.name} runs several VDOMs and its config has no vdoms; write system.vdoms.management`);

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

        await inVdom(FortiOsVdoms.ROOT, [
            ...FortiOsRender.SECTIONS.filter((one) => !FortiOsVdoms.GLOBAL.has(one)),
            ...FortiOsRender.OPTIONAL_SECTIONS,
        ]);
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
     * Send a plan line by line, each applied as it arrives. The device is first set to revert what is not saved, so a refused line or a fresh login that fails reloads its saved configuration. Once access is tested, the change is saved, and changes save themselves again.
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

        console.log(`  sent; the device reloads its saved configuration in ${minutes} minutes unless Circuit logs in again`);

        try {
            await guard.prove();
        } catch (error) {
            throw await restore(`a fresh login failed: ${(error as Error).message}`);
        }

        const saved = await FortiOs.inGlobal(cli, multi, () => cli.run("execute cfg save", 120_000));
        if (!/config saved|no config to be saved/.test(saved)) {
            throw new Error(
                `Circuit logged in again, but the save failed; the device reverts in ${minutes} minutes:\n    ${saved.trim().slice(0, 300)}`
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
                    await FortiOs.saving(cli, "automatic", Boolean(device.system?.vdoms));
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
            // Through the console, a fresh login on the same console tests that the change left the device's logins working; over SSH, a fresh SSH session tests the management path too.
            if (options.console) {
                await FortiOs.consoleSession(device, async (cli, relogin) => {
                    await FortiOs.checkVersion(cli, device);
                    await FortiOs.configure(cli, plan, { seconds, prove: relogin }, Boolean(device.system?.vdoms));
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
                    Boolean(device.system?.vdoms)
                );
            });
        } catch (error) {
            if (!(error instanceof Reloaded)) throw error;
            throw new Error(`${error.message}\n    ${await FortiOs.settle(device, options)}`, { cause: error });
        }
    }
}
