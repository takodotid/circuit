#!/usr/bin/env bun
// The command line. `init` starts a project, or refreshes its editor types; every other command reads the project in the working directory, or in
// the folder `--project` names.

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Validation } from "../checks";
import { Address } from "../core/address";
import { Cabling, type Neighbor } from "../core/cabling";
import { Registries } from "../core/registries";
import { Secrets } from "../core/secrets";
import type { Device } from "../model";
import { Platforms } from "../platforms";
import { BgpWait } from "../platforms/bgp-wait";
import type { Finding } from "../platforms/finding";
import type { ApplyOptions, BgpLogLine, BgpSession, Plan, Platform, ReadSession } from "../platforms/platform";
import { ProjectError, type ProjectRead, readProject } from "../project/project";
import { ConsoleScript, type ConsoleSession, SerialConsole } from "../transport/console";
import { PathCheck } from "../transport/path-check";
import { EditorTypes } from "./editor-types";
import { VERSION } from "./version";

const GENERATED_README = `# Written by Circuit

Do not edit anything here: an edit changes nothing on a device, and Circuit overwrites it. Change the project instead.

\`types/\` is what your editor reads to complete and check the project's files. \`circuit init\` writes it again after Circuit is updated.

\`state/\` holds what each device ran when Circuit last read it, with secrets removed. \`circuit snapshot\` and \`circuit apply\` write it, and \`circuit diff\` plans against it. Commit it, so the history of this folder is the history of the network.

A \`.lldp.json\` file beside a device's state is what the device saw over LLDP at the last \`circuit snapshot\`: which device and port is at the far end of each cable. \`circuit check\` compares it with each port's \`link\`; \`circuit diff\` ignores it.
`;

/** One run of the command line: the project it read, and how it reaches devices. */
class Cli {
    /** Ctrl-], the key that leaves `circuit console`, as telnet uses it. */
    private static readonly LEAVE_KEY = 0x1d;

    /** `--project`, which every command but `init` takes. */
    private static readonly PROJECT_FLAGS = "--project <folder>";
    private static readonly PROJECT_HELP = "the project's folder, the working directory by default";

    /** What Circuit writes, in the project. */
    private readonly generated: string;
    private readonly stateDirectory: string;
    /** Every device of every network of the project. */
    private readonly devices: Device[];

    private constructor(
        /** The project's folder. */
        root: string,
        private readonly project: ProjectRead,
        /** How a device is reached and what a plan sends: `apply`'s flags, the defaults for every other command. */
        private readonly options: ApplyOptions
    ) {
        this.generated = join(root, ".circuit");
        this.stateDirectory = join(this.generated, "state");
        this.devices = project.networks.flatMap((network) => Object.values(network.devices));
    }

    /** Read the arguments and run the command they name. */
    static async main(argv: string[]): Promise<void> {
        const program = Cli.program();

        // With no command, the help, as `circuit help` prints it.
        if (!argv.length) {
            program.outputHelp();
            return;
        }

        await program.parseAsync(argv, { from: "user" });
    }

    /** Read the project in the folder `--project` names, or in the working directory. Stops with every reason when it can't be read. */
    private static async open(folder: string | undefined, flags: Partial<ApplyOptions> = {}): Promise<Cli> {
        const root = resolve(process.cwd(), folder ?? ".");
        if (!existsSync(join(root, "circuit.ts"))) {
            Cli.fail(
                folder
                    ? `no circuit.ts in ${root}`
                    : `no circuit.ts in ${root}; give the project's folder with --project <folder>, or start one with circuit init`
            );
        }

        let project: ProjectRead;
        try {
            project = await readProject(root);
        } catch (error) {
            if (error instanceof ProjectError) Cli.fail(`${error.lines.join("\n")}\n\n${error.lines.length} error(s).`);
            throw error;
        }

        for (const warning of project.warnings) console.log(`  warn   ${warning}`);
        if (!EditorTypes.current(root))
            console.log("  warn   .circuit/types is not this Circuit's: run circuit init, so the editor checks what this Circuit reads");

        const names = project.networks.flatMap((network) => Object.keys(network.devices));
        const twice = names.filter((name, i) => names.indexOf(name) !== i);
        if (twice.length) Cli.fail(`${twice.join(", ")}: one hostname in two networks. A hostname is one device.`);

        const options: ApplyOptions = {
            secrets: flags.secrets ?? false,
            rollback: flags.rollback ?? 10,
            ...(flags.console ? { console: true } : {}),
        };

        return new Cli(root, project, options);
    }

