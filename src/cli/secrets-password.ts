// Getting a secrets file's password: from the environment or 1Password without asking, or typed by the person. A new password is chosen, or made by Circuit.

import { SecretsFile } from "../core/secrets-file";
import { Ui } from "./ui";

/** Getting a secrets file's password from the person, when the environment and 1Password don't give it. */
export class SecretsPassword {
    /** The shortest password a person may choose. */
    private static readonly SHORTEST = 12;

    /** Open a locked file: the person types its password, with three tries. Nothing to do when `file` is undefined or already open. */
    static async unlock(file: SecretsFile | undefined): Promise<void> {
        if (!file || file.unlocked() || file.tryUnlock()) return;
        if (!Ui.interactive)
            Ui.fail(
                `${file.name} is encrypted, and no password was given. Give it in ${SecretsFile.PASSWORD}, or keep it in 1Password and write ${SecretsFile.PASSWORD}="op://vault/item/field" in ${file.name}.`
            );

        for (let tries = 3; tries > 0; tries--) {
            const typed = await Ui.secret(`Password of ${file.name}`);
            try {
                file.unlock(typed);
                return;
            } catch (error) {
                Ui.warn((error as Error).message);
            }
        }
        Ui.fail(`${file.name} stays locked.`);
    }

    /** A new password: typed twice, or made by Circuit when left empty, and then shown once. */
    static async choose(file: SecretsFile, what = `a password for ${file.name}`): Promise<string> {
        if (!Ui.interactive)
            Ui.fail(`${file.name} has no password yet. Run this in a terminal to choose one, or give it in ${SecretsFile.PASSWORD}.`);

        const typed = await Ui.secret(`Choose ${what} (leave it empty and Circuit makes one)`, { empty: true });
        if (!typed) {
            const made = SecretsFile.generatePassword();
            Ui.note(
                `${made}\n\nSave it in your password manager now. Circuit does not keep it, and without it nobody can read ${file.name}.\nIn 1Password, Circuit can read it for you: circuit secrets password --1password op://vault/item/field`,
                "The password"
            );
            return made;
        }

        if (typed.length < SecretsPassword.SHORTEST)
            Ui.fail(`Use at least ${SecretsPassword.SHORTEST} characters, or leave it empty and Circuit makes one. Nothing changed.`);
        if ((await Ui.secret("Type it again")) !== typed) Ui.fail("The two differ. Nothing changed.");
        return typed;
    }

    /** Ready to write: the file open, or, when nothing in it is encrypted yet, a password chosen for it. */
    static async ready(file: SecretsFile): Promise<void> {
        if (file.unlocked() || file.tryUnlock()) return;
        if (file.hasEncrypted()) return SecretsPassword.unlock(file);
        file.unlock(await SecretsPassword.choose(file));
    }
}
