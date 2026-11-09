// The user's file and line on the stack, as each operating system prints it: Windows always in brackets, Linux and macOS without them
// for code outside any function, such as a device file's own lines.

import { expect, test } from "bun:test";
import { userFrames } from "../../src/config/merge";

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
