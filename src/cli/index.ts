#!/usr/bin/env bun
// The `circuit` command. Alone, it opens a menu; with a command, such as `circuit validate`, it runs that command. Before each command it checks that this Circuit is current (see `Releases`).

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { spawnSync } from "node:child_process";
import { EnvFile } from "../core/env-file";
import { BgpWait } from "../platforms/bgp-wait";
import { EnvCommands } from "./env";
import { GitHooks } from "./git-hooks";
import { ProjectCommands } from "./project-commands";
import { Releases } from "./releases";
import { Setup } from "./setup";
import { type Choice, Ui } from "./ui";
import { VERSION } from "./version";

class Cli {
    /** `--project`, which every command that reads a project takes. */
    private static readonly PROJECT_FLAGS = "--project <folder>";
    private static readonly PROJECT_HELP =
        "the project's folder; by default the working directory, or the nearest folder above it with circuit.ts";

    /** Commands that run before, or without, the version check. */
    private static readonly UNCHECKED = new Set(["update", "help", "--help", "-h", "--version", "-V"]);

    /** Read the arguments and run the command they name, or open the menu. */
    static async main(argv: string[]): Promise<void> {
        Releases.tidy();

        const command = argv[0];
        if (command !== "update" && command !== "setup") Cli.runLocal(argv);
        if (!command || !Cli.UNCHECKED.has(command)) await Releases.gate();

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
            .action(async (flags) => (await ProjectCommands.open(flags.project)).validate());

        program
            .command("diff")
            .description("read the device, and show what apply would change on it")
            .argument("[device]", "picked from a list when left out")
            .option("--secrets", "plan as apply --secrets would, sending every secret again")
            .option("--console", "through the device's serial console on its jump host, instead of SSH")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
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

        program.commandsGroup("Secrets:");

        const env = program.command("env").description("the project's secrets in .env, each one encrypted");
        env.command("list", { isDefault: true })
            .description("every secret, how it is kept, and the ones the config needs that .env lacks")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => EnvCommands.open(flags.project).list());
        env.command("get")
            .description("print one secret, decrypted")
            .argument("[name]")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action((name, flags) => EnvCommands.open(flags.project).get(name));
        env.command("set")
            .description("add or change a secret, encrypted; leave out the value to type it hidden")
            .argument("[name]")
            .argument("[value]", "an op://vault/item/field reference keeps the value in 1Password")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (name, value, flags) => EnvCommands.open(flags.project).set(name, value));
        env.command("delete")
            .description("remove a secret")
            .argument("[name]")
            .option("--confirm", "delete without asking")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (name, flags) => EnvCommands.open(flags.project).delete(name, flags.confirm ?? false));
        env.command("encrypt")
            .description("encrypt every value written in plain text")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action((flags) => EnvCommands.open(flags.project).encrypt());
        env.command("rotate")
            .description("a new key: every secret encrypted again, the old key stops working")
            .option("--confirm", "rotate without asking")
            .option(Cli.PROJECT_FLAGS, Cli.PROJECT_HELP)
            .action(async (flags) => EnvCommands.open(flags.project).rotate(flags.confirm ?? false));

        program.commandsGroup("Circuit:");

        program
            .command("update")
            .description("install the newest Circuit, and the project's pinned one in a full install")
            .action(async () => Cli.update());

        program
            .command("setup", { hidden: true })
            .description("start a new project, as the installer does")
            .argument("[folder]")
            .action(async (folder) => Setup.run(folder));

        program
            .command("hook", { hidden: true })
            .description("what the project's git hooks run")
            .argument("<name>", "pre-commit")
            .action(async (name) => Cli.hook(name));

        return program;
    }

    /** Update this Circuit, then the one a full install pins in the project here, to the same version. */
    private static async update(): Promise<void> {
        const installed = await Releases.update();
        const root = ProjectCommands.find();
        if (!installed || !root || !Setup.pinned(root)) return;

        await Ui.step(`Pinning Circuit ${installed} in the project`, async () => {
            const result = spawnSync("bun", ["add", "--dev", "--exact", `${Setup.PACKAGE}@${installed}`], {
                cwd: root,
                encoding: "utf8",
                shell: process.platform === "win32",
            });
            if (result.status !== 0) throw new Error(`bun add failed: ${(result.stderr || result.stdout).trim()}`);
        });
    }

    /** Before a commit: no secret in plain text, no `.env.keys`, and a project that validates. */
    private static async hook(name: string): Promise<void> {
        if (name !== "pre-commit") Ui.fail(`No hook ${name}.`);

        const root = ProjectCommands.find() ?? process.cwd();
        const problems = GitHooks.stagedProblems(root);
        if (problems.length) {
            for (const problem of problems) Ui.error(problem);
            Ui.fail("\nThe commit was stopped, so no secret reaches git.");
        }

        if (ProjectCommands.find()) (await ProjectCommands.open(undefined)).validate();
    }

    /** The menu `circuit` opens alone: pick what to do, answer what it needs, and get the command it runs. */
    private static async menu(): Promise<string[]> {
        Ui.intro(`Circuit ${VERSION}`);

        if (!ProjectCommands.find()) {
            const choice = await Ui.select("No Circuit project in this folder. What do you want to do?", [
                { value: "setup", label: "Start a new project here" },
                { value: "update", label: "Update Circuit" },
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
            heading("Secrets"),
            { value: "env", label: "Secrets", hint: "list, set or delete the secrets in .env" },
            heading("Circuit"),
            { value: "update", label: "Update Circuit" },
            { value: "exit", label: "Exit" },
        ]);

        if (choice === "exit") process.exit(0);
        if (choice !== "env") return [choice];

        const action = await Ui.select("Secrets", [
            { value: "list", label: "List", hint: "every secret and how it is kept" },
            { value: "set", label: "Set", hint: "add or change one, encrypted" },
            { value: "get", label: "Show", hint: "print one, decrypted" },
            { value: "delete", label: "Delete" },
            { value: "encrypt", label: "Encrypt", hint: "every value written in plain text" },
            { value: "rotate", label: "Rotate the key" },
        ]);
        if (action !== "get" && action !== "delete") return ["env", action];

        const names = new EnvFile(ProjectCommands.find()!).names();
        if (!names.length) Ui.fail("No secrets yet. Add one with circuit env set NAME.");
        return [
            "env",
            action,
            await Ui.select(
                "Which secret?",
                names.map((name) => ({ value: name, label: name }))
            ),
        ];
    }
}

try {
    await Cli.main(process.argv.slice(2));
} catch (error) {
    Ui.fail((error as Error).message);
}
