// Try one device file against a real device, for proving an adapter. Reads, plans and applies like the CLI, without a project around it, and checks a second plan after an apply is empty. Everything it reads or plans is saved in .lab/<device>/.
//
//   bun scripts/lab.ts <device.ts> read                 # what the device runs now
//   bun scripts/lab.ts <device.ts> plan                 # what an apply would send
//   bun scripts/lab.ts <device.ts> apply --confirm      # send it, then read and plan again
//   bun scripts/lab.ts <device.ts> run -- "line" ...    # send raw lines and print what comes back
//   bun scripts/lab.ts <device.ts> run --file=lines.txt
//   bun scripts/lab.ts <device.ts> run --session -- "line" ...   # each line through the platform's read session, as `circuit show` logs in, so the output is plain
//
// Options: --console (through connection.console instead of SSH), --secrets (also send every secret), --rollback=N (minutes, default 10), --host-key=ssh-rsa (for `run` over SSH, on a device that signs other host keys wrongly). Secrets come from the environment or a .env beside the device file.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Secrets } from "../src/core/secrets";
import type { Plan, Platform } from "../src/platforms/platform";
import { Platforms } from "../src/platforms";
import type { Device } from "../src/schema";
import { type ConsoleDialect, ConsoleShell, SerialConsole } from "../src/transport/console";
import { Ssh } from "../src/transport/ssh";

