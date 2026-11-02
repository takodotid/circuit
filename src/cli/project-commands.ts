// The commands that read a project: `validate`, `diff` and `apply`, and the utilities that reach a device, `exec`, `bgp` and `access-console`. Each reads the project in the folder `--project` names, or in the working directory or the nearest folder above it that holds `circuit.ts`.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Validation } from "../checks";
import { Cabling } from "../core/cabling";
import { Secrets } from "../core/secrets";
import type { Device } from "../model";
import { Platforms } from "../platforms";
import { BgpWait } from "../platforms/bgp-wait";
import type { Finding } from "../platforms/finding";
import type { ApplyOptions, BgpLogLine, BgpSession, Plan, Platform, ReadSession } from "../platforms/platform";
import { ProjectError, type ProjectRead, readProject } from "../project/project";
import { ConsoleScript, type ConsoleSession, SerialConsole } from "../transport/console";
import { PathCheck } from "../transport/path-check";
import { Rename, type RenamePlan } from "./rename";
import { Setup } from "./setup";
import { Ui } from "./ui";

/** How a device is reached and what a plan sends, as `diff` and `apply` take them. */
export type ReachFlags = { secrets?: boolean; rollback?: number; console?: boolean; experimental?: boolean };

/** One project, read, and how it reaches devices. */
export class ProjectCommands {
    /** Ctrl-], the key that leaves `circuit access-console`, as telnet uses it. */
    private static readonly LEAVE_KEY = 0x1d;

    /** Every device of every network of the project. */
    readonly devices: Device[];

    private constructor(
        /** The project's folder. */
        readonly root: string,
        readonly project: ProjectRead,
        /** How a device is reached and what a plan sends: `apply`'s flags, the defaults for every other command. */
        private readonly options: ApplyOptions,
        /** `--experimental`: fields a platform renders but has not proved are warnings, not errors. */
        private readonly experimental = false
    ) {
        this.devices = project.networks.flatMap((network) => Object.values(network.devices));
    }

    /** The project's folder: the one named, or the working directory or the nearest folder above it with `circuit.ts`. Undefined when there is none. */
    static find(folder?: string): string | undefined {
        if (folder) {
            const root = resolve(process.cwd(), folder);
            return existsSync(join(root, "circuit.ts")) ? root : undefined;
        }

        let current = process.cwd();
        while (true) {
            if (existsSync(join(current, "circuit.ts"))) return current;

            const parent = dirname(current);
            if (parent === current) return undefined;
            current = parent;
        }
    }

    /** Read the project. Stops with every reason when it can't be read. */
    static async open(folder: string | undefined, flags: ReachFlags = {}): Promise<ProjectCommands> {
        const root =
            ProjectCommands.find(folder) ??
            Ui.fail(
                folder
                    ? `No circuit.ts in ${resolve(process.cwd(), folder)}.`
                    : "No Circuit project here: no circuit.ts in this folder or above it. Run circuit in a project's folder, or start one with circuit."
            );

        Setup.prepare(root);
        Secrets.useRoot(root);

        let project: ProjectRead;
        try {
            project = await Ui.step("Reading the project", () => readProject(root));
        } catch (error) {
            if (error instanceof ProjectError) Ui.fail(`${error.lines.join("\n")}\n\n${error.lines.length} error(s).`);
            throw error;
        }

        for (const warning of project.warnings) Ui.warn(warning);

        const names = project.networks.flatMap((network) => Object.keys(network.devices));
        const twice = names.filter((name, i) => names.indexOf(name) !== i);
        if (twice.length) Ui.fail(`${twice.join(", ")}: one hostname in two networks. A hostname is one device.`);

        const options: ApplyOptions = {
            secrets: flags.secrets ?? false,
            rollback: flags.rollback ?? 10,
            ...(flags.console ? { console: true } : {}),
        };

        return new ProjectCommands(root, project, options, flags.experimental ?? false);
    }

    /** The device with this name. Without one, a person picks it from a list; a script must name it. */
    async pick(name: string | undefined, devices: readonly Device[] = this.devices): Promise<Device> {
        if (name !== undefined) {
            const known = this.devices.map((device) => device.name).join(", ");
            return this.devices.find((device) => device.name === name) ?? Ui.fail(`No device ${name}. The project has: ${known}`);
        }

        if (!devices.length) Ui.fail("The project has no device yet.");
        if (!Ui.interactive) Ui.fail("Name the device.");

        return Ui.select(
            "Which device?",
            devices.map((device) => ({ value: device, label: device.name, hint: device.platform }))
        );
    }

