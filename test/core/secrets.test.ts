// `.env` beside the config is read the way Node and Bun read it: comments, blank lines, quotes, and `=` inside a value. Every value Circuit knows is hidden from text before it is printed.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secret } from "../../src/core/define";
import { Secrets } from "../../src/core/secrets";
import type { Device } from "../../src/schema";
import router from "../../templates/single-site/router";

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
    "CIRCUIT_TEST_SHORT=abc12",
    "CIRCUIT_TEST_UNREAD=never-read-here",
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
    expect(Secrets.reveal("CIRCUIT_TEST_PLAIN")).toBe("correct-horse");
    expect(Secrets.reveal("CIRCUIT_TEST_PADDED")).toBe("spaced out");
    expect(Secrets.reveal("CIRCUIT_TEST_WINDOWS")).toBe("crlf");
});

test("quotes around a value are removed, and keep a # inside", () => {
    expect(Secrets.reveal("CIRCUIT_TEST_DOUBLE")).toBe("two words");
    expect(Secrets.reveal("CIRCUIT_TEST_SINGLE")).toBe("kept # inside quotes");
    expect(Secrets.reveal("CIRCUIT_TEST_HASH_QUOTED")).toBe("abc#def");
});

test("a # after a space starts a comment", () => {
    expect(Secrets.reveal("CIRCUIT_TEST_COMMENTED")).toBe("value");
});

test("a # inside an unquoted value stops the run, so a password is never cut short", () => {
    const other = mkdtempSync(join(tmpdir(), "circuit-secrets-cut-"));
    writeFileSync(join(other, ".env"), "CIRCUIT_TEST_CUT=abc#def\n");
    Secrets.useRoot(other);

    try {
        expect(() => Secrets.reveal("CIRCUIT_TEST_CUT")).toThrow("the value of CIRCUIT_TEST_CUT has a # in it");
    } finally {
        Secrets.useRoot(directory);
        rmSync(other, { recursive: true, force: true });
    }
});

test("only the first = splits the name from the value", () => {
    expect(Secrets.reveal("CIRCUIT_TEST_EQUALS")).toBe("a=b=c");
});

test("an empty value is not set, and a 1Password reference says so", () => {
    expect(() => Secrets.reveal("CIRCUIT_TEST_EMPTY")).toThrow("not set");
    expect(Secrets.sourceOf("CIRCUIT_TEST_EMPTY")).toBeUndefined();
    expect(Secrets.sourceOf("CIRCUIT_TEST_ONE_PASSWORD")).toBe("1Password, through .env");
    expect(Secrets.sourceOf("CIRCUIT_TEST_PLAIN")).toBe(".env");
});

test("scrub hides each value in .env of six characters or more, but not a 1Password reference", () => {
    const text = "never-read-here abc12 op://Network/router/password";

    expect(Secrets.scrub(text)).toBe("<redacted> abc12 op://Network/router/password");
});

test("scrub hides a value read in this run and the extra values, the longest first", () => {
    const value = Secrets.reveal("CIRCUIT_TEST_PLAIN");

    expect(Secrets.scrub(`said ${value}`)).toBe("said <redacted>");
    expect(Secrets.scrub("x-abcdef-x", { extra: ["abc", "abcdef"] })).toBe("x-<redacted>-x");
});

test("scrub hides the value of a secret the network uses, from the environment, without reading 1Password", () => {
    process.env.CIRCUIT_TEST_FROM_ENVIRONMENT = "env-value-1";
    const network = {
        devices: [],
        peeringdb: { api_key: secret("CIRCUIT_TEST_FROM_ENVIRONMENT") },
        librenms: { url: "https://librenms.example.com", api_token: secret("CIRCUIT_TEST_ONE_PASSWORD") },
    };

    try {
        expect(Secrets.scrub("token env-value-1", { network })).toBe("token <redacted>");
    } finally {
        delete process.env.CIRCUIT_TEST_FROM_ENVIRONMENT;
    }
});

test("loginOf gives the address, port, user, password and console of a device", () => {
    process.env.ROUTER_PASSWORD = "router-pass-1";
    const console = { port: "COM3", baud: 9600 };
    const device: Device = { ...router, connection: { host: "192.0.2.1", user: "operator", console } };

    try {
        expect(Secrets.loginOf(device)).toEqual({ host: "192.0.2.1", port: 22, user: "operator", password: "router-pass-1", console });
        expect(() => Secrets.loginOf({ ...device, connection: { host: "192.0.2.1", user: "nobody" } })).toThrow(
            "connection user nobody is not one of its users"
        );
    } finally {
        delete process.env.ROUTER_PASSWORD;
    }
});