class Lab {
    /** A shell prompt at the end of what came back, terminal codes after it allowed: `] > `, `<host>#`, `$`. */
    static readonly PROMPT = /[>#$%]\s*(?:\x1b\[[0-9;?]*[A-Za-z]\s*)*$/;

    private readonly platform: Platform;
    private readonly folder: string;

    constructor(
        private readonly device: Device,
        private readonly flags: Set<string>,
        private readonly values: Map<string, string>
    ) {
        this.platform = Platforms.get(device.platform);
        this.folder = join(import.meta.dirname, "..", ".lab", device.name);
        mkdirSync(this.folder, { recursive: true });
    }

    /** Load the device file and run the command the arguments ask for. */
    static async main(args: string[]): Promise<void> {
        const split = args.indexOf("--");
        const before = split >= 0 ? args.slice(0, split) : args;
        const lines = split >= 0 ? args.slice(split + 1) : [];

        const [file, command] = before.filter((arg) => !arg.startsWith("--"));
        if (!file || !command) throw new Error("usage: bun scripts/lab.ts <device.ts> read|plan|apply|run [options] [-- lines]");

        const options = before.filter((arg) => arg.startsWith("--"));
        const flags = new Set(options.filter((option) => !option.includes("=")).map((option) => option.slice(2)));
        const values = new Map(
            options.filter((option) => option.includes("=")).map((option) => option.slice(2).split("=", 2) as [string, string])
        );

        const path = resolve(file);
        Secrets.useRoot(dirname(path));

        const device = (await import(path)).default as Device;
        const lab = new Lab(device, flags, values);

        if (command === "read") await lab.read();
        else if (command === "plan") await lab.plan();
        else if (command === "apply") await lab.apply();
        else if (command === "run") await lab.run(values.has("file") ? Lab.linesOf(values.get("file")!) : lines);
        else throw new Error(`unknown command ${command}`);
    }

    private static linesOf(file: string): string[] {
        return readFileSync(file, "utf8")
            .split(/\r?\n/)
            .filter((line) => line.trim() !== "");
    }

    private get options() {
        return {
            secrets: this.flags.has("secrets"),
            rollback: Number(this.values.get("rollback") ?? 10),
            console: this.flags.has("console"),
        };
    }

    private save(name: string, text: string): void {
        writeFileSync(join(this.folder, name), text);
    }

    /** What a plan shows, one line per command, under each step's title. */
    private static shown(plan: Plan): string {
        const lines = plan.steps.flatMap((step) => [`# ${step.title}`, ...step.show.map((line) => `  ${line}`)]);
        const problems = plan.problems.map((problem) => `! ${problem}`);

        return [...problems, ...lines].join("\n");
    }

    async read(): Promise<string> {
        const started = Date.now();
        const current = await this.platform.read(this.device, [this.device], this.options);

        this.save(`current${this.platform.extension}`, current);
        console.log(
            `read ${current.split("\n").length} lines in ${((Date.now() - started) / 1000).toFixed(1)}s, saved to .lab/${this.device.name}/`
        );

        return current;
    }

    async plan(): Promise<Plan> {
        const current = await this.read();
        const desired = this.platform.render(this.device);
        const plan = this.platform.plan(desired, current, this.options);

        this.save(`desired${this.platform.extension}`, desired);
        this.save("plan.txt", Lab.shown(plan));
        console.log(plan.steps.length || plan.problems.length ? Lab.shown(plan) : "nothing to change");

        return plan;
    }

    async apply(): Promise<void> {
        const plan = await this.plan();
        if (!plan.steps.length) return;

        if (plan.problems.length) throw new Error("the plan has problems; nothing was sent");
        if (!this.flags.has("confirm")) {
            console.log("\nnothing sent: add --confirm to apply this plan");
            return;
        }

        await this.platform.apply(this.device, [this.device], plan, this.options);
        console.log("applied; reading again");

        // A second plan after an apply must be empty, or the reader and the renderer disagree on something.
        const again = this.platform.plan(this.platform.render(this.device), await this.read(), { ...this.options, secrets: false });
        this.save("plan-after.txt", Lab.shown(again));

        if (again.steps.length) {
            console.log(`does not converge, the second plan is not empty:\n${Lab.shown(again)}`);
            process.exitCode = 1;
            return;
        }

        console.log("converged: the second plan is empty");
    }

    /** Send raw lines and print what comes back, through SSH or the console. */
    async run(lines: string[]): Promise<void> {
        if (!lines.length) throw new Error("no lines to send: give them after -- or with --file=");

        let output: string;
        if (this.flags.has("session")) output = await this.runInSession(lines);
        else if (this.flags.has("console")) output = await this.runOnConsole(lines);
        else output = await this.runOverSsh(lines);
        this.save("run.txt", output);
    }

    /** Each line through the platform's own read session. It sends whatever it is given; `circuit show` is what refuses a write. */
    private async runInSession(lines: string[]): Promise<string> {
        const session = await this.platform.session(this.device, this.options);
        let output = "";

        try {
            for (const line of lines) {
                const answer = `>>> ${line}\n${await session.run(line, 120_000)}\n`;
                output += answer;
                process.stdout.write(answer);
            }

            return output;
        } finally {
            session.close();
        }
    }

    private async runOverSsh(lines: string[]): Promise<string> {
        const user = this.device.connection.user;
        const password = Secrets.reveal(this.device.users![user]!.password);
        const hostKey = this.values.get("host-key");

        const client = await Ssh.connect({
            host: Ssh.hostOf(this.device),
            user,
            password,
            ...(hostKey ? { hostKeys: [hostKey] } : {}),
        });

        try {
            const channel = await Ssh.shell(client);
            // Wait for the first prompt: RouterOS swallowed a line sent while it still set up the terminal.
            let output = await Ssh.readUntil(channel, (text) => Lab.PROMPT.test(text), 20_000, 1_000);

            for (const line of lines) {
                const answer = await Ssh.send(channel, line, 120_000, 2_000);
                output += answer;
                process.stdout.write(answer);
            }

            return output;
        } finally {
            client.end();
        }
    }

    private async runOnConsole(lines: string[]): Promise<string> {
        const dialect = (this.platform.constructor as { CONSOLE?: ConsoleDialect }).CONSOLE;
        if (!dialect) throw new Error(`${this.device.platform} has no console dialect`);

        const { console: serial, user, password } = SerialConsole.of(this.device);
        const session = await SerialConsole.open(serial);
        let output = "";

        try {
            await SerialConsole.login(session.channel, dialect, user, password, serial.passwordOnly);
            const shell = new ConsoleShell(session.channel, dialect);

            for (const line of lines) {
                const answer = `${line}\n${await shell.run(line)}\n`;
                output += answer;
                process.stdout.write(answer);
            }

            shell.logout();
            return output;
        } finally {
            session.close();
        }
    }
}

await Lab.main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