    /** How a device is reached: through its console when `--console` asks, or when it has no management address. */
    private optionsFor(device: Device): ApplyOptions {
        return this.options.console || !device.connection.host ? { ...this.options, console: true } : this.options;
    }

    /** The adapter of a device, which must be able to use its console when the device is reached through it. */
    private adapterOf(device: Device): Platform {
        const adapter = Platforms.find(device.platform) ?? Ui.fail(`No adapter for ${device.platform}.`);
        if (!this.optionsFor(device).console) return adapter;

        if (!adapter.console) Ui.fail(`${device.name}: ${device.platform} cannot be reached through a console yet.`);
        if (!device.connection.console) Ui.fail(`${device.name}: --console needs connection.console.`);
        return adapter;
    }

    /** What the model's checks find, network by network: what each platform can't express, what it does otherwise, and the built-in checks the network turns on. */
    private modelFindings(): Finding[] {
        return this.project.networks.flatMap((network) =>
            Validation.run(Object.values(network.devices), network.settings.checks, { experimental: this.experimental })
        );
    }

    /** Print what was found, and stop on an error about one of these devices. */
    private guard(devices: readonly Device[], all: readonly Finding[] = this.modelFindings()): void {
        const relevant = new Set(devices.map((device) => device.name));
        const findings = all.filter((finding) => !finding.device || relevant.has(finding.device));

        for (const finding of findings) {
            const where = finding.device ? `${finding.device}: ` : "";
            if (finding.level === "error") Ui.error(`${where}${finding.message}`);
            else Ui.warn(`${where}${finding.message}`);
        }

        const errors = findings.filter((finding) => finding.level === "error").length;
        if (errors) Ui.fail(`\n${errors} error(s).`);
    }

    /** Print a plan. Returns how many commands and problems it holds. */
    private static printPlan(device: Device, plan: Plan): number {
        const commands = plan.steps.reduce((count, step) => count + step.send.length, 0);
        if (!commands && !plan.problems.length) {
            Ui.done(`${device.name} already runs its config. Nothing to change.`);
            return 0;
        }

        console.log(`\n${Ui.bold(device.name)}: ${commands} command(s) in ${plan.steps.length} step(s)`);

        for (const step of plan.steps) {
            console.log(`  ${Ui.bold(step.title)}`);
            for (const line of step.show) console.log(`    ${line.slice(0, 220)}`);
        }

        for (const problem of plan.problems) Ui.error(problem);

        return commands + plan.problems.length;
    }

    /** Where LLDP and `link` disagree on this device, read while Circuit is connected. Warnings only: LLDP can be off at the far end. */
    private async checkCabling(device: Device, adapter: Platform): Promise<void> {
        if (!Cabling.runsAnywhere(device) || !adapter.neighbors) return;

        const neighbors = await Ui.step(`Reading ${device.name}'s LLDP neighbors`, () =>
            adapter.neighbors!(device, this.devices, this.optionsFor(device))
        );
        for (const finding of Cabling.compare(this.devices, new Map([[device.name, neighbors]])))
            Ui.warn(`${device.name}: ${finding.message}`);
    }

    /** Read the device and plan against what it runs now. */
    private async plan(device: Device, adapter: Platform): Promise<Plan> {
        const live = await Ui.step(`Reading what ${device.name} runs`, () => adapter.read(device, this.devices, this.optionsFor(device)));
        await this.checkCabling(device, adapter);

        return adapter.plan(adapter.render(device), live, this.options);
    }

    validate(): void {
        this.guard(this.devices);
        Ui.done(`${this.devices.length} device(s), no errors.`);
    }

    /** What `apply` would send, against what the device runs now. Exits 1 when something would change. */
    async diff(name: string | undefined): Promise<void> {
        const device = await this.pick(name);
        this.guard([device]);

        const adapter = this.adapterOf(device);
        const changes = ProjectCommands.printPlan(device, await this.plan(device, adapter));

        process.exit(changes ? 1 : 0);
    }

