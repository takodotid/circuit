#!/usr/bin/env bun

import { Command, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { Installation } from "../core/installation";
import { OnePassword } from "../core/one-password";
import { SecretsFile } from "../core/secrets-file";
import { BgpWait } from "../platforms/bgp-wait";
import { Ssh } from "../transport/ssh";
import { App } from "./app";
import { Communities } from "./communities";
import { SecretCommands } from "./secret-commands";
import { GitHooks } from "./git-hooks";
import { Migrate } from "./migrate";
import { ProjectCommands } from "./project-commands";
import { Releases } from "./releases";
import { SecretsAgent } from "./secrets-agent";
import { Remember } from "./remember";
import { Format } from "./format";
import { Setup } from "./setup";
import { Versions } from "./versions";
import { Ui } from "./ui";
import type { Choice } from "./ui";
import { VERSION } from "./version";

class Cli {
    /** Commands the manager runs itself, whatever version a project pins. */
    private static readonly APP_COMMANDS = new Set(["update", "uninstall", "new"]);

    /** `exec --timeout`'s default. */
    private static readonly EXEC_TIMEOUT_SECONDS = 90;

    private static readonly STUDIO_PORT = 4600;
    private static readonly MAX_PORT = 65535;

    /** The number a flag's error gives as an example, for a flag without a default. */
    private static readonly EXAMPLE = { sessions: 4, maxSeconds: 90, prefixLength: 24 };

    static async main(argv: string[]): Promise<void> {
        const command = argv[0];
        if (command === SecretsAgent.COMMAND) return SecretsAgent.serve();
        // This binary's own version and nothing else: no update, no project's version. The installers read it to learn which Circuit is installed.
        if (command === "--version" || command === "-V") return console.log(VERSION);
        Releases.tidy();
        OnePassword.waiting = (message) => Ui.blocked(message);
        Ssh.report = (message, refused) => (refused ? Ui.warn(message) : console.log(Ui.dim(`   ${message}`)));
        Ssh.waiting = (message) => Ui.blocked(message);

        // The manager keeps itself current before every command but `uninstall`. A version it started, or Studio's own reads, leave that to it.
        if (command !== "uninstall" && !Versions.started() && !process.env.CIRCUIT_LOCAL) await Releases.check(argv);

        if (!Cli.APP_COMMANDS.has(command ?? "")) {
            Cli.runLocal(argv);
            const root = ProjectCommands.find();
            if (root) {
                if (Installation.binary()) Versions.remember(root);
                await Versions.run(root, argv);
            }
        }

        const program = Cli.program();
        if (!argv.length) {
            if (!Ui.interactive) {
                program.outputHelp();
                return;
            }
            argv = await Cli.menu();
        }

        await Remember.load();
        await program.parseAsync(argv, { from: "user" });
        await Remember.offer();
    }

    /** In a project with a full install, run the Circuit pinned in it instead of this one, so a team runs one version. */
    private static runLocal(argv: string[]): void {
        if (process.env.CIRCUIT_LOCAL || !Installation.binary()) return;

        const root = ProjectCommands.find();
        const local = root && Setup.localCircuit(root);
        if (!local) return;

        const result = spawnSync("bun", [local, ...argv], { stdio: "inherit", env: { ...process.env, CIRCUIT_LOCAL: "1" } });
        if (result.error)
            Ui.fail(
                `This project runs Circuit ${Setup.pinned(root) ?? ""} with Bun, and Bun is not installed. Install it from https://bun.sh.`
            );
        process.exit(result.status ?? 1);
    }

    /** A flag's parser for a whole number of `unit`, at least 1. */
    private static whole(unit: string, example: number) {
        return (value: string): number => {
            const number = Number(value);
            if (!Number.isInteger(number) || number < 1)
                throw new InvalidArgumentError(`Give a whole number of ${unit}, such as ${example}.`);
            return number;
        };
    }

    private static program() {
        const program = new Command("circuit")
            .description("Describe each network device in TypeScript, see what would change, then make the device match.")
            .version(VERSION)
            .usage("[command] [device] [options]")
            .showHelpAfterError("(add --help to see the options)");

        program.commandsGroup("Core:");

        program
            .command("validate")
            .description("check the whole project, without touching a device")
            .option("--experimental", "allow features not yet tested on a real device (as warnings)")
            .action(async (flags) => (await ProjectCommands.open(flags)).validate());

        program
            .command("diff")
            .description("show what apply would change on a device, without sending anything")
            .argument("[device]", "if left out, you pick from a list")
            .option("--secrets", "plan with every secret sent again, as apply --secrets does")
            .option("--console", "connect through the device's serial console on its jump host, not SSH")
            .option("--experimental", "allow features not yet tested on a real device (as warnings)")
            .action(async (device, flags) => (await ProjectCommands.open(flags)).diff(device));

        program
            .command("apply")
            .description("show what would change on a device, then send it when you say yes")
            .argument("[device]", "if left out, you pick from a list")
            .option("--confirm", "send without asking")
            .option("--secrets", "also send every secret, to change a password")
            .option(
                "--rollback <minutes>",
                "RouterOS, Junos, and FortiOS: minutes before the device undoes the change if Circuit can't log back in",
                Cli.whole("minutes", ProjectCommands.ROLLBACK_MINUTES),
                ProjectCommands.ROLLBACK_MINUTES
            )
            .option("--console", "connect through the device's serial console on its jump host, not SSH")
            .option("--force", "send even if the network path to the device is lossy or slow")
            .option("--experimental", "allow features not yet tested on a real device (as warnings)")
            .action(async (device, flags) =>
                (await ProjectCommands.open(flags)).apply(device, flags.confirm ?? false, flags.force ?? false)
            );

        program.commandsGroup("Utilities:");

        program
            .command("exec")
            .alias("execute")
            .description("run read-only commands on a device and print the output, with secrets hidden")
            .argument("[device]", "if left out, you pick from a list")
            .argument("[command...]", "each command in quotes, such as '/ip route print'")
            .option("--file <path>", "also run each line of this file, except blank lines and lines starting with #")
            .option(
                "--timeout <seconds>",
                "the time limit for each command, in seconds",
                Cli.whole("seconds", Cli.EXEC_TIMEOUT_SECONDS),
                Cli.EXEC_TIMEOUT_SECONDS
            )
            .option("--console", "connect through the device's serial console on its jump host, not SSH")
            .action(async (device, commands, flags) =>
                (await ProjectCommands.open(flags)).exec(device, commands, flags.file, flags.timeout)
            );

        program
            .command("bgp")
            .description("show each BGP neighbor's live session: up or down, why, prefixes, and uptime")
            .argument("[device]", "if left out, the only device with BGP neighbors, or you pick one")
            .option("--neighbors <regex>", "show only the neighbors whose name matches this regular expression")
            .option(
                "--wait [count]",
                `check again every ${BgpWait.COMMAND.every} seconds until all neighbors shown, or this many, are up`,
                Cli.whole("sessions", Cli.EXAMPLE.sessions)
            )
            .option(
                "--max <seconds>",
                "the longest time --wait waits, in seconds",
                Cli.whole("seconds", Cli.EXAMPLE.maxSeconds),
                BgpWait.COMMAND.seconds
            )
            .option(
                "--log [minutes]",
                "also print the BGP log of the last few minutes (default: 5)",
                Cli.whole("minutes", ProjectCommands.BGP_LOG_MINUTES)
            )
            .option("--clear-limit", "clear the sessions shown that closed on their prefix limit")
            .action(async (device, flags) => (await ProjectCommands.open()).bgp(device, flags));

        program
            .command("addresses")
            .description("show the address space the project uses, and what is free")
            .argument("[prefix]", "show only this prefix; if left out, all the space your networks own")
            .option("--length <n>", "list the free prefixes of this length instead", Cli.whole("length", Cli.EXAMPLE.prefixLength))
            .addOption(new Option("--format <format>", "text, or json for a script").choices(["text", "json"] as const).default("text"))
            .action(async (prefix, flags) => (await ProjectCommands.open()).addresses(prefix, flags.length, flags.format));

        program
            .command("sync")
            .description("update NetBox, LibreNMS, PeeringDB, or Prometheus to match the project")
            .argument("[target]", "netbox, librenms, peeringdb, or prometheus; if left out, you pick from a list")
            .option("--confirm", "send without asking")
            .action(async (target, flags) => (await ProjectCommands.open()).sync(target, flags.confirm ?? false));

        program
            .command("communities")
            .description("print what each BGP community means, for a looking glass or bgp.tools")
            .argument("[network]", "the network in circuit.ts, needed only if several have communities")
            .addOption(
                new Option(
                    "--format <format>",
                    "nlnog: community,description lines; alice: an Alice-LG [bgp_communities] section; json: the IETF YANG model"
                )
                    .choices(Communities.FORMATS)
                    .default("nlnog")
            )
            .action(async (network, flags) => (await ProjectCommands.open()).communities(network, flags.format));

        program
            .command("access-console")
            .description("open a device's serial console, logged in, or send it lines and print the output")
            .argument("[device]", "if left out, you pick from a list")
            .argument("[line...]", "lines to send, each in quotes; with none, the console opens here and Ctrl-] leaves")
            .option("--raw", "don't log in or out")
            .action(async (device, lines, flags) => (await ProjectCommands.open()).accessConsole(device, lines, flags.raw ?? false));

        program
            .command("studio")
            .description("open the project in Circuit Studio, in your browser")
            .option("--port <number>", "the port to listen on", Cli.port, Cli.STUDIO_PORT)
            .option("--host <address>", "the address to listen on; give a server's address to share Studio", "127.0.0.1")
            .option("--allow-host <names...>", "other host names Studio answers to, such as studio.example.com behind a proxy")
            .option("--no-open", "don't open the browser")
            .action(async (flags) => Cli.studio(flags));

        program
            .command("rename")
            .description("rename a device everywhere in the project")
            .argument("[device]", "if left out, you pick from a list")
            .argument("[new-name]", "if left out, Circuit asks")
            .option("--file", "also rename the device's file")
            .option("--no-file", "keep the device's file name")
            .option("--confirm", "write without asking")
            .action(async (device, name, flags) => (await ProjectCommands.open()).rename(device, name, flags.file, flags.confirm ?? false));

        program
            .command("fmt")
            .description("tidy spacing and line breaks in the project's .ts files; nothing else changes")
            .argument("[file...]", "if left out, every .ts file of the project")
            .option("--check", "change nothing; fail if a file needs tidying")
            .action(async (files, flags) => Format.run(ProjectCommands.findOrFail(), files, flags.check ?? false));

        program.commandsGroup("Secrets:");

        const FILE_FLAGS = "--file <path>";
        const FILE_HELP = "use this secrets file instead of .circuit/secrets";
        // `--file` after a command, such as `circuit secrets list --file x`, lands on `secrets` itself, so each command reads it from there too.
        const secrets = program
            .command("secrets")
            .alias("secret")
            .description("the project's encrypted secrets; alone, opens them in an editor")
            .option(FILE_FLAGS, FILE_HELP)
            .action(async (flags) => {
                const commands = await SecretCommands.open(flags.file);
                if (Ui.interactive) await commands.edit();
                else commands.list();
            });
        secrets
            .command("edit")
            .description("open every secret in an editor in the terminal")
            .option(FILE_FLAGS, FILE_HELP)
            .action(async (flags) => (await SecretCommands.open(flags.file ?? secrets.opts().file)).edit());
        secrets
            .command("list")
            .description("list every secret, how it is stored, and the ones the config needs but the file lacks")
            .option(FILE_FLAGS, FILE_HELP)
            .action(async (flags) => (await SecretCommands.open(flags.file ?? secrets.opts().file)).list());
        secrets
            .command("get")
            .description("print one secret, decrypted")
            .argument("[name]")
            .option(FILE_FLAGS, FILE_HELP)
            .action(async (name, flags) => (await SecretCommands.open(flags.file ?? secrets.opts().file)).get(name));
        secrets
            .command("set")
            .description("add or change a secret; leave out the value to type it hidden")
            .argument("[name]")
            .argument("[value]", "an op://vault/item/field reference keeps the value in 1Password")
            .option(FILE_FLAGS, FILE_HELP)
            .action(async (name, value, flags) => (await SecretCommands.open(flags.file ?? secrets.opts().file)).set(name, value));
        secrets
            .command("delete")
            .description("delete a secret")
            .argument("[name]")
            .option("--confirm", "delete without asking")
            .option(FILE_FLAGS, FILE_HELP)
            .action(async (name, flags) =>
                (await SecretCommands.open(flags.file ?? secrets.opts().file)).delete(name, flags.confirm ?? false)
            );
        secrets
            .command("encrypt")
            .description("encrypt every plain-text value in the file")
            .option(FILE_FLAGS, FILE_HELP)
            .action(async (flags) => (await SecretCommands.open(flags.file ?? secrets.opts().file)).encrypt());
        secrets
            .command("password")
            .description("change the password of the secrets file; the old one stops working")
            .option("--1password <reference>", "read the password from 1Password, such as op://vault/item/field, instead of asking")
            .option("--forget-1password", "stop reading the password from 1Password")
            .option("--confirm", "change without asking, to the value of CIRCUIT_SECRETS_NEW_PASSWORD")
            .option(FILE_FLAGS, FILE_HELP)
            .action(async (flags) =>
                (await SecretCommands.open(flags.file ?? secrets.opts().file)).password({
                    ...(flags["1password"] !== undefined ? { onePassword: flags["1password"] } : {}),
                    forgetOnePassword: flags.forget1password ?? false,
                    confirm: flags.confirm ?? false,
                })
            );

        secrets
            .command("forget")
            .description("forget every remembered secret now")
            .action(async () => Remember.forget());

        program.commandsGroup("Circuit:");

        program
            .command("update")
            .description("move the project to a newer Circuit you pick; outside a project, update the app")
            .option("--app", "update the installed app, even in a project")
            .option("--confirm", "update to the newest without asking")
            .action(async (flags) => Cli.update(flags.app ?? false, flags.confirm ?? false));

        program
            .command("new")
            .description("start a new project")
            .argument("[folder]", "if left out, Circuit asks")
            .option("--full", "install Circuit as a package in the project, run with bun circuit")
            .action(async (folder, flags) => Setup.run(folder, { existing: "refuse", ...(flags.full ? { kind: "full" as const } : {}) }));

        program
            .command("uninstall")
            .description("remove Circuit from this machine; your projects stay")
            .option("--confirm", "remove without asking")
            .action(async (flags) => App.uninstall(flags.confirm ?? false));

        program
            .command("migrate")
            .description("convert a Circuit 0.x project to v1, and list what did not move")
            .argument("<v0-folder>", "the 0.x project, with its packages installed")
            .option("--out <folder>", "an empty folder for the v1 project; <v0-folder>-v1 by default")
            .option("--config <file>", "0.x's config file in that folder", "circuit.config.ts")
            .option(
                "--yes",
                "copy the 0.x project's .env into the secrets without asking; the password comes from CIRCUIT_SECRETS_PASSWORD"
            )
            .action(async (folder, flags) => Migrate.run(folder, { ...flags, yes: flags.yes ?? false }));

        program
            .command("setup", { hidden: true })
            .description("what the installer runs: set up the project in a folder, or offer to start one")
            .argument("[folder]")
            .action(async (folder) => Setup.run(folder, { existing: "ready" }));

        program
            .command("studio-data", { hidden: true })
            .description("what Studio shows of the project, as JSON: Studio runs it to read the project fresh")
            .argument("<folder>")
            .action(async (folder) => {
                const { StudioModel } = await import("../studio/data");
                process.stdout.write(JSON.stringify(await StudioModel.gather(folder)));
            });

        program
            .command("hook", { hidden: true })
            .description("what the project's git hooks run")
            .argument("<name>", "pre-commit")
            .action(async (name) => Cli.hook(name));

        return program;
    }

    private static port(value: string): number {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > Cli.MAX_PORT)
            throw new InvalidArgumentError("Give a port from 1 to 65535, such as 4600.");
        return port;
    }

    private static async studio(flags: { port: number; host: string; allowHost?: string[]; open: boolean }): Promise<void> {
        const root = ProjectCommands.findOrFail();
        Setup.prepare(root);

        // Studio carries its page, so it is loaded only when asked for.
        const { StudioServer } = await import("../studio/server");
        const url = await Ui.step("Starting Studio", () =>
            StudioServer.start({ root, port: flags.port, host: flags.host, allowHosts: flags.allowHost ?? [] })
        );
        const local = StudioServer.isLoopback(flags.host);

        Ui.done(`Circuit Studio is at ${url}${local ? "" : `, listening on ${flags.host}:${flags.port}`}. Stop it with Ctrl+C.`);
        if (!local) Ui.warn("Anyone who can reach this address sees the project. Put Studio behind a proxy that asks people to log in.");
        if (flags.open && local) StudioServer.openBrowser(url);
    }

    /** In a project, moves it to a version the person picks. Elsewhere, or with `--app`, updates the app. Either way, versions no project pins any more are removed. */
    private static async update(app: boolean, confirmed: boolean): Promise<void> {
        const root = ProjectCommands.find();
        if (root && Installation.binary()) Versions.remember(root);
        if (app || !root) {
            const target = await Releases.updateApp(confirmed);
            Versions.prune(target ?? VERSION);
            return;
        }

        const packaged = Setup.pinned(root);
        if (!packaged) {
            await Versions.updateProject(root, confirmed);
            return;
        }

        // A full install pins Circuit in package.json.
        const target = await Releases.pick(packaged.replace(/^[\^~]/, ""), confirmed, "This project");
        if (!target) return;

        await Ui.step(`Pinning Circuit ${target} in package.json`, async () => {
            const result = spawnSync("bun", ["add", "--dev", "--exact", `${Setup.PACKAGE}@${target}`], {
                cwd: root,
                encoding: "utf8",
                shell: process.platform === "win32",
            });
            if (result.status !== 0) throw new Error(`bun add failed: ${(result.stderr || result.stdout).trim()}`);
        });
    }

    /** Before a commit: every secret encrypted, and a project that validates. */
    private static async hook(name: string): Promise<void> {
        if (name !== "pre-commit") Ui.fail(`Circuit has no hook ${name}. It has pre-commit.`);

        const stop = (files: readonly string[]) => {
            const problems = GitHooks.stagedProblems(ProjectCommands.find() ?? process.cwd(), files);
            if (!problems.length) return;
            for (const problem of problems) Ui.error(problem);
            Ui.fail("\nCommit stopped, so no secret reaches git.");
        };

        // `.circuit/secrets` goes first, before the project is read, so a project with errors still has it checked.
        stop([SecretsFile.DEFAULT]);
        if (!ProjectCommands.find()) return;

        const project = await ProjectCommands.open({ experimental: true });
        stop(project.secretsFiles());
        // A field not tested yet is a warning here: it stops `apply`, not a commit.
        project.validate();

        // A project inside this one, such as a customer's, is checked by its own Circuit: the version it pins, its secrets, its files.
        const [command = process.execPath, ...args] = App.self();
        const env: Record<string, string | undefined> = { ...process.env };
        delete env[Versions.RUNNING];

        for (const inner of GitHooks.innerProjects(project.root)) {
            const name = relative(project.root, inner).replaceAll("\\", "/");
            console.log(Ui.bold(`\nThe project in ${name}`));

            const result = spawnSync(command, [...args, "hook", "pre-commit"], { cwd: inner, stdio: "inherit", env });
            if (result.error || result.status !== 0) Ui.fail(`\nCommit stopped by the project in ${name}.`);
        }
    }

    /** What `circuit` alone opens. Gives back the command to run. */
    private static async menu(): Promise<string[]> {
        Ui.logo("Your network, written down.");
        Ui.intro(`Circuit ${VERSION}`);

        if (!ProjectCommands.find()) {
            const choice = await Ui.select("No Circuit project in this folder. What do you want to do?", [
                { value: "new", label: "Start a new project" },
                { value: "update", label: "Update Circuit" },
                { value: "uninstall", label: "Uninstall Circuit", hint: "your projects stay" },
                { value: "exit", label: "Exit" },
            ]);
            if (choice === "exit") process.exit(0);
            return [choice];
        }

        const heading = (label: string): Choice<string> => ({ value: `#${label}`, label: Ui.dim(`── ${label} ──`), disabled: true });
        const choice = await Ui.select("What do you want to do?", [
            heading("Core"),
            { value: "validate", label: "Validate", hint: "check the whole project" },
            { value: "diff", label: "Diff", hint: "show what would change on a device" },
            { value: "apply", label: "Apply", hint: "make a device match its config" },
            heading("Utilities"),
            { value: "exec", label: "Execute", hint: "run read-only commands on a device" },
            { value: "bgp", label: "BGP", hint: "show a device's BGP sessions" },
            { value: "access-console", label: "Access console", hint: "open a device's serial console" },
            { value: "communities", label: "Communities", hint: "what each BGP community means" },
            { value: "addresses", label: "Addresses", hint: "used and free address space" },
            { value: "sync", label: "Sync", hint: "update NetBox, LibreNMS, PeeringDB, or Prometheus" },
            { value: "studio", label: "Studio", hint: "open the project in your browser" },
            { value: "rename", label: "Rename", hint: "rename a device everywhere in the project" },
            { value: "fmt", label: "Tidy files", hint: "fix spacing and line breaks" },
            heading("Secrets"),
            { value: "secrets", label: "Secrets", hint: "edit the secrets in a text editor" },
            heading("Circuit"),
            { value: "update", label: "Update Circuit" },
            { value: "uninstall", label: "Uninstall Circuit", hint: "your projects stay" },
            { value: "exit", label: "Exit" },
        ]);

        if (choice === "exit") process.exit(0);
        return [choice];
    }
}

try {
    await Cli.main(process.argv.slice(2));
} catch (error) {
    Ui.fail((error as Error).message);
}
