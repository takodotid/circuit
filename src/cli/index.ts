#!/usr/bin/env node
// The command line. `new` starts a project; every other command loads the network from `circuit.config.ts` in the working directory, or the file `--config` names.

import { Command, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Platforms } from "../platforms";
import type { ApplyOptions, BgpLogLine, BgpSession, Platform, Plan, ReadSession } from "../platforms/platform";
import { BgpWait } from "../platforms/bgp-wait";
import { Registries } from "../integrations/registries";
import { LibreNms } from "../integrations/librenms";
import { NetBox, type NetBoxPlan } from "../integrations/netbox";
import { PeeringDb } from "../integrations/peeringdb";
import { Prometheus } from "../integrations/prometheus";
import { Address } from "../core/address";
import { Cabling, type Neighbor } from "../core/cabling";
import { AddressSpace, type Segment } from "../core/address-space";
import type { Finding, Network } from "../core/define";
import { Topology, type Annotated, type Drift, type Layer } from "../core/topology";
import { Secrets } from "../core/secrets";
import { Validator } from "../core/validator";
import type { Device } from "../schema";
import { GraphFormat } from "./graph-format";
import { Rename, type RenamePlan } from "./rename";
import { ProjectFiles } from "../core/project-files";
import { ConsoleScript, type ConsoleSession, SerialConsole } from "../transport/console";
import { PathCheck } from "../transport/path-check";
import { StudioModel } from "../studio/data";
import type { ScaffoldOptions } from "./new";

const GENERATED_README = `# Written by Circuit

Do not edit anything here: an edit changes nothing on a device, and Circuit overwrites it. Change the config instead.

\`state/\` holds what each device ran when Circuit last read it, with secrets removed. \`circuit snapshot\` and \`circuit apply\` write it, and \`circuit diff\` plans against it. Commit it, so the history of this directory is the history of the network.

A \`.lldp.json\` file beside a device's config is what the device saw over LLDP at the last \`circuit snapshot\`: which device and port is at the far end of each cable. \`circuit validate\` compares it with each port's \`link\`; \`circuit diff\` ignores it.
`;

/** One run of the command line: the network it loaded, and how it reaches devices. */
class Cli {
    static readonly DEFAULT_CONFIG = "circuit.config.ts";

    /** Ctrl-], the key that leaves `circuit console`, as telnet uses it. */
    private static readonly LEAVE_KEY = 0x1d;

    /** `--config`, which every command but `new` takes. */
    private static readonly CONFIG_FLAGS = "--config <path>";
    private static readonly CONFIG_HELP = `the network's config file, ${Cli.DEFAULT_CONFIG} in the working directory by default`;

    /** The directory of the config file. `.circuit/`, `.env` and secret files are found from here. */
    private readonly root: string;
    /** What Circuit writes, beside the config. */
    private readonly generated: string;
    private readonly stateDirectory: string;

