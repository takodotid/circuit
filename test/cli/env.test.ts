// A project's `.env`: values encrypted as dotenvx encrypts them, readable with the key, and the commit hook that keeps plain text and the key out of git.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decrypt } from "@dotenvx/primitives";
import { EnvFile } from "../../src/core/env-file";
import { Secrets } from "../../src/core/secrets";
import { GitHooks } from "../../src/cli/git-hooks";

// Inside a git hook, such as this repository's own, git's variables point every git command at this repository instead of the test's.
for (const name of Object.keys(process.env)) if (name.startsWith("GIT_")) delete process.env[name];

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "circuit-env-"));
    EnvFile.create(root, { kind: "file" });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const keyIn = (file: string) => /DOTENV_PRIVATE_KEY="([0-9a-f]+)"/.exec(readFileSync(file, "utf8"))![1]!;

describe("EnvFile", () => {
    test("a new .env holds the public key, and .env.keys the private key", () => {
        const env = new EnvFile(root);

        expect(env.publicKey()).toMatch(/^[0-9a-f]{66}$/);
        expect(keyIn(env.keysPath)).toMatch(/^[0-9a-f]{64}$/);
        expect(env.names()).toEqual([]);
        expect(env.keyLocation()).toBe(".env.keys");
    });

    test("a value is written encrypted, and read back with the key", () => {
        const env = new EnvFile(root);
        env.set("EDGE_01_PASSWORD", "s3cr#t value");

        const stored = env.values().EDGE_01_PASSWORD!;
        expect(stored.startsWith("encrypted:")).toBe(true);
        expect(readFileSync(env.path, "utf8")).not.toContain("s3cr#t");
        expect(env.reveal("EDGE_01_PASSWORD")).toBe("s3cr#t value");

        // The format is dotenvx's: its own decrypt reads it.
        expect(decrypt(keyIn(env.keysPath), stored)).toBe("s3cr#t value");
    });

    test("a 1Password reference is kept as it is", () => {
        const env = new EnvFile(root);
        env.set("SNMP_COMMUNITY", "op://Network/SNMP/password");

        expect(env.values().SNMP_COMMUNITY).toBe("op://Network/SNMP/password");
        expect(EnvFile.kindOf("SNMP_COMMUNITY", "op://Network/SNMP/password")).toBe("1password");
    });

    test("a value typed in by hand is found, and encrypt encrypts it", () => {
        const env = new EnvFile(root);
        writeFileSync(env.path, `${readFileSync(env.path, "utf8")}BGP_PASSWORD=plain-text\n`);

        expect(env.plaintext()).toEqual(["BGP_PASSWORD"]);
        expect(env.encryptAll()).toEqual(["BGP_PASSWORD"]);
        expect(env.plaintext()).toEqual([]);
        expect(env.reveal("BGP_PASSWORD")).toBe("plain-text");
    });

    test("a .env without a key gets one when a value is set", () => {
        rmSync(join(root, ".env"));
        rmSync(join(root, ".env.keys"));

        const env = new EnvFile(root);
        env.set("A_PASSWORD", "one");

        expect(env.publicKey()).toBeDefined();
        expect(env.reveal("A_PASSWORD")).toBe("one");
    });

    test("rotate encrypts every value again, and the old key no longer fits", () => {
        const env = new EnvFile(root);
        env.set("A_PASSWORD", "one");
        env.set("B_PASSWORD", "two");
        const oldKey = keyIn(env.keysPath);
        const oldValue = env.values().A_PASSWORD!;

        expect(env.rotate()).toBe(".env.keys");

        const fresh = new EnvFile(root);
        expect(keyIn(fresh.keysPath)).not.toBe(oldKey);
        expect(fresh.values().A_PASSWORD).not.toBe(oldValue);
        expect(fresh.reveal("A_PASSWORD")).toBe("one");
        expect(fresh.reveal("B_PASSWORD")).toBe("two");

        writeFileSync(fresh.keysPath, `DOTENV_PRIVATE_KEY="${oldKey}"\n`);
        expect(() => new EnvFile(root).reveal("A_PASSWORD")).toThrow("does not decrypt this .env");
    });

    test("remove takes a name out, and says when it was not there", () => {
        const env = new EnvFile(root);
        env.set("A_PASSWORD", "one");

        expect(env.remove("A_PASSWORD")).toBe(true);
        expect(env.remove("A_PASSWORD")).toBe(false);
        expect(env.names()).toEqual([]);
    });

    test("without the key, reading a value says where to get it", () => {
        const env = new EnvFile(root);
        env.set("A_PASSWORD", "one");
        rmSync(env.keysPath);

        expect(() => new EnvFile(root).reveal("A_PASSWORD")).toThrow("Ask your team for it");
    });
});

test("a device's secret is read from .env, decrypted", () => {
    new EnvFile(root).set("EDGE_01_PASSWORD", "from-env-file");
    Secrets.useRoot(root);

    expect(Secrets.reveal({ secret: "EDGE_01_PASSWORD" })).toBe("from-env-file");
    expect(Secrets.scrub("password from-env-file sent")).toBe(`password ${Secrets.REDACTED} sent`);
});

describe("the pre-commit hook", () => {
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });

    beforeEach(() => {
        git("init", "--initial-branch=main");
    });

    test("install writes the hook and points git at it", () => {
        expect(GitHooks.install(root)).toContain("pre-commit");
        expect(git("config", "--get", "core.hooksPath").stdout.trim()).toBe(".circuit/hooks");
        expect(readFileSync(join(root, ".circuit", "hooks", "pre-commit"), "utf8")).toBe(GitHooks.PRE_COMMIT);
        expect(GitHooks.install(root)).toBeUndefined();
    });

    test("an encrypted .env may be committed", () => {
        new EnvFile(root).set("A_PASSWORD", "one");
        git("add", ".env");

        expect(GitHooks.stagedProblems(root)).toEqual([]);
    });

    test("a value in plain text stops the commit", () => {
        writeFileSync(join(root, ".env"), "A_PASSWORD=one\n");
        git("add", ".env");

        expect(GitHooks.stagedProblems(root)).toEqual([expect.stringContaining(".env holds A_PASSWORD in plain text")]);
    });

    test(".env.keys stops the commit", () => {
        git("add", "--force", ".env.keys");

        expect(GitHooks.stagedProblems(root)).toEqual([expect.stringContaining(".env.keys is the key that decrypts .env")]);
    });
});
