// `circuit secret`: the project's secrets in `.env`, each encrypted. List them, read one, set, delete, encrypt what is in plain text, and rotate the key.

import { EnvFile, type EnvValueKind } from "../core/env-file";
import { Secrets } from "../core/secrets";
import { ProjectError, readProject } from "../project/project";
import { ProjectCommands } from "./project-commands";
import { Setup } from "./setup";
import { Ui } from "./ui";

export class SecretCommands {
    /** A name a variable can take: letters, digits and `_`, not starting with a digit. */
    private static readonly NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

    private readonly env: EnvFile;

    private constructor(readonly root: string) {
        this.env = new EnvFile(root);
    }

    static open(folder: string | undefined): SecretCommands {
        const root = ProjectCommands.find(folder) ?? Ui.fail("No Circuit project here: no circuit.ts in this folder or above it.");
        Setup.prepare(root);
        return new SecretCommands(root);
    }

    private static checkName(name: string): string {
        if (!SecretCommands.NAME.test(name)) Ui.fail(`${name} is not a name .env takes: letters, digits and _, such as EDGE_01_PASSWORD.`);
        return name;
    }

    private static describe(kind: EnvValueKind, value: string): string {
        if (kind === "encrypted") return Ui.green("encrypted");
        if (kind === "1password") return `${Ui.green("1Password")}  ${Ui.dim(value)}`;
        if (kind === "reference") return Ui.dim("a reference");
        if (kind === "empty") return Ui.yellow("empty");
        return Ui.red("NOT ENCRYPTED");
    }

    /** Every name in `.env`, how each is kept, and each secret the config names that `.env` lacks. Values are never shown. */
    async list(): Promise<void> {
        let named: string[] = [];
        try {
            const read = await Ui.step("Reading the project", () => readProject(this.root));
            named = [...Secrets.referencesIn(read.networks.map((network) => [network.devices, network.settings.integrations]))];
        } catch (error) {
            if (!(error instanceof ProjectError)) throw error;
            Ui.warn("The project has errors, so this list cannot say which secrets the config needs. Run circuit validate.");
        }

        const values = this.env.values();
        const names = [...new Set([...this.env.names(), ...named.filter((name) => !name.startsWith("file:"))])].sort();
        const width = Math.max(4, ...names.map((name) => name.length));

        if (!names.length) console.log("No secrets yet. Add one with circuit secret set NAME.");

        for (const name of names) {
            const value = values[name];
            const where =
                value === undefined
                    ? process.env[name]
                        ? Ui.dim("from the environment")
                        : Ui.red("missing, the config needs it")
                    : SecretCommands.describe(EnvFile.kindOf(name, value), value);
            console.log(`  ${name.padEnd(width)}  ${where}`);
        }

        console.log(`\n${Ui.dim(`Key that decrypts .env: ${this.env.keyLocation() ?? "not here"}`)}`);
    }

    /** Print one value, decrypted. */
    get(name: string | undefined): void {
        const chosen = name ?? Ui.fail("Name the secret, such as circuit secret get EDGE_01_PASSWORD.");

        try {
            process.stdout.write(`${this.env.reveal(chosen)}\n`);
        } catch (error) {
            Ui.fail((error as Error).message);
        }
    }

    /** Set a value, encrypted. A value not given is typed without showing it, so it stays out of the shell's history. */
    async set(name: string | undefined, value: string | undefined): Promise<void> {
        const chosen = SecretCommands.checkName(
            name ?? (Ui.interactive ? await Ui.text("Name", { placeholder: "EDGE_01_PASSWORD" }) : Ui.fail("Name the secret."))
        );
        const given =
            value ??
            (Ui.interactive
                ? await Ui.secret(`Value of ${chosen} (an op:// reference keeps it in 1Password)`)
                : Ui.fail("Give the value."));

        try {
            this.env.set(chosen, given);
        } catch (error) {
            Ui.fail((error as Error).message);
        }

        Ui.done(given.startsWith("op://") ? `${chosen} points at 1Password.` : `${chosen} is set, encrypted.`);
    }

    async delete(name: string | undefined, confirmed: boolean): Promise<void> {
        const chosen = name ?? Ui.fail("Name the secret to delete.");
        if (!(chosen in this.env.values())) Ui.fail(`${chosen} is not in .env.`);

        if (!confirmed) {
            if (!Ui.interactive) Ui.fail("Not deleted. Without a person to answer, add --confirm.");
            if (!(await Ui.confirm(`Delete ${chosen} from .env?`))) return;
        }

        this.env.remove(chosen);
        Ui.done(`${chosen} is deleted.`);
    }

    /** Encrypt every value written in plain text, such as one typed into `.env` by hand. */
    encrypt(): void {
        let names: string[];
        try {
            names = this.env.encryptAll();
        } catch (error) {
            Ui.fail((error as Error).message);
        }

        Ui.done(names.length ? `Encrypted ${names.join(", ")}.` : "Every value is already encrypted.");
    }

    /** A new key: every value encrypted again, and the old key no longer opens `.env`. */
    async rotate(confirmed: boolean): Promise<void> {
        if (!confirmed) {
            if (!Ui.interactive) Ui.fail("Not rotated. Without a person to answer, add --confirm.");
            Ui.note(
                "Every value is encrypted again with a new key, and the old key stops working.\nEveryone on the team needs the new key, unless it is kept in 1Password.\nThis changes no password on a device: to change one, set it with circuit secret set, then apply.",
                "Rotate the key"
            );
            if (!(await Ui.confirm("Rotate the key now?"))) return;
        }

        let where: string;
        try {
            where = await Ui.step("Rotating the key", async () => this.env.rotate());
        } catch (error) {
            Ui.fail((error as Error).message);
        }

        Ui.done(`Rotated. The new key is in ${where}. Commit .env.`);
    }
}
