// `.env` beside the config is read the way Node and Bun read it: comments, blank lines, quotes, and `=` inside a value.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secrets } from "../../src/core/secrets";

const envFile = [
    "# Secrets for Circuit. Never commit this file.",
    "",
    "CIRCUIT_TEST_PLAIN=correct-horse",
    "CIRCUIT_TEST_PADDED =  spaced out  ",
    'CIRCUIT_TEST_DOUBLE="two words"',
    "CIRCUIT_TEST_SINGLE='kept # inside quotes'",
    "CIRCUIT_TEST_EQUALS=a=b=c",
    'CIRCUIT_TEST_HASH_QUOTED="abc#def"',
    "CIRCUIT_TEST_COMMENTED=value # a note",
    "CIRCUIT_TEST_ONE_PASSWORD=op://Network/router/password",
    "CIRCUIT_TEST_EMPTY=",
    "CIRCUIT_TEST_WINDOWS=crlf\r",
    "",
].join("\n");

let directory: string;

beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "circuit-secrets-"));
    writeFileSync(join(directory, ".env"), envFile);
    Secrets.useRoot(directory);
});

afterAll(() => {
    Secrets.useRoot(process.cwd());
    rmSync(directory, { recursive: true, force: true });
});

test("a value is read as it is written, without the spaces around it", () => {
    expect(Secrets.resolve("CIRCUIT_TEST_PLAIN")).toBe("correct-horse");
    expect(Secrets.resolve("CIRCUIT_TEST_PADDED")).toBe("spaced out");
    expect(Secrets.resolve("CIRCUIT_TEST_WINDOWS")).toBe("crlf");
});

test("quotes around a value are removed, and keep a # inside", () => {
    expect(Secrets.resolve("CIRCUIT_TEST_DOUBLE")).toBe("two words");
    expect(Secrets.resolve("CIRCUIT_TEST_SINGLE")).toBe("kept # inside quotes");
    expect(Secrets.resolve("CIRCUIT_TEST_HASH_QUOTED")).toBe("abc#def");
});

test("a # after a space starts a comment", () => {
    expect(Secrets.resolve("CIRCUIT_TEST_COMMENTED")).toBe("value");
});

test("a # inside an unquoted value stops the run, so a password is never cut short", () => {
    const other = mkdtempSync(join(tmpdir(), "circuit-secrets-cut-"));
    writeFileSync(join(other, ".env"), "CIRCUIT_TEST_CUT=abc#def\n");
    Secrets.useRoot(other);

    try {
        expect(() => Secrets.resolve("CIRCUIT_TEST_CUT")).toThrow("the value of CIRCUIT_TEST_CUT has a # in it");
    } finally {
        Secrets.useRoot(directory);
        rmSync(other, { recursive: true, force: true });
    }
});

test("only the first = splits the name from the value", () => {
    expect(Secrets.resolve("CIRCUIT_TEST_EQUALS")).toBe("a=b=c");
});

test("an empty value is not set, and a 1Password reference says so", () => {
    expect(() => Secrets.resolve("CIRCUIT_TEST_EMPTY")).toThrow("not set");
    expect(Secrets.sourceOf("CIRCUIT_TEST_EMPTY")).toBeUndefined();
    expect(Secrets.sourceOf("CIRCUIT_TEST_ONE_PASSWORD")).toBe("1Password, through .env");
    expect(Secrets.sourceOf("CIRCUIT_TEST_PLAIN")).toBe(".env");
});
