// `circuit secrets`: a network's secrets file, each value encrypted. Alone, in a terminal, it opens the secrets to look through and change them; its commands list them, read one, set, delete, encrypt what was typed in plain text, and change the password.

import { type SecretKind, OnePassword, SecretsFile } from "../core/secrets-file";
import { Secrets } from "../core/secrets";
import { ProjectError, readProject, secretsFileOf } from "../project/project";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { ProjectCommands } from "./project-commands";
import { Setup } from "./setup";
import { SecretsPassword } from "./secrets-password";
import { TextEditor } from "./text-editor";
import { Ui } from "./ui";

export class SecretCommands {
    /** A name a secret can take: letters, digits and `_`, not starting with a digit. */
    private static readonly NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

    private constructor(
        readonly root: string,
        private readonly file: SecretsFile,
        /** The secrets the config names that live in this file. */
        private readonly needed: readonly string[]
    ) {}

    /**
     * The secrets file to work on: the one `--file` names, relative to where the command runs, or `.circuit/secrets`. A project whose
     * networks keep their secrets elsewhere has to name the file. Reading the project says which secrets the config needs; a project
     * that can't be read still works on the file named.
     */
    static async open(file: string | undefined): Promise<SecretCommands> {
        const root = ProjectCommands.find() ?? Ui.fail("No Circuit project here: no circuit.ts in this folder or above it.");
        Setup.prepare(root);
        Secrets.useRoot(root);

        const name = file === undefined ? SecretsFile.DEFAULT : SecretCommands.inProject(root, file);
        const needed = new Set<string>();
        try {
            const read = await Ui.step("Reading the project", () => readProject(root));
            const files = [...new Set(read.networks.map(secretsFileOf))].map(SecretCommands.normal);
            const using = read.networks.filter((network) => SecretCommands.normal(secretsFileOf(network)) === SecretCommands.normal(name));

            if (!using.length && files.length) {
                if (file === undefined) Ui.fail(`This project keeps its secrets in ${files.join(", ")}. Name the file: --file ${files[0]}`);
                Ui.warn(`No network uses ${name}. The project's secrets files: ${files.join(", ")}`);
            }
            for (const network of using)
                for (const reference of Secrets.referencesIn([network.devices, network.settings.integrations])) needed.add(reference);
        } catch (error) {
            if (!(error instanceof ProjectError)) throw error;
            Ui.warn("The project has errors, so this cannot say which secrets the config needs. Run circuit validate.");
        }

        Secrets.useFile(name);
        return new SecretCommands(root, Secrets.file(), [...needed].filter((each) => !each.startsWith("file:")).sort());
    }

    /** A path as the project writes it: relative to its root, with forward slashes. */
    private static normal(path: string): string {
        return normalize(path).split(sep).join("/");
    }

    /** `--file`, given relative to where the command runs, as a path inside the project. */
    private static inProject(root: string, file: string): string {
        const path = relative(root, resolve(file));
        if (!path || path.startsWith("..") || isAbsolute(path)) Ui.fail(`${file} is not inside the project, ${root}.`);
        return SecretCommands.normal(path);
    }

    private static checkName(name: string): string {
        if (!SecretCommands.NAME.test(name) || name === SecretsFile.PASSWORD)
            Ui.fail(`${name} is not a name a secret can take: letters, digits and _, such as EDGE_01_PASSWORD.`);
        return name;
    }

    private static describe(kind: SecretKind | "missing", value = ""): string {
        if (kind === "encrypted") return Ui.green("encrypted");
        if (kind === "1password") return `${Ui.green("1Password")}  ${Ui.dim(value)}`;
        if (kind === "empty") return Ui.yellow("empty");
        if (kind === "missing") return Ui.red("missing, the config needs it");
        return Ui.red("NOT ENCRYPTED");
    }

    /** Every name, the ones the config needs but the file lacks too, each with how it is kept. */
    private rows(): { name: string; kind: SecretKind | "missing"; value: string }[] {
        const values = this.file.values();
        const names = [...new Set([...this.file.names(), ...this.needed])].sort();
        return names.map((name) => {
            const value = values[name];
            return value === undefined ? { name, kind: "missing", value: "" } : { name, kind: SecretsFile.kindOf(value), value };
        });
    }

    private passwordLine(): string {
        return `Password of ${this.file.name}: ${this.file.passwordLocation() ?? "typed when Circuit asks"}`;
    }

    /** Every secret, how it is kept, and the ones the config needs that the file lacks. Values are never shown. */
    list(): void {
        const rows = this.rows();
        const width = Math.max(4, ...rows.map((row) => row.name.length));

        if (!rows.length) console.log(`No secrets yet. Add one with ${SecretsFile.command(this.file.name, "set NAME")}.`);
        for (const row of rows)
            console.log(
                `  ${row.name.padEnd(width)}  ${process.env[row.name] ? Ui.dim("from the environment") : SecretCommands.describe(row.kind, row.value)}`
            );

        console.log(`\n${Ui.dim(this.passwordLine())}`);
    }

