// RouterOS read and apply over a real SSH session, against a fake device that answers like RouterOS 7: the version check, the export, the dry parse of each command, the backup and rollback, and the fresh login that proves access.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Server } from "ssh2";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import router from "../../templates/single-site/router";

class FakeRouterOs {
    readonly commands: string[] = [];
    version = "7.23.5";
    running: string;
    private readonly server: Server;

    constructor(
        before: string,
        private readonly after: string
    ) {
        this.running = before;

        const { privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs1", format: "pem" },
            publicKeyEncoding: { type: "pkcs1", format: "pem" },
        });

        this.server = new Server({ hostKeys: [privateKey] }, (client) => {
            client.on("authentication", (context) => {
                const allowed = context.method === "password" && context.username === "operator" && context.password === "lab-pass";
                if (allowed) context.accept();
                else context.reject(["password"]);
            });

            client.on("ready", () => {
                client.on("session", (accept) => {
                    accept().on("exec", (acceptExec, _reject, info) => {
                        const stream = acceptExec();
                        stream.write(this.answer(info.command));
                        stream.exit(0);
                        stream.end();
                    });
                });
            });

            client.on("error", () => {});
        });
    }

    listen(): Promise<number> {
        return new Promise((done) => this.server.listen(0, "127.0.0.1", () => done((this.server.address() as AddressInfo).port)));
    }

    close(): void {
        this.server.close();
    }

    /** What the device prints for a command. Any command that is not a read, a dry parse or the rollback guard changes it to the desired config. */
    private answer(command: string): string {
        this.commands.push(command);

        if (command === ":put [/system resource get version]") return `${this.version}\n`;
        if (command === "/export") return `# 2026-10-23 10:00:00 by RouterOS ${this.version}\n${this.running}`;
        if (command === "/user export" || command.startsWith(":foreach c in=[/certificate find]")) return "";
        if (command.startsWith(":put [:parse ")) return "(evaluate)\n";
        if (/^\/system (backup|scheduler)|^\/file remove/.test(command)) return "";

        this.running = this.after;
        return "";
    }
}

const platform = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };

const desired: Device = { ...router, connection: { host: "127.0.0.1", user: "operator" } };
const before: Device = { ...desired, ports: { ...desired.ports, "25g-1": { ...desired.ports!["25g-1"]!, description: "Old switch" } } };

const fake = new FakeRouterOs(platform.render(before), platform.render(desired));
let device: Device;

beforeAll(async () => {
    process.env.ROUTER_PASSWORD = "lab-pass";
    device = { ...desired, connection: { ...desired.connection, port: await fake.listen() } };
});

afterAll(() => fake.close());

test("a read and an apply over SSH change only what differs, guarded by a backup and a fresh login, and converge", async () => {
    const plan = platform.plan(platform.render(device), await platform.read(device, [device]), options);
    expect(plan.steps.flatMap((step) => step.send)).toEqual(["/interface ethernet set [ find default-name=sfp28-1 ] comment=Switch"]);

    await platform.apply(device, [device], plan, options);

    const sent = fake.commands.filter((command) => !command.startsWith(":put [:parse ") && !command.startsWith(":foreach"));
    expect(sent).toContain("/interface ethernet set [ find default-name=sfp28-1 ] comment=Switch");
    expect(sent.some((command) => command.startsWith("/system backup save name=pre-apply-"))).toBe(true);
    expect(sent.filter((command) => command === '/system scheduler remove [find name="apply-rollback"]')).toHaveLength(2);
    expect(sent.at(-1)).toMatch(/^\/file remove \[find name="pre-apply-\d+\.backup"\]$/);

    const again = platform.plan(platform.render(device), await platform.read(device, [device]), options);
    expect(again.steps).toEqual([]);
});

test("a device on another major version is refused before anything is read", async () => {
    fake.version = "6.49.10";
    const count = fake.commands.length;

    await expect(platform.read(device, [device])).rejects.toThrow("router runs RouterOS 6.49.10; this adapter renders for version 7");
    expect(fake.commands.slice(count)).toEqual([":put [/system resource get version]"]);

    fake.version = "7.23.5";
});