    private static fail(message: string): never {
        console.error(message);
        process.exit(1);
    }

    /** `--rollback`'s value: a whole number of minutes. */
    private static minutes(value: string): number {
        const minutes = Number(value);
        if (!Number.isInteger(minutes) || minutes < 1) throw new InvalidArgumentError("Give a whole number of minutes, such as 10.");

        return minutes;
    }

    /** `--timeout`'s value: a whole number of seconds. */
    private static seconds(value: string): number {
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 1) throw new InvalidArgumentError("Give a whole number of seconds, such as 90.");

        return seconds;
    }

    /** `--wait`'s value: a whole number of sessions. */
    private static count(value: string): number {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) throw new InvalidArgumentError("Give a whole number of sessions, such as 4.");

        return count;
    }

    /** Every command, with its arguments and options. `circuit --help` and `circuit <command> --help` are written from these. */
    private static program() {
        const program = new Command("circuit")
            .description("Describe each network device in TypeScript, see what would change, then make the device match.")
            .version(VERSION)
            .usage("<command> [device...] [options]")
            .showHelpAfterError("(add --help to see what it takes)");

        program
            .command("init")
            .description("start a project in a folder, or write its editor types again after Circuit is updated")
            .argument("[folder]", "the project's folder, the working directory by default")
            .option("--asn <number>", "your AS number, for a new project's circuit.ts")
            .action((folder, flags) => Cli.init(folder, flags.asn));

        program
            .command("check")
            .description("read the project and check it, then every check in circuit.ts")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => (await Cli.open(flags.project)).check());

        program
            .command("build")
            .description("print the configuration the device should run, without contacting it")
            .argument("<device>")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, flags) => (await Cli.open(flags.project)).build(device));

        program
            .command("diff")
            .description("what apply would send, planned against the last snapshot, offline")
            .argument("[device...]", "every device when none is named")
            .option("--secrets", "plan as apply --secrets would, sending every secret again")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (devices, flags) => (await Cli.open(flags.project, flags)).diff(devices));

        program
            .command("snapshot")
            .description("read what each device runs into .circuit/state")
            .argument("[device...]", "every device when none is named")
            .option("--console", "through the device's serial console on its jump host, instead of SSH")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (devices, flags) => (await Cli.open(flags.project, flags)).snapshot(devices));

        program
            .command("apply")
            .description("read the device, plan against what it runs, and send with --confirm")
            .argument("<device>")
            .option("--confirm", "send the plan; without it, nothing is sent")
            .option("--secrets", "also send every secret, to rotate one")
            .option("--rollback <minutes>", "minutes before a device that can restore itself does", Cli.minutes, 10)
            .option("--console", "through the device's serial console on its jump host, instead of SSH")
            .option("--force", "send even when the pings before --confirm find a path that loses too much or is too slow")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, flags) =>
                (await Cli.open(flags.project, flags)).apply(device, flags.confirm ?? false, flags.force ?? false)
            );

        program
            .command("show")
            .description("run commands that only read on a device and print what it answers, secrets hidden")
            .argument("<device>")
            .argument("[command...]", "each command in quotes, such as '/ip route print'")
            .option("--file <path>", "also each line of this file; blank lines and lines starting with # are skipped")
            .option("--timeout <seconds>", "how long each command may take", Cli.seconds, 90)
            .option("--console", "through the device's serial console, instead of SSH")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, commands, flags) =>
                (await Cli.open(flags.project, flags)).show(device, commands, flags.file, flags.timeout)
            );

        program
            .command("bgp")
            .description("each BGP neighbor in the config next to its live session: up or down and why, prefixes, uptime")
            .argument("[device]", "may be left out when only one device has BGP neighbors")
            .option("--neighbors <regex>", "only the neighbors whose name matches")
            .option(
                "--wait [count]",
                `read again every ${BgpWait.COMMAND.every} seconds until every neighbor shown, or this many, is up`,
                Cli.count
            )
            .option("--max <seconds>", "how long --wait waits at most", Cli.seconds, BgpWait.COMMAND.seconds)
            .option("--log [minutes]", "also print the device's BGP log lines from the last minutes, 5 by default", Cli.minutes)
            .option("--clear-limit", "open again the neighbors shown that closed on their prefix limit; any other is left alone")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, flags) => (await Cli.open(flags.project)).bgp(device, flags));

        program
            .command("console")
            .description("open a device's serial console here, logged in; or send it lines and print what it answers")
            .argument("<device>")
            .argument("[line...]", "lines to send, each in quotes; none joins the console to this terminal, Ctrl-] leaves")
            .option("--raw", "do not log in or out: only join the console, or send the lines")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, lines, flags) => (await Cli.open(flags.project)).console(device, lines, flags.raw ?? false));

        program
            .command("refresh")
            .description("fetch prefix sets that come from a registry onto the device, with --confirm")
            .argument("<device>")
            .option("--confirm", "put them on the device; without it, nothing is sent")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, flags) => (await Cli.open(flags.project)).refresh(device, flags.confirm ?? false));

        program
            .command("wireguard")
            .description("a client config for one peer, its private key left for the peer to fill")
            .argument("<device>")
            .argument("<interface>")
            .argument("<peer>")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, iface, peer, flags) => (await Cli.open(flags.project)).wireguard(device, iface, peer));

        program
            .command("communities")
            .description("the network's BGP communities, one per line, for a looking glass or bgp.tools")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => (await Cli.open(flags.project)).communities());

        program
            .command("secrets")
            .description("every secret the project uses, and whether each can be read")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => (await Cli.open(flags.project)).secrets());

        return program;
    }

    /** Start a project in `folder`: `circuit.ts`, `sites/`, `tenants/`, `.gitignore`, `tsconfig.json`; and the editor types, written again each time. */
    private static init(folder: string | undefined, asn: string | undefined): void {
        const root = resolve(process.cwd(), folder ?? ".");
        const started = existsSync(join(root, "circuit.ts"));
        mkdirSync(root, { recursive: true });

        if (!started) {
            if (asn !== undefined && !/^\d+$/.test(asn)) Cli.fail(`--asn takes a number, such as 64500, not ${asn}`);
            const name = `as${asn ?? "64500"}`;

            writeFileSync(
                join(root, "circuit.ts"),
                `// The network: its AS, its sites, and the checks Circuit runs on it. Each device is a file under sites/<site>/.

export const ${name} = circuit({
    asn: ${asn ?? 64500},
    sites: {
        "site-1": { description: "The first site" },
    },
    checks: {
        exports_end_in_reject: true,
        imports_end_in_accept_or_reject: true,
    },
});
`
            );
            mkdirSync(join(root, "sites", "site-1"), { recursive: true });
            mkdirSync(join(root, "tenants"), { recursive: true });
            writeFileSync(
                join(root, "tenants", "README.md"),
                "What tenants share with your devices, one file each, merged in `tenants/index.ts`.\n"
            );
            if (!existsSync(join(root, ".gitignore")))
                writeFileSync(join(root, ".gitignore"), "# Secrets live in .env and nowhere else.\n.env\n");
            if (!existsSync(join(root, ".env")))
                writeFileSync(join(root, ".env"), '# Each secret the project names with secret("NAME"): NAME=value\n');
        }

        EditorTypes.write(root);
        writeFileSync(join(root, ".circuit", "README.md"), GENERATED_README);
        if (!existsSync(join(root, "tsconfig.json"))) writeFileSync(join(root, "tsconfig.json"), EditorTypes.TSCONFIG);

        console.log(
            started
                ? `${root}: editor types written again for Circuit ${VERSION}`
                : `${root}: a project started. Write each device in sites/site-1/<name>.ts, then run circuit check.`
        );
    }

    /** The devices with these names, or every device when none is named and `allByDefault`. */
    private selected(names: readonly string[], allByDefault: boolean): Device[] {
        if (!names.length && allByDefault) return [...this.devices];

        const known = this.devices.map((device) => device.name).join(", ");
        const byName = (name: string) => this.devices.find((device) => device.name === name);

        return names.map((name) => byName(name) ?? Cli.fail(`no device ${name}; known: ${known}`));
    }

    /** The device with this name. */
    private one(name: string): Device {
        return this.selected([name], false)[0]!;
    }

    /** How a device is reached: through its console when `--console` asks, or when it has no management address. */
    private optionsFor(device: Device): ApplyOptions {
        return this.options.console || !device.connection.host ? { ...this.options, console: true } : this.options;
    }

    /** The adapter of a device, which must be able to use its console when the device is reached through it. */
    private adapterOf(device: Device): Platform {
        const adapter = Platforms.find(device.platform) ?? Cli.fail(`no adapter for ${device.platform}`);
        if (!this.optionsFor(device).console) return adapter;

        if (!adapter.console) Cli.fail(`${device.name}: ${device.platform} cannot be reached through a console yet`);
        if (!device.connection.console) Cli.fail(`${device.name}: --console needs connection.console`);
        return adapter;
    }

    private statePath(device: Device): string {
        return join(this.stateDirectory, device.name + this.adapterOf(device).extension);
    }

    /** Record what a device runs, beside a note that the folder is generated. */
    private writeState(device: Device, text: string): void {
        mkdirSync(this.stateDirectory, { recursive: true });
        writeFileSync(join(this.generated, "README.md"), GENERATED_README);
        writeFileSync(this.statePath(device), text);
    }

    /** Each device's LLDP neighbors at its last snapshot, for the devices whose neighbors were read. */
    private neighbors(): Map<string, Neighbor[]> {
        const found = new Map<string, Neighbor[]>();

        for (const device of this.devices) {
            const neighbors = Cabling.load(this.stateDirectory, device.name);
            if (neighbors) found.set(device.name, neighbors);
        }

        return found;
    }

    /** What the model's checks find, network by network: what each platform can't express, what it does otherwise, and the built-in checks the network turns on. */
    private modelFindings(): Finding[] {
        return this.project.networks.flatMap((network) => Validation.run(Object.values(network.devices), network.settings.checks));
    }

    /** Print what was found, and stop on an error about one of these devices. `diff` and `apply` leave LLDP out: it is what was seen, not config. */
    private guard(devices: Device[], all: readonly Finding[] = this.modelFindings()): void {
        const relevant = new Set(devices.map((device) => device.name));
        const findings = all.filter((finding) => !finding.device || relevant.has(finding.device));

        for (const finding of findings) {
            const where = finding.device ? `${finding.device}: ` : "";
            const level = finding.level === "error" ? "error" : "warn ";
            console.log(`  ${level}  ${where}${finding.message}`);
        }

        const errors = findings.filter((finding) => finding.level === "error").length;
        if (errors) Cli.fail(`\n${errors} error(s).`);
    }

    /** Print a plan. Returns how many commands and problems it holds. */
    private static printPlan(device: Device, plan: Plan): number {
        const commands = plan.steps.reduce((count, step) => count + step.send.length, 0);
        const summary = commands ? `${commands} command(s) in ${plan.steps.length} step(s)` : "matches";
        console.log(`${device.name}: ${summary}`);

        for (const step of plan.steps) {
            console.log(`  ${step.title}`);
            for (const line of step.show) console.log(`    ${line.slice(0, 220)}`);
        }

        for (const problem of plan.problems) console.log(`  PROBLEM ${problem}`);

        return commands + plan.problems.length;
    }

    private check(): void {
        this.guard([...this.devices], [...this.modelFindings(), ...Cabling.compare(this.devices, this.neighbors())]);
        console.log(`${this.devices.length} device(s), no errors.`);
    }

    private build(name: string): void {
        const device = this.one(name);
        this.guard([device]);
        process.stdout.write(this.adapterOf(device).render(device));
    }

    private diff(names: string[]): void {
        const devices = this.selected(names, true);
        this.guard(devices);

        let differences = 0;

        for (const device of devices) {
            const path = this.statePath(device);
            if (!existsSync(path)) {
                console.log(`${device.name}: no snapshot, run snapshot first`);
                continue;
            }

            const adapter = this.adapterOf(device);
            const plan = adapter.plan(adapter.render(device), readFileSync(path, "utf8"), this.options);
            differences += Cli.printPlan(device, plan);
        }

        process.exit(differences ? 1 : 0);
    }

    private async snapshot(names: string[]): Promise<void> {
        for (const device of this.selected(names, true)) {
            const adapter = this.adapterOf(device);
            const text = await adapter.read(device, this.devices, this.optionsFor(device));
            this.writeState(device, text);
            console.log(`${device.name}: ${text.split("\n").length} lines`);

            await this.snapshotNeighbors(device, adapter);
        }

        // With every device read, a snapshot of a device the project no longer has, such as one renamed, is removed.
        if (names.length || !existsSync(this.stateDirectory)) return;

        const current = new Set(
            this.devices.flatMap((device) => [basename(this.statePath(device)), basename(Cabling.path(this.stateDirectory, device.name))])
        );
        for (const file of readdirSync(this.stateDirectory)) {
            if (current.has(file)) continue;

            rmSync(join(this.stateDirectory, file));
            console.log(`${file}: removed, no such device in the project`);
        }
    }

    /** Save a device's LLDP neighbors beside its state, where its platform can read them. A device without LLDP is left alone. */
    private async snapshotNeighbors(device: Device, adapter: Platform): Promise<void> {
        if (!Cabling.runsAnywhere(device)) return;

        if (!adapter.neighbors) {
            Cabling.forget(this.stateDirectory, device.name);
            console.log(`${device.name}: LLDP neighbors not read, reading them on ${device.platform} is not proved on a device yet`);
            return;
        }

        const neighbors = await adapter.neighbors(device, this.devices, this.optionsFor(device));
        Cabling.save(this.stateDirectory, device.name, neighbors);
        console.log(`${device.name}: ${neighbors.length} LLDP neighbor(s)`);
    }

    private async apply(name: string, confirmed: boolean, force: boolean): Promise<void> {
        const device = this.one(name);
        this.guard([device]);
        const adapter = this.adapterOf(device);

        // A lossy path also cuts the read short, so the path is checked before the read.
        if (confirmed) await this.checkPath(device, force);

        // The plan is made against what the device runs now, never against an old snapshot.
        const live = await adapter.read(device, this.devices, this.optionsFor(device));
        this.writeState(device, live);

        const plan = adapter.plan(adapter.render(device), live, this.options);
        if (!Cli.printPlan(device, plan)) return;

        if (plan.problems.length) Cli.fail("\nNot sent: resolve the problems first.");

        if (!confirmed) {
            console.log("\nNothing sent. Re-run with --confirm.");
            return;
        }

        // What the checks after the apply compare against, such as the BGP sessions up now, is read before anything is sent.
        const health = await adapter.health?.(device, plan, this.optionsFor(device));

        await adapter.apply(device, this.devices, plan, this.optionsFor(device));

        this.writeState(device, await adapter.read(device, this.devices, this.optionsFor(device)));
        console.log("snapshot updated");

        if (!health) return;

        console.log("checking the device after the apply");
        const problems = await health.run();

        if (problems.length) {
            Cli.fail(`\nApplied, but the device is not healthy:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
        }

        console.log("no problems found");
    }

    /** Run commands that only read, each under a header with how long it took. Every command is checked before anything connects. */
    private async show(name: string, given: string[], file: string | undefined, timeoutSeconds: number): Promise<void> {
        const device = this.one(name);
        const adapter = this.adapterOf(device);

        const fromFile = file ? readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/) : [];
        const listed = fromFile.map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
        const commands = [...given, ...listed];
        if (!commands.length) Cli.fail("give a command to run, or --file");

        const refused = commands.filter((command) => !adapter.readOnly(command));
        if (refused.length) {
            Cli.fail(
                `not known to only read on ${device.platform}, so nothing was sent:\n${refused.map((command) => `  ${command}`).join("\n")}`
            );
        }

        const session = await adapter.session(device, this.optionsFor(device));
        const timeout = timeoutSeconds * 1000;
        let failed = false;

        try {
            for (const command of commands) {
                const started = Date.now();
                let output: string;

                try {
                    output = await session.run(command, timeout);
                } catch (error) {
                    output = `stopped: ${(error as Error).message}`;
                    failed = true;
                }

                const took = Date.now() - started;
                const stoppedAtLimit = !failed && took >= timeout ? `\n(stopped at the ${timeoutSeconds} second limit)` : "";
                const block = `>>> ${command}  (${(took / 1000).toFixed(1)}s)\n${output.replace(/\r/g, "").trimEnd()}${stoppedAtLimit}\n\n`;
                process.stdout.write(Secrets.scrub(block, { network: this.devices }));

                // A shell or a console still runs a command that did not finish, so nothing more can be sent.
                if (failed) break;
            }
        } finally {
            session.close();
        }

        if (failed) process.exitCode = 1;
    }

    /**
     * Each BGP neighbor in the config next to its live session, on the device named or the only one with BGP neighbors, and only those whose name matches `neighbors` when given. With `wait`, reads again until every neighbor shown, or that many, is up, and fails when time runs out. With `clearLimit`, opens again the neighbors shown that closed on their prefix limit, and fails when none did.
     */
    private async bgp(
        deviceName: string | undefined,
        flags: { neighbors?: string; wait?: true | number; max: number; log?: true | number; clearLimit?: true }
    ): Promise<void> {
        const device = this.bgpDevice(deviceName);
        const pattern = flags.neighbors;
        const adapter = this.adapterOf(device);

        const supported = Platforms.all()
            .filter((platform) => platform.bgpSessions)
            .map((platform) => platform.name)
            .join(", ");
        if (!adapter.bgpSessions) Cli.fail(`circuit bgp does not support ${device.platform} yet, only ${supported}`);
        if (flags.log && !adapter.bgpLog) Cli.fail(`circuit bgp --log does not support ${device.platform} yet`);
        if (flags.clearLimit && !adapter.bgpClearLimit) Cli.fail(`circuit bgp --clear-limit does not support ${device.platform} yet`);
        if (flags.clearLimit && flags.wait !== undefined) Cli.fail("--clear-limit and --wait go in two runs: clear first, then wait");

        let matcher: RegExp;
        try {
            matcher = new RegExp(pattern ?? ".");
        } catch (error) {
            Cli.fail(`${pattern} is not a regular expression: ${(error as Error).message}`);
        }

        const names = Object.keys(device.routing?.bgp?.neighbors ?? {});
        if (!names.length) Cli.fail(`${device.name} has no BGP neighbors`);

        const shown = names.filter((name) => matcher.test(name));
        if (!shown.length) Cli.fail(`no BGP neighbor of ${device.name} matches ${matcher}; known: ${names.join(", ")}`);

        const want = flags.wait === undefined ? 0 : flags.wait === true ? shown.length : flags.wait;
        const session = await adapter.session(device, this.optionsFor(device));

        try {
            const read = async () => (await adapter.bgpSessions!(device, session)).filter((neighbor) => shown.includes(neighbor.neighbor));

            if (flags.clearLimit) {
                await Cli.clearLimits(adapter, session, read);
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

            Cli.printBgp(sessions);
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
            Cli.printBgp(sessions);
            console.error("\nno neighbor shown is closed on its prefix limit, so nothing was cleared");
            process.exitCode = 1;
            return;
        }

        for (const bgp of sessions) if (!bgp.limit) console.log(`${bgp.neighbor}: left alone, not closed on its limit`);
        await adapter.bgpClearLimit!(session, closed);
        console.log(
            `cleared ${closed.map((bgp) => bgp.neighbor).join(", ")}: each connects again, and closes again if it still sends too much\n`
        );

        Cli.printBgp(await read());
    }

    /** The device `circuit bgp` reads: the one named, or the only device with BGP neighbors. */
    private bgpDevice(name: string | undefined): Device {
        if (name !== undefined) return this.one(name);

        const withBgp = this.devices.filter((device) => Object.keys(device.routing?.bgp?.neighbors ?? {}).length);
        if (withBgp.length === 1) return withBgp[0]!;
        if (!withBgp.length) Cli.fail("no device has BGP neighbors");

        return Cli.fail(`several devices have BGP neighbors, so name one: ${withBgp.map((device) => device.name).join(", ")}`);
    }

    /** One line per neighbor: name, up or down, prefixes received, uptime, remote address. Then how many are up. */
    private static printBgp(sessions: readonly BgpSession[]): void {
        const width = Math.max(...sessions.map((session) => session.neighbor.length));

        for (const session of sessions) {
            const state = session.established ? "up  " : "DOWN";
            const why = session.reason ? `  ${Cli.downReason(session)}` : "";
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
        const lines = Cli.foldLog(await adapter.bgpLog!(session, minutes));
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
    private async console(name: string, lines: string[], raw: boolean): Promise<void> {
        const device = this.one(name);
        const dialect = Platforms.find(device.platform)?.console ?? Cli.fail(`${device.platform} cannot be reached through a console yet`);
        const serial = device.connection.console ?? Cli.fail(`${device.name} has no connection.console`);
        const login = raw ? undefined : SerialConsole.of(device);

        let opened: ConsoleSession;
        try {
            opened = await SerialConsole.open(serial, 1);
        } catch (error) {
            const message = (error as Error).message;
            if (message.startsWith("busy:")) {
                Cli.fail(
                    `${device.name}: ${serial.port} is in use. Only one program can hold a console port: close the other one, then try again.`
                );
            }
            Cli.fail(`${device.name}: ${message}`);
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
            const at = data.indexOf(Cli.LEAVE_KEY);
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

        const measure = await PathCheck.measure(host);
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

        Cli.fail(
            `\nNot sent: the path is worse than ${limits}. A change sent over a path that drops packets can cut the device off halfway. Fix the path, or add --force to go ahead anyway.`
        );
    }

    private async refresh(name: string, confirmed: boolean): Promise<void> {
        const device = this.one(name);
        const adapter = this.adapterOf(device);
        const fill = adapter.fill?.bind(adapter) ?? Cli.fail(`${device.platform} cannot hold a fetched prefix set`);

        for (const [name, set] of Object.entries(device.routing?.prefix_sets ?? {})) {
            if (!set || !("source" in set)) continue;

            const { registry, query, family } = set.source;
            const prefixes = await Registries.prefixes(registry, query, family);

            // An empty or absurd answer is a broken feed, not a policy.
            if (prefixes.length < 1 || prefixes.length > 100_000) {
                Cli.fail(`${name}: ${prefixes.length} prefixes from ${registry}, refusing`);
            }

            console.log(`${name}: ${prefixes.length} prefixes from ${registry} ${query}`);
            if (confirmed) await fill(device, this.devices, name, family, prefixes);
        }

        if (!confirmed) console.log("\nNothing sent. Re-run with --confirm.");
    }

    /** A WireGuard public key from its private key, so the device's never has to be read off the box. */
    private static publicKeyOf(privateKey: string): string {
        // The DER prefix of a raw X25519 private key in PKCS#8.
        const pkcs8Prefix = Buffer.from("302e020100300506032b656e04220420", "hex");
        const der = Buffer.concat([pkcs8Prefix, Buffer.from(privateKey, "base64")]);

        const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
        const publicDer = createPublicKey(key).export({ format: "der", type: "spki" });

        return publicDer.subarray(-32).toString("base64");
    }

    private wireguard(deviceName: string, interfaceName: string, peerName: string): void {
        const device = this.one(deviceName);
        const iface =
            device.interfaces?.wireguard?.[interfaceName] ?? Cli.fail(`${deviceName} has no WireGuard interface ${interfaceName}`);

        const peers = iface.peers ?? [];
        const peerNames = peers.map((candidate) => candidate.name).join(", ");
        const peer =
            peers.find((candidate) => candidate.name === peerName) ?? Cli.fail(`no peer ${peerName} on ${interfaceName}: ${peerNames}`);

        const tunnelNetworks = (iface.addresses ?? []).map((entry) => Address.prefixOf(typeof entry === "string" ? entry : entry.address));

        const lines = [
            "[Interface]",
            `# ${peerName}'s own private key. It never leaves their machine.`,
            "PrivateKey = <FILL IN>",
            `Address = ${peer.allowed_addresses.join(", ")}`,
            "",
            "[Peer]",
            `PublicKey = ${Cli.publicKeyOf(Secrets.reveal(iface.private_key))}`,
            `Endpoint = ${iface.endpoint ?? "<FILL IN>"}:${iface.listen_port}`,
            `AllowedIPs = ${(peer.client_allowed_addresses ?? tunnelNetworks).join(", ")}`,
            "PersistentKeepalive = 25",
            "",
        ];
        process.stdout.write(lines.join("\n"));
    }

    private communities(): void {
        const communities = this.project.networks.flatMap((network) => network.communities);
        if (!communities.length) Cli.fail("no network of the project writes communities in circuit.ts");

        for (const { community, description } of communities) {
            // The format splits each line at its first comma.
            if (community.includes(",")) Cli.fail(`community ${community} holds a comma`);
            console.log(`${community},${description}`);
        }
    }

    private secrets(): void {
        const references = [
            ...Secrets.referencesIn([this.devices, this.project.networks.map((network) => network.settings.integrations)]),
        ].sort();
        let missing = 0;

        for (const reference of references) {
            const name = reference.replace(/^file:/, "");

            try {
                Secrets.reveal(reference);
                console.log(`  ok       ${name}, from ${Secrets.sourceOf(reference)}`);
            } catch (error) {
                missing++;
                console.log(`  missing  ${name}: ${(error as Error).message}`);
            }
        }

        console.log(`\n${references.length} secret(s), ${missing} missing.`);
        process.exit(missing ? 1 : 0);
    }
}

await Cli.main(process.argv.slice(2));
