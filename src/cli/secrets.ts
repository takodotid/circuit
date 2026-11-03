// `circuit secrets`: a network's secrets file, each value encrypted. Alone, in a terminal, it opens the secrets to look through and change them; its commands list them, read one, set, delete, encrypt what was typed in plain text, and change the password.

import { type SecretKind, OnePassword, SecretsFile } from "../core/secrets-file";
import { Secrets } from "../core/secrets";
import { ProjectError, readProject, secretsFileOf } from "../project/project";
import { ProjectCommands } from "./project-commands";
import { Setup } from "./setup";
import { SecretsPassword } from "./secrets-password";
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
     * The secrets file to work on: the one of the network named, or the only one the project uses. Reading the project says which
     * secrets the config needs; a project that can't be read falls back to `.circuit/secrets`.
     */
    static async open(folder: string | undefined, network?: string): Promise<SecretCommands> {
        const root = ProjectCommands.find(folder) ?? Ui.fail("No Circuit project here: no circuit.ts in this folder or above it.");
        Setup.prepare(root);
        Secrets.useRoot(root);

        let files: { file: string; networks: string[]; needed: Set<string> }[] = [];
        try {
            const read = await Ui.step("Reading the project", () => readProject(root));
            for (const each of read.networks) {
                const name = secretsFileOf(each);
                const needed = Secrets.referencesIn([each.devices, each.settings.integrations]);
                const known = files.find((entry) => entry.file === name);
                if (known) {
                    known.networks.push(each.name);
                    for (const reference of needed) known.needed.add(reference);
                } else files.push({ file: name, networks: [each.name], needed });
            }

            if (network !== undefined) {
                files = files.filter((entry) => entry.networks.includes(network));
                if (!files.length) Ui.fail(`No network ${network}. The project has: ${read.networks.map((each) => each.name).join(", ")}`);
            }
        } catch (error) {
            if (!(error instanceof ProjectError)) throw error;
            Ui.warn("The project has errors, so this cannot say which secrets the config needs. Run circuit validate.");
            files = [{ file: SecretsFile.DEFAULT, networks: [], needed: new Set() }];
        }

        let chosen = files[0] ?? { file: SecretsFile.DEFAULT, networks: [], needed: new Set<string>() };
        if (files.length > 1) {
            if (!Ui.interactive)
                Ui.fail(
                    `The networks keep their secrets in different files, so name one: --network ${files.flatMap((entry) => entry.networks).join(" | ")}`
                );
            chosen = await Ui.select(
                "Whose secrets?",
                files.map((entry) => ({ value: entry, label: entry.networks.join(", "), hint: entry.file }))
            );
        }

        Secrets.useFile(chosen.file);
        const needed = [...chosen.needed].filter((name) => !name.startsWith("file:")).sort();
        return new SecretCommands(root, Secrets.file(), needed);
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

        if (!rows.length) console.log("No secrets yet. Add one with circuit secrets set NAME.");
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
            Ui.done(`${this.file.name} has its password. Add a secret with circuit secrets set NAME.`);
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

    /** The secrets, opened in the terminal to look through and change, until the person is done. */
    async edit(): Promise<void> {
        Ui.intro(`Secrets in ${this.file.name}`);

        while (true) {
            const rows = this.rows();
            const choice = await Ui.select<string>("Pick a secret, or what to do", [
                ...rows.map((row) => ({ value: `=${row.name}`, label: row.name, hint: SecretCommands.describe(row.kind, row.value) })),
                { value: "add", label: "Add a secret" },
                { value: "password", label: "Change the password" },
                { value: "done", label: "Done" },
            ]);

            if (choice === "done") break;
            if (choice === "add") await this.set(undefined, undefined);
            else if (choice === "password") await this.password({});
            else {
                const name = choice.slice(1);
                if (!(name in this.file.values())) {
                    await this.set(name, undefined);
                    continue;
                }

                const action = await Ui.select("What with it?", [
                    { value: "show", label: "Show it" },
                    { value: "change", label: "Change it" },
                    { value: "delete", label: "Delete it" },
                    { value: "back", label: "Back" },
                ]);
                if (action === "show") await this.get(name);
                if (action === "change") await this.set(name, undefined);
                if (action === "delete") await this.delete(name, false);
            }
        }

        Ui.outro(this.passwordLine());
    }
}
