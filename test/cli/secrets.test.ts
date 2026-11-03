// A network's secrets file: each value encrypted with a key made from its password, read back with it, the password from the environment or a 1Password reference, and the commit hook that keeps plain text out of git.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHooks } from "../../src/cli/git-hooks";
import { Secrets } from "../../src/core/secrets";
import { SecretsFile } from "../../src/core/secrets-file";

// Inside a git hook, such as this repository's own, git's variables point every git command at this repository instead of the test's.
for (const name of Object.keys(process.env)) if (name.startsWith("GIT_")) delete process.env[name];

const PASSWORD = "correct horse battery staple";
let root = "";

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "circuit-secrets-"));
    SecretsFile.forget();
    delete process.env[SecretsFile.PASSWORD];
});

afterEach(() => {
    delete process.env[SecretsFile.PASSWORD];
    if (root) rmSync(root, { recursive: true, force: true });
});

/** The file, opened with the test's password. */
const opened = (name?: string) => {
    const file = SecretsFile.at(root, name);
    file.unlock(PASSWORD);
    return file;
};

describe("SecretsFile", () => {
    test("a value is written encrypted, under its own name, and read back with the password", () => {
        const file = opened();
        file.set("EDGE_01_PASSWORD", "s3cr#t value");

        const text = readFileSync(join(root, ".circuit", "secrets"), "utf8");
        expect(text).toStartWith(SecretsFile.HEADER);
        expect(text).toContain('EDGE_01_PASSWORD="encrypted:');
        expect(text).not.toContain("s3cr#t");
        expect(file.reveal("EDGE_01_PASSWORD")).toBe("s3cr#t value");
    });

    test("one password opens every value: they share a salt, and a new run opens them again", () => {
        const file = opened();
        file.set("A_PASSWORD", "one");
        file.set("B_PASSWORD", "two");
        const salts = file.names().map((name) => SecretsFile.partsOf(file.values()[name]!).salt.toString("hex"));
        expect(new Set(salts).size).toBe(1);

        SecretsFile.forget();
        const again = SecretsFile.at(root);
        expect(again.unlocked()).toBe(false);
        again.unlock(PASSWORD);
        expect(again.reveal("B_PASSWORD")).toBe("two");
    });

    test("a wrong password does not open the file", () => {
        opened().set("A_PASSWORD", "one");
        SecretsFile.forget();

        expect(() => SecretsFile.at(root).unlock("not the password")).toThrow("That password does not open .circuit/secrets");
    });

    test("a value moved to another name no longer opens", () => {
        const file = opened();
        file.set("A_PASSWORD", "one");
        const text = readFileSync(file.path, "utf8");
        writeFileSync(file.path, text.replace("A_PASSWORD=", "B_PASSWORD="));

        expect(() => file.reveal("B_PASSWORD")).toThrow("does not open with its password");
    });

    test("without a password at hand, reading says how to give it", () => {
        opened().set("A_PASSWORD", "one");
        SecretsFile.forget();

        expect(() => SecretsFile.at(root).reveal("A_PASSWORD")).toThrow("Circuit has no password for it");
    });

    test("the password may come from the environment", () => {
        opened().set("A_PASSWORD", "one");
        SecretsFile.forget();
        process.env[SecretsFile.PASSWORD] = PASSWORD;

        const file = SecretsFile.at(root);
        expect(file.passwordLocation()).toBe(`the environment, ${SecretsFile.PASSWORD}`);
        expect(file.reveal("A_PASSWORD")).toBe("one");
    });

    test("a 1Password reference for the password is written in the file, and is never a secret", () => {
        const file = opened();
        file.setPasswordReference("op://Network/Circuit/password");

        expect(file.values()[SecretsFile.PASSWORD]).toBe("op://Network/Circuit/password");
        expect(file.passwordLocation()).toBe("1Password, op://Network/Circuit/password (named in .circuit/secrets)");
        expect(file.names()).toEqual([]);
        expect(file.problems()).toEqual([]);
    });

    test("a password written as itself, and a value in plain text, stop a commit", () => {
        const text = `${SecretsFile.PASSWORD}="hunter2hunter2"\nBGP_PASSWORD=plain-text\nSNMP="op://Network/SNMP/password"\n`;

        expect(SecretsFile.problemsIn(text, ".circuit/secrets")).toEqual([
            expect.stringContaining(".circuit/secrets holds BGP_PASSWORD in plain text"),
            expect.stringContaining(".circuit/secrets holds its own password"),
        ]);
    });

    test("a value in plain text is refused, and encrypt encrypts it, leaving the rest as written", () => {
        const file = opened();
        file.set("A_PASSWORD", "one");
        file.set("SNMP_COMMUNITY", "op://Network/SNMP/password");
        const encrypted = file.values().A_PASSWORD;
        writeFileSync(file.path, `${readFileSync(file.path, "utf8")}B_PASSWORD=two\n`);

        expect(() => file.reveal("B_PASSWORD")).toThrow("is in plain text");
        expect(file.encryptAll()).toEqual(["B_PASSWORD"]);
        expect(file.values().A_PASSWORD).toBe(encrypted);
        expect(file.values().SNMP_COMMUNITY).toBe("op://Network/SNMP/password");
        expect(file.reveal("B_PASSWORD")).toBe("two");
        expect(file.problems()).toEqual([]);
    });

    test("a new password encrypts every value again, and the old one stops working", () => {
        const file = opened();
        file.set("A_PASSWORD", "one");
        const before = file.values().A_PASSWORD;

        file.changePassword("a brand new password");
        expect(file.values().A_PASSWORD).not.toBe(before);
        expect(file.reveal("A_PASSWORD")).toBe("one");

        SecretsFile.forget();
        expect(() => SecretsFile.at(root).unlock(PASSWORD)).toThrow("does not open");
        SecretsFile.at(root).unlock("a brand new password");
    });

    test("remove takes a name out, in place, and says when it was not there", () => {
        const file = opened();
        file.set("A_PASSWORD", "one");
        file.set("B_PASSWORD", "two");

        expect(file.remove("A_PASSWORD")).toBe(true);
        expect(file.remove("A_PASSWORD")).toBe(false);
        expect(file.names()).toEqual(["B_PASSWORD"]);
    });

    test("the editor's text: every value decrypted, comments in place, the password's reference as it is", () => {
        const file = opened();
        file.setPasswordReference("op://Network/Circuit/password");
        file.set("A_PASSWORD", "one");
        file.set("SPACED", " two ");
        file.set("SNMP", "op://Network/SNMP/password");

        expect(file.editable()).toBe(
            `${SecretsFile.HEADER}CIRCUIT_SECRETS_PASSWORD=op://Network/Circuit/password\nA_PASSWORD=one\nSPACED=" two "\nSNMP=op://Network/SNMP/password\n`
        );
    });

    test("saving the editor's text encrypts what changed and keeps the rest as it was encrypted", () => {
        const file = opened();
        file.set("A_PASSWORD", "one");
        file.set("B_PASSWORD", "two");
        const before = file.values();

        const edited = file.editable().replace("B_PASSWORD=two", 'B_PASSWORD=changed\n# a note\nC_PASSWORD="three"');
        expect(file.saveEditable(edited)).toBeUndefined();

        const after = file.values();
        expect(after.A_PASSWORD).toBe(before.A_PASSWORD);
        expect(after.B_PASSWORD).not.toBe(before.B_PASSWORD);
        expect(file.reveal("B_PASSWORD")).toBe("changed");
        expect(file.reveal("C_PASSWORD")).toBe("three");
        expect(readFileSync(file.path, "utf8")).toContain("# a note\n");
        expect(readFileSync(file.path, "utf8")).not.toContain("changed");
        expect(file.problems()).toEqual([]);
    });

    test("a line taken out of the editor's text is deleted; a value typed in plain text is encrypted", () => {
        const file = opened();
        file.set("A_PASSWORD", "one");
        writeFileSync(file.path, `${readFileSync(file.path, "utf8")}B_PASSWORD=typed-by-hand\n`);

        expect(file.saveEditable(file.editable().replace(/^A_PASSWORD=.*\n/m, ""))).toBeUndefined();
        expect(file.names()).toEqual(["B_PASSWORD"]);
        expect(file.problems()).toEqual([]);
        expect(file.reveal("B_PASSWORD")).toBe("typed-by-hand");
    });

    test("the editor's text is refused when a line is not NAME=value, a name is twice, or the password is written as itself", () => {
        const file = opened();
        expect(file.saveEditable("A=1\nnot a line\n")).toBe("line 2: write NAME=value, or a comment starting with #");
        expect(file.saveEditable("A=1\nA=2\n")).toBe("line 2: A is written twice");
        expect(file.saveEditable(`${SecretsFile.PASSWORD}=hunter2hunter2\n`)).toContain("may only be a 1Password reference");
        expect(file.exists()).toBe(false);
    });

    test("a made password is long and new each time", () => {
        const made = SecretsFile.generatePassword();
        expect(made.length).toBe(32);
        expect(SecretsFile.generatePassword()).not.toBe(made);
    });
});

