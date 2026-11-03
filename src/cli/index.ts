#!/usr/bin/env bun
// The `circuit` command. Alone, it opens a menu; with a command, such as `circuit validate`, it runs that command. Before each command it checks that this Circuit is current (see `Releases`).

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { spawnSync } from "node:child_process";
import { SecretsFile } from "../core/secrets-file";
import { BgpWait } from "../platforms/bgp-wait";
import { App } from "./app";
import { SecretCommands } from "./secrets";
import { GitHooks } from "./git-hooks";
import { Migrate } from "./migrate";
import { ProjectCommands } from "./project-commands";
import { Releases } from "./releases";
import { Format } from "./format";
import { Setup } from "./setup";
import { Versions } from "./versions";
import { type Choice, Ui } from "./ui";
import { VERSION } from "./version";

class Cli {
    /** `--project`, which every command that reads a project takes. */
    private static readonly PROJECT_FLAGS = "--project <folder>";
    private static readonly PROJECT_HELP =
        "the project's folder; by default the working directory, or the nearest folder above it with circuit.ts";

    /** Commands the manager runs itself, whatever version a project pins. */
    private static readonly APP_COMMANDS = new Set(["update", "uninstall", "new"]);

    /** Read the arguments and run the command they name, or open the menu. */
    static async main(argv: string[]): Promise<void> {
        Releases.tidy();
        const command = argv[0];

        // The manager keeps itself current before every command but `uninstall`. A version it started, or Studio's own reads, leave that to it.
        if (command !== "uninstall" && !Versions.started() && !process.env.CIRCUIT_LOCAL) await Releases.check(argv);

        if (!Cli.APP_COMMANDS.has(command ?? "")) {
            Cli.runLocal(argv);
            const at = argv.indexOf("--project");
            const root = ProjectCommands.find(at >= 0 ? argv[at + 1] : undefined);
            if (root) {
                if (Releases.binary()) Versions.remember(root);
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

        await program.parseAsync(argv, { from: "user" });
    }

    /** In a project with a full install, run the Circuit pinned in it instead of this one, so a team runs one version. */
    private static runLocal(argv: string[]): void {
        if (process.env.CIRCUIT_LOCAL || !Releases.binary()) return;

        const at = argv.indexOf("--project");
        const root = ProjectCommands.find(at >= 0 ? argv[at + 1] : undefined);
        const local = root && Setup.localCircuit(root);
        if (!local) return;

        const result = spawnSync("bun", [local, ...argv], { stdio: "inherit", env: { ...process.env, CIRCUIT_LOCAL: "1" } });
        if (result.error)
            Ui.fail(
                `This project runs Circuit ${Setup.pinned(root) ?? ""} with Bun, and Bun is not installed. Install it from https://bun.sh.`
            );
        process.exit(result.status ?? 1);
    }

    /** A whole number of minutes, seconds or sessions, as a flag takes it. */
    private static whole(unit: string, example: number) {
        return (value: string): number => {
            const number = Number(value);
            if (!Number.isInteger(number) || number < 1)
                throw new InvalidArgumentError(`Give a whole number of ${unit}, such as ${example}.`);
            return number;
        };
    }

    /** Every command, with its arguments and options. `circuit --help` and `circuit <command> --help` are written from these. */
    private static program() {
        const program = new Command("circuit")
            .description("Describe each network device in TypeScript, see what would change, then make the device match.")
            .version(VERSION)
            .usage("[command] [device] [options]")
            .showHelpAfterError("(add --help to see what it takes)");

        program.commandsGroup("Core:");

        program
            .command("validate")
            .description("check every file of the project, and every check in circuit.ts")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .option("--experimental", "allow what a platform renders but has not proved on a device yet, as a warning")
            .action(async (flags) => (await ProjectCommands.open(flags.project, flags)).validate());

        program
            .command("diff")
            .description("read the device, and show what apply would change on it")
            .argument("[device]", "picked from a list when left out")
            .option("--secrets", "plan as apply --secrets would, sending every secret again")
            .option("--console", "through the device's serial console on its jump host, instead of SSH")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .option("--experimental", "allow what a platform renders but has not proved on a device yet, as a warning")
            .action(async (device, flags) => (await ProjectCommands.open(flags.project, flags)).diff(device));

        program
            .command("apply")
            .description("read the device, show what would change, and send it once you say yes")
            .argument("[device]", "picked from a list when left out")
            .option("--confirm", "send without asking")
            .option("--secrets", "also send every secret, to change a password")
            .option("--rollback <minutes>", "minutes before a device that can restore itself does", Cli.whole("minutes", 10), 10)
            .option("--console", "through the device's serial console on its jump host, instead of SSH")
            .option("--force", "send even when the path to the device loses too much or is too slow")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .option("--experimental", "allow what a platform renders but has not proved on a device yet, as a warning")
            .action(async (device, flags) =>
                (await ProjectCommands.open(flags.project, flags)).apply(device, flags.confirm ?? false, flags.force ?? false)
            );

        program.commandsGroup("Utilities:");

        program
            .command("exec")
            .alias("execute")
            .description("run commands that only read on a device, and print what it answers, secrets hidden")
            .argument("[device]", "picked from a list when left out")
            .argument("[command...]", "each command in quotes, such as '/ip route print'")
            .option("--file <path>", "also each line of this file; blank lines and lines starting with # are skipped")
            .option("--timeout <seconds>", "how long each command may take", Cli.whole("seconds", 90), 90)
            .option("--console", "through the device's serial console, instead of SSH")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, commands, flags) =>
                (await ProjectCommands.open(flags.project, flags)).exec(device, commands, flags.file, flags.timeout)
            );

        program
            .command("bgp")
            .description("each BGP neighbor in the config next to its live session: up or down and why, prefixes, uptime")
            .argument("[device]", "may be left out when only one device has BGP neighbors")
            .option("--neighbors <regex>", "only the neighbors whose name matches")
            .option(
                "--wait [count]",
                `read again every ${BgpWait.COMMAND.every} seconds until every neighbor shown, or this many, is up`,
                Cli.whole("sessions", 4)
            )
            .option("--max <seconds>", "how long --wait waits at most", Cli.whole("seconds", 90), BgpWait.COMMAND.seconds)
            .option("--log [minutes]", "also print the device's BGP log lines from the last minutes, 5 by default", Cli.whole("minutes", 5))
            .option("--clear-limit", "open again the neighbors shown that closed on their prefix limit; any other is left alone")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, flags) => (await ProjectCommands.open(flags.project)).bgp(device, flags));

        program
            .command("access-console")
            .description("open a device's serial console here, logged in; or send it lines and print what it answers")
            .argument("[device]", "picked from a list when left out")
            .argument("[line...]", "lines to send, each in quotes; none joins the console to this terminal, Ctrl-] leaves")
            .option("--raw", "do not log in or out: only join the console, or send the lines")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, lines, flags) =>
                (await ProjectCommands.open(flags.project)).accessConsole(device, lines, flags.raw ?? false)
            );

        program
            .command("studio")
            .description("the project in your browser: the graph, every table, tools, compare and secrets")
            .option("--port <number>", "the port it listens on", Cli.port, 4600)
            .option(
                "--host <address>",
                "the address it listens on: this machine only by default; a server's address to share it",
                "127.0.0.1"
            )
            .option(
                "--allow-host <names...>",
                "names besides this machine's that requests may be addressed to, such as studio.example.com behind a proxy"
            )
            .option("--no-open", "do not open the browser")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => Cli.studio(flags));

        program
            .command("rename")
            .description("give a device a new name everywhere the project writes it, and its file too")
            .argument("[device]", "picked from a list when left out")
            .argument("[new-name]", "asked for when left out")
            .option("--file", "also rename the file that writes the device")
            .option("--no-file", "leave the file's name as it is")
            .option("--confirm", "write without asking")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (device, name, flags) =>
                (await ProjectCommands.open(flags.project)).rename(device, name, flags.file, flags.confirm ?? false)
            );

        program
            .command("fmt")
            .description("tidy the spacing and line breaks of the project's .ts files; what they say stays the same")
            .argument("[file...]", "every TypeScript file of the project when left out")
            .option("--check", "change nothing; fail when a file is not in the style")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (files, flags) =>
                Format.run(
                    ProjectCommands.find(flags.project) ?? Ui.fail("No Circuit project here: no circuit.ts in this folder or above it."),
                    files,
                    flags.check ?? false
                )
            );

        program.commandsGroup("Secrets:");

        const NETWORK_FLAGS = "--network <name>";
        const NETWORK_HELP = "the network whose secrets, when the networks keep them in different files";
        const secrets = program
            .command("secrets")
            .alias("secret")
            .description("the project's secrets, each one encrypted: alone, in a terminal, opens every one in a text editor")
            .option(NETWORK_FLAGS, NETWORK_HELP)
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => {
                const commands = await SecretCommands.open(flags.project, flags.network);
                if (Ui.interactive) await commands.edit();
                else commands.list();
            });
        secrets
            .command("edit")
            .description("every secret, decrypted, in a text editor in the terminal; saved encrypted")
            .option(NETWORK_FLAGS, NETWORK_HELP)
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => (await SecretCommands.open(flags.project, flags.network)).edit());
        secrets
            .command("list")
            .description("every secret, how it is kept, and the ones the config needs that the file lacks")
            .option(NETWORK_FLAGS, NETWORK_HELP)
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => (await SecretCommands.open(flags.project, flags.network)).list());
        secrets
            .command("get")
            .description("print one secret, decrypted")
            .argument("[name]")
            .option(NETWORK_FLAGS, NETWORK_HELP)
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (name, flags) => (await SecretCommands.open(flags.project, flags.network)).get(name));
        secrets
            .command("set")
            .description("add or change a secret, encrypted; leave out the value to type it hidden")
            .argument("[name]")
            .argument("[value]", "an op://vault/item/field reference keeps the value in 1Password")
            .option(NETWORK_FLAGS, NETWORK_HELP)
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (name, value, flags) => (await SecretCommands.open(flags.project, flags.network)).set(name, value));
        secrets
            .command("delete")
            .description("remove a secret")
            .argument("[name]")
            .option("--confirm", "delete without asking")
            .option(NETWORK_FLAGS, NETWORK_HELP)
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (name, flags) => (await SecretCommands.open(flags.project, flags.network)).delete(name, flags.confirm ?? false));
        secrets
            .command("encrypt")
            .description("encrypt every value typed into the file in plain text")
            .option(NETWORK_FLAGS, NETWORK_HELP)
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => (await SecretCommands.open(flags.project, flags.network)).encrypt());
        secrets
            .command("password")
            .description("change the password; every secret is encrypted again and the old password stops working")
            .option("--1password <reference>", "read the password from 1Password instead of asking: op://vault/item/field")
            .option("--forget-1password", "stop reading it from 1Password, and ask for it")
            .option("--confirm", "change without asking; the new password comes from CIRCUIT_SECRETS_NEW_PASSWORD")
            .option(NETWORK_FLAGS, NETWORK_HELP)
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) =>
                (await SecretCommands.open(flags.project, flags.network)).password({
                    ...(flags["1password"] !== undefined ? { onePassword: flags["1password"] } : {}),
                    forgetOnePassword: flags.forget1password ?? false,
                    confirm: flags.confirm ?? false,
                })
            );

        program.commandsGroup("Circuit:");

        program
            .command("update")
            .description(
                "pick a newer Circuit, the newest first: in a project, for the project and the app with it; elsewhere, for the app"
            )
            .option("--app", "update the installed app, even in a project")
            .option("--confirm", "update to the newest without asking")
            .action(async (flags) => Cli.update(flags.app ?? false, flags.confirm ?? false));

        program
            .command("new")
            .description("start a new project")
            .argument("[folder]", "asked for when left out")
            .option("--full", "Circuit as a package in the project, run with bun circuit")
            .action(async (folder, flags) => Setup.run(folder, { existing: "refuse", ...(flags.full ? { kind: "full" as const } : {}) }));

        program
            .command("uninstall")
            .description("remove Circuit from this machine; your projects stay")
            .option("--confirm", "remove without asking")
            .action(async (flags) => App.uninstall(flags.confirm ?? false));

        program
            .command("migrate")
            .description("write a Circuit 0.x project again as a v1 project, and list what did not move")
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

    /** `--port`'s value: a port number. */
    private static port(value: string): number {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
            throw new InvalidArgumentError("Give a port from 1 to 65535, such as 4600.");
        return port;
    }

    /** Serve Studio for the project until Ctrl+C, and open it in the browser. */
    private static async studio(flags: {
        port: number;
        host: string;
        allowHost?: string[];
        open: boolean;
        project?: string;
    }): Promise<void> {
        const root = ProjectCommands.find(flags.project) ?? Ui.fail("No Circuit project here: no circuit.ts in this folder or above it.");
        Setup.prepare(root);

        // Studio carries its page, so it is loaded only when asked for.
        const { StudioServer } = await import("../studio/server");
        const url = await Ui.step("Starting Studio", () =>
            StudioServer.start({ root, port: flags.port, host: flags.host, allowHosts: flags.allowHost ?? [] })
        );
        const local = StudioServer.isLoopback(flags.host);

        Ui.done(
            `Circuit Studio at ${url}${local ? "" : `, listening on ${flags.host}:${flags.port}`}. It reads the project again when a file changes. Stop it with Ctrl+C.`
        );
        if (!local)
            Ui.warn(
                "Studio on a server shows the project to everyone who reaches it, and does not read devices. Put it behind a proxy that asks who people are."
            );
        if (flags.open && local) StudioServer.openBrowser(url);
    }

    /** In a project: move it to a version the person picks, and the app with it. Elsewhere, or with `--app`: update the app. Either way, versions no project pins any more are removed. */
    private static async update(app: boolean, confirmed: boolean): Promise<void> {
        const root = ProjectCommands.find();
        if (root && Releases.binary()) Versions.remember(root);
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
        if (name !== "pre-commit") Ui.fail(`No hook ${name}.`);

        const stop = (files: readonly string[]) => {
            const problems = GitHooks.stagedProblems(ProjectCommands.find() ?? process.cwd(), files);
            if (!problems.length) return;
            for (const problem of problems) Ui.error(problem);
            Ui.fail("\nThe commit was stopped, so no secret reaches git.");
        };

        // `.circuit/secrets` before the project is read, so a project with errors still has it checked; then the files the networks name.
        stop([SecretsFile.DEFAULT]);
        if (!ProjectCommands.find()) return;

        const project = await ProjectCommands.open(undefined, { experimental: true });
        stop(project.secretsFiles());
        // A field not proved yet is a warning here: it stops `apply`, not a commit.
        project.validate();
    }

    /** The menu `circuit` opens alone: pick what to do, answer what it needs, and get the command it runs. */
    private static async menu(): Promise<string[]> {
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
            { value: "validate", label: "Validate", hint: "check every file of the project" },
            { value: "diff", label: "Diff", hint: "what apply would change on a device" },
            { value: "apply", label: "Apply", hint: "make a device match its config" },
            heading("Utilities"),
            { value: "exec", label: "Execute", hint: "run a command that only reads on a device" },
            { value: "bgp", label: "BGP", hint: "each BGP session of a device" },
            { value: "access-console", label: "Access console", hint: "a device's serial console" },
            { value: "studio", label: "Studio", hint: "the project in your browser" },
            { value: "rename", label: "Rename", hint: "give a device a new name everywhere" },
            { value: "fmt", label: "Tidy files", hint: "spacing and line breaks only; what the files say stays the same" },
            heading("Secrets"),
            { value: "secrets", label: "Secrets", hint: "every secret in a text editor, saved encrypted" },
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