    /** Print one value, decrypted. */
    async get(name: string | undefined): Promise<void> {
        const chosen = name ?? Ui.fail("Name the secret, such as circuit secrets get EDGE_01_PASSWORD.");
        if (!(chosen in this.file.values()) || chosen === SecretsFile.PASSWORD) Ui.fail(`${chosen} is not in ${this.file.name}.`);

        if (SecretsFile.isEncrypted(this.file.values()[chosen]!)) await SecretsPassword.unlock(this.file);
        try {
            process.stdout.write(`${this.file.reveal(chosen)}\n`);
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
            if (!given.startsWith("op://")) await SecretsPassword.ready(this.file);
            this.file.set(chosen, given);
        } catch (error) {
            Ui.fail((error as Error).message);
        }

        Ui.done(given.startsWith("op://") ? `${chosen} points at 1Password.` : `${chosen} is set, encrypted, in ${this.file.name}.`);
    }

    async delete(name: string | undefined, confirmed: boolean): Promise<void> {
        const chosen = name ?? Ui.fail("Name the secret to delete.");
        if (!(chosen in this.file.values()) || chosen === SecretsFile.PASSWORD) Ui.fail(`${chosen} is not in ${this.file.name}.`);

        if (!confirmed) {
            if (!Ui.interactive) Ui.fail("Not deleted. Without a person to answer, add --confirm.");
            if (!(await Ui.confirm(`Delete ${chosen} from ${this.file.name}?`))) return;
        }

        this.file.remove(chosen);
        Ui.done(`${chosen} is deleted.`);
    }

    /** Encrypt every value written in plain text, such as one typed into the file by hand. */
    async encrypt(): Promise<void> {
        if (!this.file.plaintext().length) {
            Ui.done("Every value is already encrypted.");
            return;
        }

        try {
            await SecretsPassword.ready(this.file);
            Ui.done(`Encrypted ${this.file.encryptAll().join(", ")}.`);
        } catch (error) {
            Ui.fail((error as Error).message);
        }
    }

    /** Change the password, or say where Circuit reads it in 1Password, or stop reading it there. */
    async password(flags: { onePassword?: string; forgetOnePassword?: boolean; confirm?: boolean }): Promise<void> {
        if (flags.forgetOnePassword) {
            this.file.setPasswordReference(undefined);
            Ui.done(`Circuit no longer reads the password of ${this.file.name} from 1Password. It asks for it instead.`);
            return;
        }

        if (flags.onePassword !== undefined) {
            const reference = flags.onePassword;
            if (!reference.startsWith("op://")) Ui.fail("Give a 1Password reference, op://vault/item/field.");

            try {
                const password = OnePassword.read(reference, "The password");
                if (this.file.hasEncrypted()) this.file.unlock(password, reference);
                this.file.setPasswordReference(reference);
            } catch (error) {
                Ui.fail((error as Error).message);
            }
            Ui.done(`Circuit reads the password of ${this.file.name} from ${reference}. Commit ${this.file.name}.`);
            return;
        }

        if (!this.file.hasEncrypted()) {
            await SecretsPassword.ready(this.file);
            Ui.done(`${this.file.name} has its password. Add a secret with ${SecretsFile.command(this.file.name, "set NAME")}.`);
            return;
        }

        if (!flags.confirm) {
            if (!Ui.interactive) Ui.fail("Not changed. Without a person to answer, add --confirm.");
            Ui.note(
                "Every value is encrypted again with the new password, and the old one stops working.\nEveryone on the team needs the new one, unless it is kept in 1Password.\nThis changes no password on a device: to change one, set it with circuit secrets set, then apply.",
                "Change the password"
            );
            if (!(await Ui.confirm("Change it now?"))) return;
        }

        await SecretsPassword.unlock(this.file);
        const reference = this.file.values()[SecretsFile.PASSWORD];
        const next = Ui.interactive
            ? await SecretsPassword.choose(this.file, "the new password")
            : process.env.CIRCUIT_SECRETS_NEW_PASSWORD;
        if (!next) Ui.fail("Without a person to answer, give the new password in CIRCUIT_SECRETS_NEW_PASSWORD.");

        try {
            await Ui.step("Encrypting every value again", async () => this.file.changePassword(next));
        } catch (error) {
            Ui.fail((error as Error).message);
        }

        Ui.done(`Changed. Commit ${this.file.name}.`);
        if (reference) Ui.warn(`Put the new password in 1Password at ${reference} now: it still holds the old one.`);
    }

    /** Every secret, decrypted, in a text editor on the whole screen: change, add or delete lines, Ctrl+S to save, each value encrypted again. Nothing is written to disk in plain text. */
    async edit(): Promise<void> {
        if (!Ui.interactive) Ui.fail(`The editor needs a terminal. Use ${SecretsFile.command(this.file.name, "set NAME")} instead.`);

        try {
            await SecretsPassword.ready(this.file);
        } catch (error) {
            Ui.fail((error as Error).message);
        }

        const missing = this.needed.filter((name) => !(name in this.file.values()));
        await TextEditor.open({
            title: `Secrets: ${this.file.name}`,
            text: this.file.editable(),
            ...(missing.length ? { note: `The config needs ${missing.join(", ")}: add a line NAME=value for each.` } : {}),
            save: (edited) => {
                try {
                    return this.file.saveEditable(edited);
                } catch (error) {
                    return (error as Error).message;
                }
            },
        });

        Ui.done(`${this.file.name}: ${this.file.names().length} secret(s), each encrypted. Commit it.`);
    }
}
