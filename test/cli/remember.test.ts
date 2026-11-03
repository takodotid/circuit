// Remembering secrets between commands: the small process that keeps them answers only with its token, stops when told or when the time is up, and a remembered password opens its secrets file without anyone typing it.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretsAgent } from "../../src/cli/remember";
import { OnePassword, SecretsFile } from "../../src/core/secrets-file";

let home = "";
const before = process.env.CIRCUIT_HOME;

beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "circuit-remember-"));
    process.env.CIRCUIT_HOME = home;
});

afterAll(() => {
    if (before === undefined) delete process.env.CIRCUIT_HOME;
    else process.env.CIRCUIT_HOME = before;
    rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
    SecretsFile.forget();
    OnePassword.forget();
});

afterEach(async () => {
    await SecretsAgent.ask({ op: "stop" });
});

/** Send a raw line to the process, as another program could. */
const raw = (endpoint: string, line: string): Promise<string> =>
    new Promise((done) => {
        let answer = "";
        const socket = connect(endpoint, () => socket.write(`${line}\n`));
        socket.on("data", (chunk) => (answer += chunk.toString("utf8")));
        socket.on("close", () => done(answer));
        socket.on("error", () => done(answer));
    });

describe("SecretsAgent", () => {
    test("keeps what it is given, and forgets it when told to stop", async () => {
        expect(await SecretsAgent.ask({ op: "get" })).toBeUndefined();
        expect(await SecretsAgent.start(Date.now() + 60_000)).toBe(true);

        await SecretsAgent.ask({ op: "put", values: { "op://Vault/Item/password": "s3cret" }, passwords: { "/p/.circuit/secrets": "pw" } });
        const answer = await SecretsAgent.ask({ op: "get" });
        expect(answer?.values).toEqual({ "op://Vault/Item/password": "s3cret" });
        expect(answer?.passwords).toEqual({ "/p/.circuit/secrets": "pw" });

        await SecretsAgent.ask({ op: "stop" });
        expect(existsSync(SecretsAgent.infoPath())).toBe(false);
        expect(await SecretsAgent.ask({ op: "get" })).toBeUndefined();
    }, 15_000);

    test("answers nothing to a program without its token", async () => {
        expect(await SecretsAgent.start(Date.now() + 60_000)).toBe(true);
        await SecretsAgent.ask({ op: "put", values: { "op://Vault/Item/password": "s3cret" } });

        const { endpoint } = JSON.parse(readFileSync(SecretsAgent.infoPath(), "utf8"));
        expect(await raw(endpoint, JSON.stringify({ op: "get", token: "guess" }))).toBe("");
        expect(await raw(endpoint, JSON.stringify({ op: "get" }))).toBe("");
    }, 15_000);

    test("never keeps longer than 30 minutes, and stops when the time is up", async () => {
        expect(await SecretsAgent.start(Date.now() + 5 * 60 * 60_000)).toBe(true);
        const answer = await SecretsAgent.ask({ op: "get" });
        expect(answer!.until).toBeLessThanOrEqual(Date.now() + SecretsAgent.LONGEST * 60_000);

        await SecretsAgent.ask({ op: "put", until: Date.now() + 300 });
        await new Promise((wait) => setTimeout(wait, 1000));
        expect(await SecretsAgent.ask({ op: "get" })).toBeUndefined();
    }, 15_000);
});

describe("what a run remembers", () => {
    test("a remembered 1Password value is read without 1Password, and is not new to remember", () => {
        OnePassword.hold({ "op://Vault/Item/password": "s3cret" });
        expect(OnePassword.read("op://Vault/Item/password", "test")).toBe("s3cret");
        expect(OnePassword.usedHeld).toBe(true);
        expect(OnePassword.unheld()).toEqual({});
    });

    test("a remembered password opens its secrets file, and one that no longer opens it is dropped", () => {
        const root = mkdtempSync(join(tmpdir(), "circuit-remember-file-"));
        try {
            const file = SecretsFile.at(root);
            file.unlock("correct horse battery staple");
            file.set("EDGE_PASSWORD", "value");

            SecretsFile.forget();
            SecretsFile.hold({ [file.path]: "correct horse battery staple" });
            expect(SecretsFile.at(root).tryUnlock()).toBe(true);
            expect(SecretsFile.at(root).reveal("EDGE_PASSWORD")).toBe("value");
            expect(SecretsFile.usedHeld).toBe(true);

            SecretsFile.forget();
            SecretsFile.hold({ [file.path]: "a password that changed" });
            expect(SecretsFile.at(root).tryUnlock()).toBe(false);
            expect(SecretsFile.holds(file.path, "a password that changed")).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