    private constructor(
        private readonly configPath: string,
        private readonly network: Network,
        /** How a device is reached and what a plan sends: `apply`'s flags, the defaults for every other command. */
        private readonly options: ApplyOptions
    ) {
        this.root = dirname(configPath);
        this.generated = join(this.root, ".circuit");
        this.stateDirectory = join(this.generated, "state");
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

    /** Load the network from the config file `--config` names, or the one in the working directory. */
    private static async open(configArgument: string | undefined, flags: Partial<ApplyOptions> = {}): Promise<Cli> {
        const configPath = resolve(process.cwd(), configArgument ?? Cli.DEFAULT_CONFIG);

        if (!existsSync(configPath)) {
            Cli.fail(
                configArgument
                    ? `no config at ${configPath}`
                    : `no ${Cli.DEFAULT_CONFIG} in ${process.cwd()}; name another with --config <path>`
            );
        }

        Secrets.useRoot(dirname(configPath));

        const network = await Cli.load(configPath);
        const options: ApplyOptions = {
            secrets: flags.secrets ?? false,
            rollback: flags.rollback ?? 10,
            ...(flags.console ? { console: true } : {}),
        };

        return new Cli(configPath, network, options);
    }

    /** The config, a TypeScript file. Bun imports it as it is; Node needs jiti, which also resolves imports written without an extension. */
    private static async load(path: string): Promise<Network> {
        if (process.versions.bun) return (await import(path)).default;

        const { createJiti } = await import("jiti");
        return createJiti(import.meta.url).import(path, { default: true });
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
            .usage("<command> [device...] [options]")
            .showHelpAfterError("(add --help to see what it takes)");

        program
            .command("new")
            .description("start a project from a pattern, asking what it needs")
            .argument("[directory]", "where to create it")
            .option("--pattern <name>", "single-site, edge-router or colocation")
            .option("--asn <number>", "your AS number, for edge-router and colocation")
            .option("--1password", "write .env with 1Password references instead of empty values")
            .option("--use <manager>", "npm, pnpm or bun; the one that ran this by default")
            .option("--no-install", "do not install the dependencies")
            .action(async (directory, flags) => {
                const { Scaffold } = await import("./new");
                const options: ScaffoldOptions = {
                    pattern: flags.pattern,
                    asn: flags.asn,
                    onePassword: flags["1password"],
                    use: flags.use,
                    install: flags.install,
                };

                await Scaffold.create(directory, options);
                process.exit(0);
            });

        program
            .command("validate")
            .description("check the config, then every rule in checks")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (flags) => (await Cli.open(flags.config)).validate());

        program
            .command("build")
            .description("print the configuration the device should run, without contacting it")
            .argument("<device>")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (device, flags) => (await Cli.open(flags.config)).build(device));

