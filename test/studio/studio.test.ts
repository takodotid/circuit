// Studio: what it gathers from a project, what its server answers and refuses, the page it carries, and a secret decrypted in the browser as Circuit encrypts it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretsFile } from "../../src/core/secrets-file";
import { STUDIO_ASSETS } from "../../src/studio/assets.generated";
import { StudioModel } from "../../src/studio/data";
import { StudioServer } from "../../src/studio/server";
import type { SecretsListing, StudioData } from "../../src/studio/types";
import { SecretsCrypto } from "../../src/studio/app/src/lib/secrets-crypto";
import { Fixtures } from "../fixtures";

const folder = mkdtempSync(join(tmpdir(), "circuit-studio-"));
const port = 46000 + Math.floor(Math.random() * 1000);
const url = `http://127.0.0.1:${port}`;

// The colocation example: an edge router and a switch, linked to each other.
beforeAll(async () => {
    writeFileSync(
        join(folder, "circuit.ts"),
        `export const colocation = circuit({ asn: 64500, sites: { colocation: { description: "colocation" } } });\n`
    );
    mkdirSync(join(folder, "sites", "colocation"), { recursive: true });

    for (const name of Fixtures.names().filter((name) => name.startsWith("colocation--"))) {
        writeFileSync(
            join(folder, "sites", "colocation", `${name.split("--")[1]}.ts`),
            `import { colocation } from "../../circuit";\n\nexport default colocation.device(${JSON.stringify(Fixtures.device(name), null, 4)});\n`
        );
    }

    const secrets = SecretsFile.at(folder);
    secrets.unlock("a password for the test");
    secrets.set("EDGE_01_PASSWORD", "s3cret-value");
    writeFileSync(secrets.path, `${await Bun.file(secrets.path).text()}PLAIN_ONE=never-sent\n`);

    await StudioServer.start({
        root: folder,
        port,
        host: "127.0.0.1",
        allowHosts: [],
        gather: async (root) => JSON.stringify(await StudioModel.gather(root)),
    });
});

afterAll(() => {
    for (const server of StudioServer.servers) server.close();
    rmSync(folder, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) => fetch(`${url}${path}`, init);

describe("the server", () => {
    test("serves the page it carries", async () => {
        const page = await get("/");
        expect(page.status).toBe(200);
        expect(page.headers.get("content-type")).toContain("text/html");
        expect(await page.text()).toContain("<title>Circuit Studio</title>");
    });

    test("serves what it gathered: devices, findings, what each would run, the graph", async () => {
        const data = (await (await get("/api/data")).json()) as StudioData;

        expect(data.devices.map((device) => device.name).sort()).toEqual(["edge-01", "tor-01"]);
        expect(Array.isArray(data.findings)).toBe(true);
        expect(data.rendered["edge-01"]!.length).toBeGreaterThan(100);
        expect(data.rendered["edge-01"]).not.toContain("Cannot be rendered");
        expect(data.files["edge-01"]).toBe("sites/colocation/edge-01.ts");
        expect(data.ports["tor-01"]!.length).toBeGreaterThan(0);
        expect(data.cables).toEqual([expect.objectContaining({ device: "edge-01", farDevice: "tor-01" })]);
        expect(data.graph.edges.some((edge) => edge.layer === "l1" && edge.from === "device:edge-01" && edge.to === "device:tor-01")).toBe(
            true
        );
        expect(data.secrets).toContain("EDGE_01_PASSWORD");
    });

    test("lists the secrets with ciphertexts only: a value in plain text never leaves", async () => {
        const listing = (await (await get("/api/secrets")).json()) as SecretsListing;
        expect(listing.files.map((file) => file.file)).toEqual([SecretsFile.DEFAULT]);
        const byName = Object.fromEntries(listing.files[0]!.entries.map((entry) => [entry.name, entry]));

        expect(byName.EDGE_01_PASSWORD).toMatchObject({ kind: "encrypted", needed: true });
        expect(byName.EDGE_01_PASSWORD!.ciphertext).toStartWith("encrypted:");
        expect(byName.PLAIN_ONE).toEqual({ name: "PLAIN_ONE", kind: "not encrypted", needed: false });
        expect(JSON.stringify(listing)).not.toContain("never-sent");
        expect(JSON.stringify(listing)).not.toContain("s3cret-value");
        expect(listing.files[0]!.passwordLocation).toBeUndefined();
    });

    test("refuses a request addressed to another name", async () => {
        const answer = await fetch(`${url}/api/data`, { headers: { host: "evil.example" } });
        expect(answer.status).toBe(403);
    });

    test("reads a device only on a POST with Studio's own header", async () => {
        expect((await get("/api/read?device=edge-01")).status).toBe(403);
        expect((await get("/api/read?device=edge-01", { method: "POST" })).status).toBe(403);

        const unknown = await get("/api/read?device=nobody", { method: "POST", headers: { [StudioServer.REQUEST_HEADER]: "1" } });
        expect(await unknown.json()).toEqual({ error: "no device nobody" });
    });
});

test("the page carries every file its index names", () => {
    const index = Buffer.from(STUDIO_ASSETS["index.html"]!.body, "base64").toString("utf8");
    const named = [...index.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((match) => match[1]!);

    expect(named.length).toBeGreaterThan(2);
    for (const file of named) expect(STUDIO_ASSETS[file]).toBeDefined();
});

describe("decrypting a secret in the browser", () => {
    const root = mkdtempSync(join(tmpdir(), "circuit-studio-crypto-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    test("reads what Circuit encrypts, and only with the right password and name", async () => {
        const file = SecretsFile.at(root);
        file.unlock("correct horse battery staple");
        file.set("A_PASSWORD", "pässword with # and spaces");
        const value = file.values().A_PASSWORD!;

        expect(await new SecretsCrypto("correct horse battery staple").decrypt("A_PASSWORD", value)).toBe("pässword with # and spaces");
        await expect(new SecretsCrypto("wrong password").decrypt("A_PASSWORD", value)).rejects.toThrow();
        await expect(new SecretsCrypto("correct horse battery staple").decrypt("B_PASSWORD", value)).rejects.toThrow();
    });
});
