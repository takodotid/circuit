// RouterOS stops SSH output at 2 MiB, mid-line and with no error. Against a fake device that cuts its export, a read fetches the export from a file over SFTP, or stops.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { RouterOsExport } from "../../src/platforms/routeros/export";
import type { Device } from "../../src/model";
import { Fixtures } from "../fixtures";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };

const router = Fixtures.device("single-site--router");
const exported = `# 2026-11-19 19:21:27 by RouterOS 7.24.6\n${platform.render(router)}`;

/** What the device answers to `/export file=<name>; :put [/file get <file> size]`. */
let writeFile: (file: string) => string;

const fake = new FakeSshDevice("operator", (command) => {
    if (command === ":put [/system resource get version]") return "7.24.6\n";
    if (command === RouterOsExport.READ) return exported.slice(0, exported.length / 2);

    const file = /^\/export file=\S+; :put \[\/file get (\S+) size\]$/.exec(command)?.[1];
    if (file) return writeFile(file);

    return "";
});

let device: Device;

beforeAll(async () => {
    process.env.ROUTER_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...router, connection: { host: "127.0.0.1", user: "operator", port: await fake.listen() } };
});

afterAll(() => {
    delete process.env.ROUTER_PASSWORD;
    fake.close();
});

test("a cut export is read whole from a file, which is then removed", async () => {
    writeFile = (file) => {
        fake.files.set(file, Buffer.from(exported));
        return `${exported.length}\n`;
    };

    const read = await platform.read(device, [device]);
    expect(platform.plan(platform.render(router), read, options).steps).toEqual([]);

    const [file] = [...fake.files.keys()];
    expect(file).toMatch(/^circuit-read-\d+\.rsc$/);
    expect(fake.commands).toContain(`/file remove [find name="${file}"]`);
});

// A group without the ftp and write policies, as a CHR refused it (7.24.6).
test("a cut export stops the read when the device refuses the file, and says which role writes one", async () => {
    writeFile = () => "not enough permissions (9) (:export; line 1)\n";

    const read = platform.read(device, [device]);
    await expect(read).rejects.toThrow("router: the export over SSH stopped before its end");
    await expect(read).rejects.toThrow('set system.users.operator.role to "admin"');
});

test("a cut export stops the read when the file comes back short", async () => {
    writeFile = (file) => {
        fake.files.set(file, Buffer.from(exported.slice(0, 100)));
        return `${exported.length}\n`;
    };

    await expect(platform.read(device, [device])).rejects.toThrow(`SFTP gave 100 of the file's ${exported.length} bytes`);
});