    /** Plan against what the device runs, show the plan, and send it once the person says yes, or with `--confirm`. */
    async apply(name: string | undefined, confirmed: boolean, force: boolean): Promise<void> {
        const device = await this.pick(name);
        this.guard([device]);
        const adapter = this.adapterOf(device);

        // A lossy path also cuts the read short, so the path is checked before the read.
        await this.checkPath(device, force);

        const plan = await this.plan(device, adapter);
        if (!ProjectCommands.printPlan(device, plan)) return;

        if (plan.problems.length) Ui.fail("\nNot sent: resolve the problems first.");

        if (!confirmed) {
            if (!Ui.interactive) Ui.fail("\nNot sent. Without a person to answer, add --confirm to send.");
            console.log();
            if (!(await Ui.confirm(`Send these changes to ${device.name}?`))) {
                console.log("Nothing sent.");
                return;
            }
        }

        // What the checks after the apply compare against, such as the BGP sessions up now, is read before anything is sent.
        const health = await adapter.health?.(device, plan, this.optionsFor(device));

        await adapter.apply(device, this.devices, plan, this.optionsFor(device));
        Ui.done(`Sent to ${device.name}.`);

        if (!health) return;

        const problems = await Ui.step("Checking the device after the apply", () => health.run());
        if (problems.length) Ui.fail(`\nApplied, but the device is not healthy:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);

        Ui.done("No problems found.");
    }

    /** Run commands that only read, each under a header with how long it took. Every command is checked before anything connects. */
    async exec(name: string | undefined, given: string[], file: string | undefined, timeoutSeconds: number): Promise<void> {
        const device = await this.pick(name);
        const adapter = this.adapterOf(device);

        const fromFile = file ? readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/) : [];
        const listed = fromFile.map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
        const commands = [...given, ...listed];
        if (!commands.length && Ui.interactive)
            commands.push(await Ui.text("Command to run", { check: (value) => (value.trim() ? undefined : "Type a command.") }));
        if (!commands.length) Ui.fail("Give a command to run, or --file.");

        const refused = commands.filter((command) => !adapter.readOnly(command));
        if (refused.length) {
            Ui.fail(
                `Not known to only read on ${device.platform}, so nothing was sent. A change goes through circuit apply.\n${refused.map((command) => `  ${command}`).join("\n")}`
            );
        }

        const session = await Ui.step(`Connecting to ${device.name}`, () => adapter.session(device, this.optionsFor(device)));
        const timeout = timeoutSeconds * 1000;
        let failed = false;

        try {
            for (const command of commands) {
                const started = Date.now();
                let output: string;

                try {
                    output = await Ui.step(command, () => session.run(command, timeout));
                } catch (error) {
                    output = `stopped: ${(error as Error).message}`;
                    failed = true;
                }

                const took = Date.now() - started;
                const stoppedAtLimit = !failed && took >= timeout ? `\n(stopped at the ${timeoutSeconds} second limit)` : "";
                const block = `${Ui.bold(`>>> ${command}`)}  ${Ui.dim(`(${(took / 1000).toFixed(1)}s)`)}\n${output.replace(/\r/g, "").trimEnd()}${stoppedAtLimit}\n\n`;
                process.stdout.write(Secrets.scrub(block, { network: this.devices }));

                // A shell or a console still runs a command that did not finish, so nothing more can be sent.
                if (failed) break;
            }
        } finally {
            session.close();
        }

        if (failed) process.exitCode = 1;
    }

    /** A device's new name everywhere the project's files write it, and its file's when asked. Shows every change, and writes once the person says yes, or with `--confirm`. */
    async rename(from: string | undefined, to: string | undefined, file: boolean | undefined, confirmed: boolean): Promise<void> {
        const device = await this.pick(from);
        const network = this.project.networks.find((candidate) => device.name in candidate.devices)!;
        const declaring = network.files[device.name] ?? Ui.fail(`No file of the project writes ${device.name}, so rename it by hand.`);

        const check = (name: string) => {
            if (!Rename.HOSTNAME.test(name)) return `${name} is not a hostname: letters, digits, dots, dashes and underscores.`;
            if (this.devices.some((candidate) => candidate.name === name)) return `${name} is already a device.`;
            return undefined;
        };
        const name = to ?? (Ui.interactive ? await Ui.text(`New name for ${device.name}`, { check }) : Ui.fail("Give the new name."));
        const wrong = check(name);
        if (wrong) Ui.fail(wrong);

        // A file named after the device follows it, unless the person says otherwise.
        const namedAfter = basename(declaring, extname(declaring)) === device.name;
        const moveFile =
            file ??
            (namedAfter && Ui.interactive ? await Ui.confirm(`Also rename ${declaring} to ${name}${extname(declaring)}?`, true) : false);

        let plan: RenamePlan;
        try {
            plan = Rename.plan(this.root, device.name, name, { declaring, file: moveFile });
        } catch (error) {
            Ui.fail((error as Error).message);
        }

        for (const change of plan.changes) {
            console.log(Ui.bold(`${change.file}:${change.line}`));
            console.log(Ui.red(`  - ${change.before.trim()}`));
            console.log(Ui.green(`  + ${change.after.trim()}`));
        }
        for (const move of plan.moves) console.log(`${Ui.bold("move")} ${move.from} to ${move.to}`);

        if (plan.mentions.length) {
            console.log(`\nStill naming ${device.name}, left as they are. Change them by hand if they mean the device:`);
            for (const mention of plan.mentions) console.log(`  ${mention.file}:${mention.line}  ${mention.text.slice(0, 160)}`);
        }

        if (!confirmed) {
            if (!Ui.interactive) Ui.fail("\nNothing written. Without a person to answer, add --confirm.");
            console.log();
            if (!(await Ui.confirm(`Rename ${device.name} to ${name}?`))) {
                console.log("Nothing written.");
                return;
            }
        }

        Rename.apply(this.root, plan);
        Ui.done(`Renamed. Run circuit validate, then circuit apply ${name}: the device keeps its old hostname until then.`);
    }

    /** Every secret the config names, as `secret("NAME")` writes it. */
    references(): string[] {
        return [...Secrets.referencesIn([this.devices, this.project.networks.map((network) => network.settings.integrations)])].sort();
    }

    /**
     * Each BGP neighbor in the config next to its live session, on the device named or the only one with BGP neighbors, and only those whose name matches `neighbors` when given. With `wait`, reads again until every neighbor shown, or that many, is up, and fails when time runs out. With `clearLimit`, opens again the neighbors shown that closed on their prefix limit, and fails when none did.
     */
    async bgp(
        deviceName: string | undefined,
        flags: { neighbors?: string; wait?: true | number; max: number; log?: true | number; clearLimit?: true }
    ): Promise<void> {
        const device = await this.bgpDevice(deviceName);
        const pattern = flags.neighbors;
        const adapter = this.adapterOf(device);

        const supported = Platforms.all()
            .filter((platform) => platform.bgpSessions)
            .map((platform) => platform.name)
            .join(", ");
        if (!adapter.bgpSessions) Ui.fail(`circuit bgp does not support ${device.platform} yet, only ${supported}`);
        if (flags.log && !adapter.bgpLog) Ui.fail(`circuit bgp --log does not support ${device.platform} yet`);
        if (flags.clearLimit && !adapter.bgpClearLimit) Ui.fail(`circuit bgp --clear-limit does not support ${device.platform} yet`);
        if (flags.clearLimit && flags.wait !== undefined) Ui.fail("--clear-limit and --wait go in two runs: clear first, then wait");

        let matcher: RegExp;
        try {
            matcher = new RegExp(pattern ?? ".");
        } catch (error) {
            Ui.fail(`${pattern} is not a regular expression: ${(error as Error).message}`);
        }

        const names = Object.keys(device.routing?.bgp?.neighbors ?? {});
        if (!names.length) Ui.fail(`${device.name} has no BGP neighbors`);

        const shown = names.filter((name) => matcher.test(name));
        if (!shown.length) Ui.fail(`no BGP neighbor of ${device.name} matches ${matcher}; known: ${names.join(", ")}`);

        const want = flags.wait === undefined ? 0 : flags.wait === true ? shown.length : flags.wait;
        const session = await Ui.step(`Connecting to ${device.name}`, () => adapter.session(device, this.optionsFor(device)));

        try {
            const read = async () => (await adapter.bgpSessions!(device, session)).filter((neighbor) => shown.includes(neighbor.neighbor));

            if (flags.clearLimit) {
                await ProjectCommands.clearLimits(adapter, session, read);
                return;
            }

            const limits = { seconds: flags.max, every: BgpWait.COMMAND.every };
            const sessions = await BgpWait.until(
                read,
                (sessions) => BgpWait.upCount(sessions) >= want,
                limits,
                (sessions) =>
                    console.log(
                        `${new Date().toLocaleTimeString()}: ${BgpWait.upCount(sessions)}/${want} up, checking again in ${limits.every}s`
                    )
            );

            ProjectCommands.printBgp(sessions);
            if (BgpWait.upCount(sessions) < want) process.exitCode = 1;

            if (flags.log) await this.printBgpLog(adapter, session, flags.log === true ? 5 : flags.log);
        } finally {
            session.close();
        }
    }

    /** Open again the sessions closed on their limit, say which others were left alone, and show them all after. */
    private static async clearLimits(adapter: Platform, session: ReadSession, read: () => Promise<BgpSession[]>): Promise<void> {
        const sessions = await read();
        const closed = sessions.filter((bgp) => bgp.limit);

        if (!closed.length) {
            ProjectCommands.printBgp(sessions);
            console.error("\nno neighbor shown is closed on its prefix limit, so nothing was cleared");
            process.exitCode = 1;
            return;
        }

        for (const bgp of sessions) if (!bgp.limit) console.log(`${bgp.neighbor}: left alone, not closed on its limit`);
        await adapter.bgpClearLimit!(session, closed);
        console.log(
            `cleared ${closed.map((bgp) => bgp.neighbor).join(", ")}: each connects again, and closes again if it still sends too much\n`
        );

        ProjectCommands.printBgp(await read());
    }

    /** The device `circuit bgp` reads: the one named, the only device with BGP neighbors, or one a person picks from those. */
    private async bgpDevice(name: string | undefined): Promise<Device> {
        if (name !== undefined) return this.pick(name);

        const withBgp = this.devices.filter((device) => Object.keys(device.routing?.bgp?.neighbors ?? {}).length);
        if (withBgp.length === 1) return withBgp[0]!;
        if (!withBgp.length) Ui.fail("No device has BGP neighbors.");
        if (Ui.interactive) return this.pick(undefined, withBgp);

        return Ui.fail(`Several devices have BGP neighbors, so name one: ${withBgp.map((device) => device.name).join(", ")}`);
    }

    /** One line per neighbor: name, up or down, prefixes received, uptime, remote address. Then how many are up. */
    private static printBgp(sessions: readonly BgpSession[]): void {
        const width = Math.max(...sessions.map((session) => session.neighbor.length));

        for (const session of sessions) {
            const state = session.established ? "up  " : "DOWN";
            const why = session.reason ? `  ${ProjectCommands.downReason(session)}` : "";
            console.log(
                `${session.neighbor.padEnd(width)}  ${state}  ${session.prefixes.padStart(7)}  ${session.uptime.padEnd(12)}  ${session.remote}${why}`
            );
        }

        console.log(`${BgpWait.upCount(sessions)}/${sessions.length} up`);

        for (const burst of BgpWait.limitBursts(sessions)) {
            const names = burst.map((session) => session.neighbor);
            const listed = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
            const seconds = Math.round((burst.at(-1)!.limit!.stoppedAt! - burst[0]!.limit!.stoppedAt!) / 1000);

            console.log(
                `
${listed} closed on their prefix limit within ${seconds} s of each other, from ${burst[0]!.limit!.stopped}. Several limits at once is usually a leak upstream, not growth: find the leak before raising a limit, then clear them with --clear-limit.`
            );
        }
    }

    /** Why a session is down, with its limit and when it closed when that is why. */
    private static downReason(session: BgpSession): string {
        const { limit } = session;
        if (!limit) return session.reason ?? "";

        const over = limit.max !== undefined ? `: over ${limit.max} prefixes` : "";
        const when = limit.stopped ? `, closed ${limit.stopped}` : "";
        return `${session.reason}${over}${when}`;
    }

    /** The device's BGP log lines from the last `minutes`, a message repeated folded into one line, secrets hidden. */
    private async printBgpLog(adapter: Platform, session: ReadSession, minutes: number): Promise<void> {
        const lines = ProjectCommands.foldLog(await adapter.bgpLog!(session, minutes));
        const text = `\n--- BGP log, last ${minutes} min\n${lines.join("\n") || "(nothing)"}\n`;

        process.stdout.write(Secrets.scrub(text, { network: this.devices }));
    }

    /** A message repeated, such as one every 10 seconds, becomes one line with when it came first, when last, and how many times. */
    private static foldLog(lines: readonly BgpLogLine[]): string[] {
        const folded = new Map<string, { count: number; first: string; last: string }>();

        for (const { at, message } of lines) {
            const seen = folded.get(message);
            if (seen) {
                seen.count++;
                seen.last = at;
            } else {
                folded.set(message, { count: 1, first: at, last: at });
            }
        }

        return [...folded].map(([message, { count, first, last }]) => {
            const lastTime = last.split(" ")[1] ?? last;
            return count > 1 ? `${first}..${lastTime} x${count}  ${message}` : `${first}  ${message}`;
        });
    }

    /**
     * A device's console, for a person: logged in with the platform's own login, then joined to this terminal, or sent each line. Logs out when done, and lets the port go on Ctrl-C or when the terminal closes, so no other program finds it held.
     */
    async accessConsole(name: string | undefined, lines: string[], raw: boolean): Promise<void> {
        const device = await this.pick(name);
        const dialect = Platforms.find(device.platform)?.console ?? Ui.fail(`${device.platform} cannot be reached through a console yet`);
        const serial = device.connection.console ?? Ui.fail(`${device.name} has no connection.console`);
        const login = raw ? undefined : SerialConsole.of(device);

        let opened: ConsoleSession;
        try {
            opened = await SerialConsole.open(serial, 1);
        } catch (error) {
            const message = (error as Error).message;
            if (message.startsWith("busy:")) {
                Ui.fail(
                    `${device.name}: ${serial.port} is in use. Only one program can hold a console port: close the other one, then try again.`
                );
            }
            Ui.fail(`${device.name}: ${message}`);
        }

        let loggedIn = false;
        let leaving = false;

        const leave = async (code: number) => {
            if (leaving) return;
            leaving = true;

            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            if (loggedIn) opened.channel.write(`${dialect.logout}\n`);

            await opened.close();
            process.exit(code);
        };

        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => void leave(130));

        opened.channel.on("close", () => {
            if (leaving) return;

            console.error("\nthe console closed");
            process.exit(1);
        });

        if (login) {
            try {
                await SerialConsole.login(opened.channel, dialect, login.user, login.password, serial.password_only);
            } catch (error) {
                console.error(`${device.name}: ${(error as Error).message}`);
                await leave(1);
            }
            loggedIn = true;
        }

        if (lines.length) {
            await ConsoleScript.run(opened.channel, lines, (answer) =>
                process.stdout.write(Secrets.scrub(answer, { network: this.devices }))
            );
            await leave(0);
            return;
        }

        this.join(opened, device, loggedIn ? login?.user : undefined, leave);
    }

    /** Join the console to this terminal until Ctrl-] or the end of input. Every other key, Ctrl-C too, goes to the device. */
    private join(opened: ConsoleSession, device: Device, user: string | undefined, leave: (code: number) => Promise<void>): void {
        const stdin = process.stdin;
        const as = user ? `, logged in as ${user}` : "";
        console.error(`${device.name}'s console${as}. Ctrl-] leaves.`);

        opened.channel.on("data", (chunk: Buffer) => process.stdout.write(chunk));

        if (stdin.isTTY) stdin.setRawMode(true);

        stdin.on("data", (data: Buffer) => {
            const at = data.indexOf(ProjectCommands.LEAVE_KEY);
            const keys = at >= 0 ? data.subarray(0, at) : data;

            // A terminal sends a carriage return for Enter; text piped in ends its lines with a line feed, which the console takes as a keyboard's Enter.
            if (keys.length) opened.channel.write(stdin.isTTY ? keys : keys.toString("utf8"));
            if (at >= 0) void leave(0);
        });

        stdin.on("end", () => void leave(0));
        stdin.resume();
    }

    /** Ping the device and stop when the path loses too much or is too slow, unless `force`. A device reached through its console has no path to measure. */
    private async checkPath(device: Device, force: boolean): Promise<void> {
        const host = device.connection.host;
        if (!host || this.optionsFor(device).console) return;

        const measure = await Ui.step(`Measuring the path to ${host}`, () => PathCheck.measure(host));
        if (!measure) {
            console.log(`path: no ping program here, so the path to ${host} was not measured`);
            return;
        }

        const { refuse, summary } = PathCheck.verdict(host, measure);
        console.log(`path: ${summary}`);
        if (!refuse) return;

        const limits = `at most ${PathCheck.MAX_LOSS_PERCENT}% lost and ${PathCheck.MAX_AVERAGE_MS} ms on average`;
        if (force) {
            console.log(`path: worse than ${limits}; going ahead, as --force asks`);
            return;
        }

        Ui.fail(
            `\nNot sent: the path is worse than ${limits}. A change sent over a path that drops packets can cut the device off halfway. Fix the path, or add --force to go ahead anyway.`
        );
    }
}