        program
            .command("diff")
            .description("what apply would send, planned against the last snapshot, offline")
            .argument("[device...]", "every device when none is named")
            .option("--secrets", "plan as apply --secrets would, sending every secret again")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (devices, flags) => (await Cli.open(flags.config, flags)).diff(devices));

        program
            .command("snapshot")
            .description("read what each device runs into the state directory")
            .argument("[device...]", "every device when none is named")
            .option("--console", "through the device's serial console on its jump host, instead of SSH")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (devices, flags) => (await Cli.open(flags.config, flags)).snapshot(devices));

        program
            .command("apply")
            .description("read the device, plan against what it runs, and send with --confirm")
            .argument("<device>")
            .option("--confirm", "send the plan; without it, nothing is sent")
            .option("--secrets", "also send every secret, to rotate one")
            .option("--rollback <minutes>", "minutes before a device that can restore itself does", Cli.minutes, 10)
            .option("--console", "through the device's serial console on its jump host, instead of SSH")
            .option("--force", "send even when the pings before --confirm find a path that loses too much or is too slow")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (device, flags) =>
                (await Cli.open(flags.config, flags)).apply(device, flags.confirm ?? false, flags.force ?? false)
            );

        program
            .command("show")
            .description("run commands that only read on a device and print what it answers, secrets hidden")
            .argument("<device>")
            .argument("[command...]", "each command in quotes, such as '/ip route print'")
            .option("--file <path>", "also each line of this file; blank lines and lines starting with # are skipped")
            .option("--timeout <seconds>", "how long each command may take", Cli.seconds, 90)
            .option("--console", "through the device's serial console, instead of SSH")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (device, commands, flags) =>
                (await Cli.open(flags.config, flags)).show(device, commands, flags.file, flags.timeout)
            );

        program
            .command("bgp")
            .description("each BGP neighbor in the config next to its live session: up or down and why, prefixes, uptime")
            .argument("[device]", "may be left out when only one device has BGP neighbors")
            .argument("[name-regex]", "only the neighbors whose name matches")
            .option(
                "--wait [count]",
                `read again every ${BgpWait.COMMAND.every} seconds until every neighbor shown, or this many, is up`,
                Cli.count
            )
            .option("--max <seconds>", "how long --wait waits at most", Cli.seconds, BgpWait.COMMAND.seconds)
            .option("--log [minutes]", "also print the device's BGP log lines from the last minutes, 5 by default", Cli.minutes)
            .option("--clear-limit", "open again the neighbors shown that closed on their prefix limit; any other is left alone")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (first, second, flags) => (await Cli.open(flags.config)).bgp(first, second, flags));

        program
            .command("console")
            .description("open a device's serial console here, logged in; or send it lines and print what it answers")
            .argument("<device>")
            .argument("[line...]", "lines to send, each in quotes; none joins the console to this terminal, Ctrl-] leaves")
            .option("--raw", "do not log in or out: only join the console, or send the lines")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (device, lines, flags) => (await Cli.open(flags.config)).console(device, lines, flags.raw ?? false));

        program
            .command("refresh")
            .description("fetch prefix sets that come from a registry onto the device, with --confirm")
            .argument("<device>")
            .option("--confirm", "put them on the device; without it, nothing is sent")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (device, flags) => (await Cli.open(flags.config)).refresh(device, flags.confirm ?? false));

        program
            .command("wireguard")
            .description("a client config for one peer, its private key left for the peer to fill")
            .argument("<device>")
            .argument("<interface>")
            .argument("<peer>")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (device, iface, peer, flags) => (await Cli.open(flags.config)).wireguard(device, iface, peer));

        program
            .command("communities")
            .description("the network's BGP communities, one per line, for a looking glass or bgp.tools")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (flags) => (await Cli.open(flags.config)).communities());

        program
            .command("peeringdb")
            .description("bring PeeringDB's exchange records in line with the config, with --confirm")
            .option("--confirm", "send the changes; without it, nothing is sent")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (flags) => (await Cli.open(flags.config)).peeringdb(flags.confirm ?? false));

        program
            .command("librenms")
            .description("bring LibreNMS in line with the config, with --confirm")
            .option("--confirm", "send the changes; without it, nothing is sent")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (flags) => (await Cli.open(flags.config)).librenms(flags.confirm ?? false));

        program
            .command("netbox")
            .description("bring NetBox in line with the config, with --confirm")
            .option("--confirm", "send the changes; without it, nothing is sent")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (flags) => (await Cli.open(flags.config)).netbox(flags.confirm ?? false));

        program
            .command("prometheus")
            .description("every device with SNMP, as Prometheus targets for snmp_exporter")
            .option("--auths", "snmp_exporter's auths for them instead, with secrets as ${NAME}")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (flags) => (await Cli.open(flags.config)).prometheus(flags.auths ?? false));

        program
            .command("secrets")
            .description("every secret the config uses, and whether each can be read")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (flags) => (await Cli.open(flags.config)).secrets());

        program
            .command("rename")
            .description("give a device a new name in every file that names it, with --confirm")
            .argument("<device>")
            .argument("<new-name>")
            .option("--file", "also rename the file that declares it, to <new-name>.ts")
            .option("--confirm", "write the files; without it, nothing is written")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (from, to, flags) =>
                (await Cli.open(flags.config)).rename(from, to, flags.file ?? false, flags.confirm ?? false)
            );

        program
            .command("addresses")
            .description("every address the config uses, by prefix, and what is still free")
            .argument("[prefix]", "only the addresses in this prefix, such as 10.0.0.0/16")
            .option("--length <n>", "free prefixes of this length, instead of the fewest that cover the free space")
            .option("--format <format>", "json, to print JSON")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (within, flags) => (await Cli.open(flags.config)).addresses(within, flags.length, flags.format));

        program
            .command("graph")
            .description("the network as a graph, from the config alone, without contacting a device")
            .argument("[device...]", "only these devices and what they connect to")
            .option("--layer <layers>", `${Topology.LAYERS.join(", ")}, several with commas, or all`, "l1")
            .addOption(new Option("--format <format>", "how to print it").choices(["mermaid", "dot", "json"] as const).default("mermaid"))
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (devices, flags) => (await Cli.open(flags.config)).graph(devices, flags.layer, flags.format));

        program
            .command("studio")
            .description("Circuit Studio: the network in the browser, drawn again whenever the config changes")
            .option("--port <number>", "the port it listens on", "4600")
            .option("--no-open", "do not open the browser")
            .option("--host <address>", "listen on a server's address, such as 0.0.0.0, instead; needs --allow-host", "127.0.0.1")
            .option("--allow-host <names>", "the names it is reached by, such as studio.example.com, several with commas")
            .option("--json", "print what Studio shows, as JSON, instead")
            .option(Cli.CONFIG_FLAGS, Cli.CONFIG_HELP)
            .action(async (flags) => (await Cli.open(flags.config)).studio(flags));

        return program;
    }

    /** The devices with these names, or every device when none is named and `allByDefault`. */
    private selected(names: readonly string[], allByDefault: boolean): Device[] {
        if (!names.length && allByDefault) return [...this.network.devices];

        const known = this.network.devices.map((device) => device.name).join(", ");
        const byName = (name: string) => this.network.devices.find((device) => device.name === name);

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

    /** Record what a device runs, beside a note that the directory is generated. */
    private writeState(device: Device, text: string): void {
        mkdirSync(this.stateDirectory, { recursive: true });
        writeFileSync(join(this.generated, "README.md"), GENERATED_README);
        writeFileSync(this.statePath(device), text);
    }

    /** Each device's LLDP neighbors at its last snapshot, for the devices whose neighbors were read. */
    private neighbors(): Map<string, Neighbor[]> {
        const found = new Map<string, Neighbor[]>();

        for (const device of this.network.devices) {
            const neighbors = Cabling.load(this.stateDirectory, device.name);
            if (neighbors) found.set(device.name, neighbors);
        }

        return found;
    }

    /** What `validate` finds: the config's own findings, then where LLDP at the last snapshot disagrees with `link`. */
    private findings(): Finding[] {
        return [...Validator.run(this.network), ...Cabling.compare(this.network.devices, this.neighbors())];
    }

    /** Validate, print what was found, and stop on an error about one of these devices. `diff` and `apply` leave LLDP out: it is what was seen, not config. */
    private guard(devices: Device[], all: readonly Finding[] = Validator.run(this.network)): void {
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

    private validate(): void {
        this.guard([...this.network.devices], this.findings());
        console.log(`${this.network.devices.length} device(s), no errors.`);
    }

    private build(name: string): void {
        const device = this.one(name);
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
            const text = await adapter.read(device, this.network.devices, this.optionsFor(device));
            this.writeState(device, text);
            console.log(`${device.name}: ${text.split("\n").length} lines`);

            await this.snapshotNeighbors(device, adapter);
        }

        // With every device read, a snapshot of a device the config no longer has, such as one renamed, is removed.
        if (names.length || !existsSync(this.stateDirectory)) return;

        const current = new Set(
            this.network.devices.flatMap((device) => [
                basename(this.statePath(device)),
                basename(Cabling.path(this.stateDirectory, device.name)),
            ])
        );
        for (const file of readdirSync(this.stateDirectory)) {
            if (current.has(file)) continue;

            rmSync(join(this.stateDirectory, file));
            console.log(`${file}: removed, no such device in the config`);
        }
    }

    /** Save a device's LLDP neighbors beside its config, where its platform can read them. A device without LLDP is left alone. */
    private async snapshotNeighbors(device: Device, adapter: Platform): Promise<void> {
        if (!Cabling.runsAnywhere(device)) return;

        if (!adapter.neighbors) {
            Cabling.forget(this.stateDirectory, device.name);
            console.log(`${device.name}: LLDP neighbors not read, reading them on ${device.platform} is not proved on a device yet`);
            return;
        }

        const neighbors = await adapter.neighbors(device, this.network.devices, this.optionsFor(device));
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
        const live = await adapter.read(device, this.network.devices, this.optionsFor(device));
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

        await adapter.apply(device, this.network.devices, plan, this.optionsFor(device));

        this.writeState(device, await adapter.read(device, this.network.devices, this.optionsFor(device)));
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
                process.stdout.write(Secrets.scrub(block, { network: this.network }));

                // A shell or a console still runs a command that did not finish, so nothing more can be sent.
                if (failed) break;
            }
        } finally {
            session.close();
        }

        if (failed) process.exitCode = 1;
    }

    /**
     * Each BGP neighbor in the config next to its live session. `first` is the device, or, when it names none and only one device has BGP neighbors, the name pattern. With `wait`, reads again until every neighbor shown, or that many, is up, and fails when time runs out. With `clearLimit`, opens again the neighbors shown that closed on their prefix limit, and fails when none did.
     */
    private async bgp(
        first: string | undefined,
        second: string | undefined,
        flags: { wait?: true | number; max: number; log?: true | number; clearLimit?: true }
    ): Promise<void> {
        const { device, pattern } = this.bgpTarget(first, second);
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

    /** The device `circuit bgp` reads, and the name pattern, from its two optional arguments. */
    private bgpTarget(first: string | undefined, second: string | undefined): { device: Device; pattern: string | undefined } {
        if (second !== undefined || (first && this.network.devices.some((device) => device.name === first))) {
            return { device: this.one(first!), pattern: second };
        }

        const withBgp = this.network.devices.filter((device) => Object.keys(device.routing?.bgp?.neighbors ?? {}).length);
        const named = first ? `no device ${first}, and ` : "";

        if (withBgp.length === 1) return { device: withBgp[0]!, pattern: first };
        if (!withBgp.length) Cli.fail(`${named}no device has BGP neighbors`);

        return Cli.fail(`${named}several devices have BGP neighbors, so name one: ${withBgp.map((device) => device.name).join(", ")}`);
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

        process.stdout.write(Secrets.scrub(text, { network: this.network }));
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
                await SerialConsole.login(opened.channel, dialect, login.user, login.password, serial.passwordOnly);
            } catch (error) {
                console.error(`${device.name}: ${(error as Error).message}`);
                await leave(1);
            }
            loggedIn = true;
        }

        if (lines.length) {
            await ConsoleScript.run(opened.channel, lines, (answer) =>
                process.stdout.write(Secrets.scrub(answer, { network: this.network }))
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

        for (const [name, set] of Object.entries(device.prefix_sets ?? {})) {
            if (!("source" in set)) continue;

            const { registry, query, family } = set.source;
            const prefixes = await Registries.prefixes(registry, query, family);

            // An empty or absurd answer is a broken feed, not a policy.
            if (prefixes.length < 1 || prefixes.length > 100_000) {
                Cli.fail(`${name}: ${prefixes.length} prefixes from ${registry}, refusing`);
            }

            console.log(`${name}: ${prefixes.length} prefixes from ${registry} ${query}`);
            if (confirmed) await fill(device, this.network.devices, name, family, prefixes);
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

        const iface = device.interfaces?.[interfaceName];
        if (iface?.type !== "wireguard") Cli.fail(`${deviceName} has no WireGuard interface ${interfaceName}`);

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
        const communities = this.network.communities ?? Cli.fail("the network declares no communities");

        for (const { community, description } of communities) {
            // The format splits each line at its first comma.
            if (community.includes(",")) Cli.fail(`community ${community} holds a comma`);
            console.log(`${community},${description}`);
        }
    }

    private async peeringdb(confirmed: boolean): Promise<void> {
        const plan = await PeeringDb.plan(this.network);

        for (const name of plan.unknown) {
            console.log(`  PeeringDB lists ${name}, which the config does not. Remove it by hand if the network left.`);
        }

        for (const change of plan.changes) console.log(`  ${change.summary}`);

        if (!plan.changes.length) {
            console.log("PeeringDB matches the config.");
            return;
        }

        if (!confirmed) {
            console.log("\nNothing sent. Re-run with --confirm.");
            return;
        }

        await PeeringDb.send(this.network, plan.changes);
    }

    private async librenms(confirmed: boolean): Promise<void> {
        const plan = await LibreNms.plan(this.network);

        for (const hostname of plan.unknown)
            console.log(`  LibreNMS monitors ${hostname}, which the config does not. Remove it by hand if it is gone.`);
        for (const device of plan.withoutSnmp)
            console.log(`  ${device.name} has no SNMP in its config, so LibreNMS cannot poll it. Add management.snmp first.`);
        for (const name of plan.dynamicGroups)
            console.log(`  LibreNMS's group ${name} is dynamic, so Circuit cannot fill it. Make it static, or rename it.`);

        for (const device of plan.additions) console.log(`  + ${device.name}, ${device.connection.host}`);
        for (const change of plan.changes) console.log(`  ~ ${change.device.name}: ${change.what.join(", ")}`);

        for (const group of plan.groups) {
            const names = (devices: readonly Device[]) => devices.map((device) => device.name).join(", ");

            if (group.create) console.log(`  + group ${group.name}: ${names(group.add)}`);
            if (!group.create && group.add.length) console.log(`  ~ group ${group.name}: add ${names(group.add)}`);
            if (!group.create && group.remove.length) console.log(`  ~ group ${group.name}: remove ${names(group.remove)}`);
        }

        if (!LibreNms.count(plan)) {
            console.log("LibreNMS matches the config.");
            return;
        }

        if (!confirmed) {
            console.log("\nNothing sent. Re-run with --confirm.");
            return;
        }

        await LibreNms.send(this.network, plan);
    }

    private async netbox(confirmed: boolean): Promise<void> {
        const netbox = new NetBox(this.network);
        const plan = await netbox.plan();

        Cli.showNetBox(plan);

        if (!NetBox.count(plan)) {
            console.log("NetBox matches the config.");
            return;
        }

        if (!confirmed) {
            console.log("\nNothing sent. Re-run with --confirm.");
            return;
        }

        const left = await netbox.send(plan);
        if (!NetBox.count(left)) return;

        console.log("\nNetBox still differs:");
        Cli.showNetBox(left);
        process.exit(1);
    }

    /** Each change NetBox would get, then how many of each kind. */
    private static showNetBox(plan: NetBoxPlan): void {
        for (const item of plan.leftAlone) console.log(`  ${item} exists without the tag ${NetBox.TAG}: left alone`);
        for (const change of plan.creates) console.log(`  + ${change.path} ${change.key}`);

        for (const change of plan.updates) {
            console.log(`  ~ ${change.path} ${change.key}`);
            for (const line of change.diff) console.log(`      ${line}`);
        }

        for (const change of plan.deletes) console.log(`  - ${change.path} ${change.key}`);

        const paths = [...new Set([...plan.creates, ...plan.updates, ...plan.deletes].map((change) => change.path))];
        const count = (changes: readonly { path: string }[], path: string) => changes.filter((change) => change.path === path).length;

        if (paths.length) console.log("");

        for (const path of paths) {
            console.log(
                `  ${path}: ${count(plan.creates, path)} to create, ${count(plan.updates, path)} to change, ${count(plan.deletes, path)} to delete`
            );
        }
    }

    private prometheus(auths: boolean): void {
        if (auths) {
            const { yaml, notes } = Prometheus.snmpExporterAuths(this.network);
            for (const note of notes) console.error(note);
            process.stdout.write(yaml);
            return;
        }

        const { targets, withoutSnmp } = Prometheus.targets(this.network);
        for (const device of withoutSnmp) console.error(`${device.name} has no SNMP in its config; left out`);
        console.log(JSON.stringify(targets, null, 4));
    }

    private secrets(): void {
        const references = [
            ...Secrets.referencesIn([this.network.devices, this.network.peeringdb, this.network.librenms, this.network.netbox]),
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

    /** How a device compares with its last snapshot, offline, as `diff` plans it. */
    private driftOf(device: Device): Drift {
        const path = this.statePath(device);
        if (!existsSync(path)) return { status: "no snapshot", lines: [] };

        try {
            const adapter = this.adapterOf(device);
            const plan = adapter.plan(adapter.render(device), readFileSync(path, "utf8"), this.options);

            const lines = [
                ...plan.steps.flatMap((step) => [step.title, ...step.show.map((line) => `  ${line}`)]),
                ...plan.problems.map((problem) => `PROBLEM ${problem}`),
            ];

            return { status: lines.length ? "differs" : "matches", lines };
        } catch (error) {
            return { status: "cannot plan", lines: [(error as Error).message] };
        }
    }

    /** The graph on these layers, around these devices when any are named, with what validate found and how each device drawn compares with its snapshot. */
    private annotatedGraph(layers: readonly Layer[], deviceNames: readonly string[]): Annotated {
        const graph = Topology.only(Topology.of(this.network.devices), layers, deviceNames);
        const shown = new Set(graph.nodes.map((node) => node.label));

        return {
            ...graph,
            findings: this.findings().filter((finding) => !finding.device || shown.has(finding.device)),
            drift: Object.fromEntries(
                this.network.devices.filter((device) => shown.has(device.name)).map((device) => [device.name, this.driftOf(device)])
            ),
        };
    }

    private graph(names: string[], layer: string, format: string): void {
        const requested = layer.split(",");
        const layers = requested.includes("all") ? [...Topology.LAYERS] : (requested as Layer[]);

        const unknown = layers.filter((layer) => !Topology.LAYERS.includes(layer));
        if (unknown.length) Cli.fail(`no layer ${unknown.join(", ")}; known: ${Topology.LAYERS.join(", ")}, all`);

        const devices = this.selected(names, true);
        const annotated = this.annotatedGraph(layers, names.length ? devices.map((device) => device.name) : []);

        if (format === "mermaid") process.stdout.write(GraphFormat.mermaid(annotated));
        else if (format === "dot") process.stdout.write(GraphFormat.dot(annotated));
        else if (format === "json") console.log(JSON.stringify(annotated, null, 4));
        else Cli.fail(`no format ${format}; known: mermaid, dot, json`);
    }

    /** One segment and what uses each address in it. */
    private static printSegment(segment: Segment, indent: string): void {
        const next = segment.next ? `, next ${segment.next}` : "";
        console.log(`${indent}${segment.prefix}, ${segment.free} free${next}`);

        const width = Math.max(...segment.uses.map((use) => use.address.length)) + 2;
        for (const use of segment.uses) console.log(`${indent}    ${use.address.padEnd(width)}${use.what}`);
    }

    private addresses(within: string | undefined, lengthText: string | undefined, format: string | undefined): void {
        if (within && !Address.isCidr(within)) Cli.fail(`${within} is not a prefix, such as 10.0.0.0/16`);

        const length = lengthText === undefined ? undefined : Number(lengthText);
        if (length !== undefined && !(Number.isInteger(length) && length >= 0 && length <= 128))
            Cli.fail("--length takes a prefix length, such as 24");

        const report = AddressSpace.report(this.network.devices, within);

        if (format === "json") {
            console.log(JSON.stringify(report, null, 4));
            return;
        }

        for (const space of report.spaces) {
            console.log(`${space.prefix}, ${space.owner}`);
            for (const segment of space.segments) Cli.printSegment(segment, "  ");
            for (const block of space.blocks) console.log(`  ${block.prefix}  ${block.what}`);

            if (length === undefined) {
                console.log(`  free: ${space.free.join(", ") || "none"}`);
            } else {
                const { prefixes, total } = AddressSpace.freeOfLength(space.free, length, 16);
                const more = total > BigInt(prefixes.length) ? `, and ${total - BigInt(prefixes.length)} more` : "";
                console.log(`  free /${length}: ${prefixes.join(", ") || "none"}${more}`);
            }

            console.log("");
        }

        const { segments, blocks } = report.elsewhere;
        if (segments.length || blocks.length) {
            console.log("Outside the space the network originates");
            for (const segment of segments) Cli.printSegment(segment, "  ");
            for (const block of blocks) console.log(`  ${block.prefix}  ${block.what}`);
        }

        if (!report.spaces.length && !segments.length && !blocks.length) console.log("The config holds no addresses.");
    }

    private rename(from: string, to: string, file: boolean, confirmed: boolean): void {
        const device = this.network.devices.find((candidate) => candidate.name === from);
        if (!device) Cli.fail(`no device ${from}; known: ${this.network.devices.map((candidate) => candidate.name).join(", ")}`);
        if (this.network.devices.some((candidate) => candidate.name === to)) Cli.fail(`${to} is already a device`);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(to)) Cli.fail(`${to} is not a hostname: letters, digits, dots, dashes and underscores`);

        const files = [this.statePath(device), Cabling.path(this.stateDirectory, device.name)];
        const snapshots = files.filter((file) => existsSync(file)).map((file) => relative(this.root, file));

        let plan: RenamePlan;
        try {
            plan = Rename.plan(this.root, from, to, { file, snapshots });
        } catch (error) {
            Cli.fail((error as Error).message);
        }

        for (const change of plan.changes) {
            console.log(`${change.file}:${change.line}`);
            console.log(`  - ${change.before.trim()}`);
            console.log(`  + ${change.after.trim()}`);
        }

        for (const move of plan.moves) console.log(`move ${move.from} to ${move.to}`);

        if (plan.mentions.length) {
            console.log(`\nStill naming ${from}, left as they are: change them by hand if they mean the device.`);
            for (const mention of plan.mentions) console.log(`  ${mention.file}:${mention.line}  ${mention.text.slice(0, 160)}`);
        }

        if (!confirmed) {
            console.log("\nNothing written. Re-run with --confirm.");
            return;
        }

        Rename.apply(this.root, plan);
        console.log(`\nRenamed. Run circuit validate, then circuit apply ${to}: the device keeps its old hostname until then.`);
    }

    private async studio(flags: { port: string; open: boolean; host: string; allowHost?: string; json?: true }): Promise<void> {
        if (flags.json) {
            const sources = ProjectFiles.sources(this.root);
            const data = StudioModel.build(this.network.devices, this.annotatedGraph(Topology.LAYERS, []), {
                render: (device) => this.adapterOf(device).render(device),
                snapshot: (device) => (existsSync(this.statePath(device)) ? readFileSync(this.statePath(device), "utf8") : undefined),
                files: (device) => ({
                    // Written with forward slashes on every system, as git and the page take them.
                    source: ProjectFiles.deviceFiles(this.root, device.name, sources)[0]?.split(sep).join("/"),
                    snapshot: existsSync(this.statePath(device))
                        ? relative(this.root, this.statePath(device)).split(sep).join("/")
                        : undefined,
                }),
            });
            console.log(JSON.stringify(data));
            return;
        }

        const port = Number(flags.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) Cli.fail("--port takes a number from 1 to 65535");

        const { StudioServer } = await import("../studio/server");
        const host = flags.host;
        const allowHosts = (flags.allowHost ?? "").split(",").filter(Boolean);

        // Off this machine, Studio must be told the names it is reached by: every other name is refused.
        if (!StudioServer.isLoopback(host) && !allowHosts.length) {
            Cli.fail(`Studio on ${host} needs --allow-host=<name>, the name people reach it by, such as studio.example.com`);
        }

        await StudioServer.start({
            configPath: this.configPath,
            root: this.root,
            port,
            open: flags.open,
            host,
            allowHosts,
        });
    }
}

await Cli.main(process.argv.slice(2));
