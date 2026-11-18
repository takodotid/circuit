// The user's file and line on the stack, as each operating system prints it. Only Linux and macOS leave out the brackets, and only for code outside any function, such as a device file's own lines.

import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userFrames } from "../../src/config/merge";
import { Project, ProjectError } from "../../src/project";

const stack = (...frames: string[]) => Object.assign(new Error(), { stack: ["Error: x", ...frames].join("\n") });

test("a frame outside any function is the file, not `at` and the file", () => {
    expect(userFrames(stack("    at /tmp/net/sites/home/cpe-01.ts:3:16"))).toEqual(["/tmp/net/sites/home/cpe-01.ts:3"]);
    expect(userFrames(stack("    at /tmp/my net/sites/cpe-01.ts:3:16"))).toEqual(["/tmp/my net/sites/cpe-01.ts:3"]);
});

test("a frame in a function, and a Windows path, are read as before", () => {
    expect(userFrames(stack("    at part (/tmp/net/lib/tenancy.ts:12:5)"))).toEqual(["/tmp/net/lib/tenancy.ts:12"]);
    expect(userFrames(stack("    at C:\\net\\sites\\home\\cpe-01.ts:3:16"))).toEqual(["C:\\net\\sites\\home\\cpe-01.ts:3"]);
    expect(userFrames(stack("    at part (C:\\net\\lib\\tenancy.ts:12:5)"))).toEqual(["C:\\net\\lib\\tenancy.ts:12"]);
});

test("Circuit's own frames are left out wherever they are printed", () => {
    const own = decodeURIComponent(new URL("../../src/config/merge.ts", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
    expect(userFrames(stack(`    at ${own}:30:1`, `    at merge (${own}:40:2)`, "    at /tmp/net/circuit.ts:5:1"))).toEqual([
        "/tmp/net/circuit.ts:5",
    ]);
});

test("a file named in the error's message is no frame", () => {
    const message = `Error: interfaces.ethernet.40g-5.description is written twice with two values: "ix-sw-01 40GE1/0/5" in /tmp/net/sites/ix-1/ix-sw-02.ts:7, and "Fastly, AS54113" in /tmp/net/members/fastly.ts:5.`;

    expect(userFrames(Object.assign(new Error(), { stack: `${message}\n    at /tmp/net/sites/ix-1/ix-sw-02.ts:7:16` }))).toEqual([
        "/tmp/net/sites/ix-1/ix-sw-02.ts:7",
    ]);
});

test("a member that writes a switch's own port is said once, at the switch's file", async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-stack-frames-")));
    cpSync(join(import.meta.dir, "..", "..", "examples", "internet-exchange"), folder, { recursive: true });
    writeFileSync(
        join(folder, "members", "fastly.ts"),
        [
            'import { ix_1 } from "../sites/ix-1/site";',
            "",
            "export const fastly = {",
            "    parts: {",
            '        "ix-sw-02": part("device", {',
            '            interfaces: { ethernet: { "40g-5": { ...ix_1.member_port, description: "Fastly, AS54113" } } },',
            "        }),",
            "    },",
            "};",
        ].join("\n")
    );
    writeFileSync(
        join(folder, "members", "index.ts"),
        [
            'import { cloudflare } from "./cloudflare";',
            'import { fastly } from "./fastly";',
            'import { google } from "./google";',
            "",
            "export const members = merge([cloudflare, google, fastly]);",
        ].join("\n")
    );

    try {
        const error = await Project.read(folder).then(
            () => undefined,
            (error_: unknown) => error_
        );

        expect(error).toBeInstanceOf(ProjectError);
        expect((error as ProjectError).lines).toEqual([
            'sites/ix-1/ix-sw-02.ts:7: interfaces.ethernet.40g-5.description is written twice with two values: "ix-sw-01 40GE1/0/5" in sites/ix-1/ix-sw-02.ts:7, and "Fastly, AS54113" in members/fastly.ts:5. One name holds one value: rename one, or make both the same.',
        ]);
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});