describe("a device's secret", () => {
    test("is read from the network's file, decrypted", () => {
        opened().set("EDGE_01_PASSWORD", "from-the-file");
        Secrets.useRoot(root);

        expect(Secrets.reveal({ secret: "EDGE_01_PASSWORD" })).toBe("from-the-file");
        expect(Secrets.scrub("password from-the-file sent")).toBe(`password ${Secrets.REDACTED} sent`);
    });

    test("is read from the file the network names", () => {
        opened(".circuit/lab-secrets").set("EDGE_01_PASSWORD", "from-the-lab");
        Secrets.useRoot(root);
        Secrets.useFile(".circuit/lab-secrets");

        expect(Secrets.reveal({ secret: "EDGE_01_PASSWORD" })).toBe("from-the-lab");
    });

    test("needs the password asked for first when nothing else gives it", () => {
        opened().set("EDGE_01_PASSWORD", "one");
        SecretsFile.forget();
        Secrets.useRoot(root);

        const device = { system: { users: { netops: { password: { secret: "EDGE_01_PASSWORD" } } } } };
        expect(Secrets.lockedFor(device)?.name).toBe(SecretsFile.DEFAULT);

        process.env[SecretsFile.PASSWORD] = PASSWORD;
        expect(Secrets.lockedFor(device)).toBeUndefined();
    });
});

