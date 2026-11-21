// A device can quote a secret in what it answers. Here a fake RouterOS quotes the router's password, which the plan sends with --secrets, and Circuit prints each answer with the password hidden.

import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectCommands } from "../../src/cli/project-commands";
import { Secrets } from "../../src/core/secrets";
import { Platforms } from "../../src/platforms";
import { RouterOsExport } from "../../src/platforms/routeros/export";
import { StudioDataReader } from "../../src/studio/data";
import { StudioServer } from "../../src/studio/server";
import { PathCheck } from "../../src/transport/path-check";
import { FakeSshDevice } from "../platforms/fake-ssh";

const SECRET = FakeSshDevice.PASSWORD;
const VERSION = "7.23.5";
const STUDIO_PORT = 47000 + Math.floor(Math.random() * 1000);

const example = join(import.meta.dir, "..", "..", "examples", "single-site");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-scrubbed-")));
/** Studio reads its own copy: a project is read once in a process. */
const studioFolder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-scrubbed-studio-")));
const before = process.cwd();
const printed: string[] = [];
const platform = Platforms.get("routeros");

let running = "";
let certificates = "";
/** What the device answers to a command that changes something. */
let onChange: (command: string) => string = () => "";
/** What it answers when asked to parse a command without running it. */
let onParse: (command: string) => string = () => "(evaluate)\n";

const fake = new FakeSshDevice(["operator", "operator+ct300w"], (command) => {
    if (command === ":put [/system resource get version]") return `${VERSION}\n`;
    if (command === RouterOsExport.READ) return `# 2026-10-23 10:00:00 by RouterOS ${VERSION}\n${running}${RouterOsExport.END}\n`;
    if (command.startsWith(":foreach c in=[/certificate find]")) return certificates;
    if (command === "/user export" || command.startsWith(":foreach ")) return "";
    if (command.startsWith(":put [:parse ")) return onParse(command);
    if (/^\/system (backup|scheduler)|^\/file remove/.test(command)) return "";
    if (command === "/ip address print") return `0 192.168.10.1/24 bridge comment="password ${SECRET}"\n`;

    return onChange(command);
});

let commands: ProjectCommands;
let port: number;

beforeAll(async () => {
    cpSync(example, folder, { recursive: true });
    cpSync(example, studioFolder, { recursive: true });
    process.chdir(folder);
    process.env.ROUTER_PASSWORD = SECRET;
    port = await fake.listen();

    spyOn(PathCheck, "measure").mockResolvedValue(undefined);
    // Spied before the project opens, so they get what Circuit prints after it filtered it.
    for (const name of ["log", "error"] as const)
        spyOn(console, name).mockImplementation((...line: unknown[]) => void printed.push(line.join(" ")));
    spyOn(process.stdout, "write").mockImplementation((text: string | Uint8Array) => printed.push(String(text)) > 0);

    commands = await ProjectCommands.open({ secrets: true });
    const router = commands.devices.find((device) => device.name === "router")!;
    Object.assign(router.connection, { host: "127.0.0.1", port });
    running = platform.render(router);
});

afterAll(() => {
    mock.restore();
    delete process.env.ROUTER_PASSWORD;
    for (const server of StudioServer.servers) server.close();
    fake.close();
    process.chdir(before);
    for (const copy of [folder, studioFolder]) rmSync(copy, { recursive: true, force: true });
});

/** What Circuit printed while `work` ran, and the error it stopped with, printed as the command line prints one. */
async function output(work: () => Promise<unknown>): Promise<string> {
    printed.length = 0;
    await work().catch((error: Error) => console.error(error.message));
    return printed.join("\n");
}

test("apply hides a secret the device quotes in a command it will not parse", async () => {
    onParse = (command) => (command.includes(SECRET) ? `syntax error (line 1 column 40) in ${command}\n` : "(evaluate)\n");

    const text = await output(() => commands.apply("router", true, true));
    expect(text).toContain("the device will not parse");
    expect(text).toContain(Secrets.REDACTED);
    expect(text).not.toContain(SECRET);

    onParse = () => "(evaluate)\n";
});

test("apply hides a secret the device quotes in a command it refused", async () => {
    onChange = (command) => `failure: ${command}\n`;

    const text = await output(() => commands.apply("router", true, true));
    expect(fake.commands.some((command) => command.includes(SECRET))).toBe(true);
    expect(text).toContain(`device said: failure: /user set [ find name=operator ] password="${Secrets.REDACTED}"`);
    expect(text).not.toContain(SECRET);

    onChange = () => "";
});

test("diff hides a secret the device quotes in a read it could not finish", async () => {
    certificates = `failure: no such certificate ${SECRET}\n`;

    // `diff` ends the process with its result, which a test can't, so only its read fails here.
    const text = await output(() => commands.diff("router"));
    expect(text).toContain("certificates could not be listed");
    expect(text).not.toContain(SECRET);

    certificates = "";
});

test("exec hides a secret the device prints", async () => {
    const text = await output(() => commands.exec("router", ["/ip address print"], undefined, 10));
    expect(text).toContain(`comment="password ${Secrets.REDACTED}"`);
    expect(text).not.toContain(SECRET);
});

test("Studio hides a secret in what it read from the device", async () => {
    running = `${running}/ip address set [ find address=192.168.10.1/24 ] comment="password ${SECRET}"\n`;

    await StudioServer.start({
        root: studioFolder,
        port: STUDIO_PORT,
        host: "127.0.0.1",
        allowHosts: [],
        gather: async (root) => {
            const data = await StudioDataReader.gather(root);
            if ("error" in data) throw new Error(data.error);
            for (const device of data.devices) if (device.name === "router") Object.assign(device.connection, { host: "127.0.0.1", port });
            return JSON.stringify(data);
        },
    });

    const answer = await fetch(`http://127.0.0.1:${STUDIO_PORT}/api/read?device=router`, {
        method: "POST",
        headers: { [StudioServer.REQUEST_HEADER]: "1" },
    });
    const body = await answer.text();
    expect(body).toContain(`comment=\\"password ${Secrets.REDACTED}\\"`);
    expect(body).not.toContain(SECRET);
});