describe("the pre-commit hook", () => {
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: process.env });

    beforeEach(() => {
        git("init", "--initial-branch=main");
    });

    test("install writes the hook and points git at it", () => {
        expect(GitHooks.install(root)).toContain("pre-commit");
        expect(git("config", "--get", "core.hooksPath").stdout.trim()).toBe(".circuit/hooks");
        expect(readFileSync(join(root, ".circuit", "hooks", "pre-commit"), "utf8")).toBe(GitHooks.PRE_COMMIT);
        expect(GitHooks.install(root)).toBeUndefined();
    });

    test("an encrypted file, and 1Password references, may be committed", () => {
        const file = opened();
        file.set("A_PASSWORD", "one");
        file.set("SNMP", "op://Network/SNMP/password");
        file.setPasswordReference("op://Network/Circuit/password");
        git("add", ".circuit/secrets");

        expect(GitHooks.stagedProblems(root, [SecretsFile.DEFAULT])).toEqual([]);
    });

    test("a value in plain text stops the commit, in the default file and in one a network names", () => {
        mkdirSync(join(root, ".circuit"), { recursive: true });
        writeFileSync(join(root, ".circuit", "secrets"), "A_PASSWORD=one\n");
        writeFileSync(join(root, "lab-secrets"), "B_PASSWORD=two\n");
        git("add", ".circuit/secrets", "lab-secrets");

        expect(GitHooks.stagedProblems(root, [SecretsFile.DEFAULT, "lab-secrets"])).toEqual([
            expect.stringContaining(".circuit/secrets holds A_PASSWORD in plain text"),
            expect.stringContaining("lab-secrets holds B_PASSWORD in plain text"),
        ]);
    });

    test("a file that is no network's secrets file is not looked at", () => {
        writeFileSync(join(root, "notes.env"), "A_PASSWORD=one\n");
        git("add", "notes.env");

        expect(GitHooks.stagedProblems(root, [SecretsFile.DEFAULT])).toEqual([]);
    });
});
