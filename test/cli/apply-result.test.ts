// `circuit apply` ends on one line that says the device was applied, on a platform that checks the device after the change and on one that doesn't. The device is faked: its read finds nothing, and its apply sends nowhere.

import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectCommands } from "../../src/cli/project-commands";
import { Platforms } from "../../src/platforms";
import { PathCheck } from "../../src/transport/path-check";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-apply-result-")));
const before = process.cwd();
const printed: string[] = [];

beforeAll(() => {
    cpSync(join(import.meta.dir, "..", "..", "examples", "single-site"), folder, { recursive: true });
    process.chdir(folder);

    spyOn(PathCheck, "measure").mockResolvedValue(undefined);
    spyOn(console, "log").mockImplementation((...line: unknown[]) => void printed.push(line.join(" ")));

    for (const name of ["routeros", "vrp"] as const) {
        const platform = Platforms.get(name);
        spyOn(platform, "read").mockResolvedValue("");
        spyOn(platform, "apply").mockResolvedValue(undefined);
        if (platform.neighbors) spyOn(platform, "neighbors").mockResolvedValue([]);
        if (platform.health) spyOn(platform, "health").mockResolvedValue({ run: async () => [] });
    }
});

afterAll(() => {
    mock.restore();
    process.chdir(before);
    rmSync(folder, { recursive: true, force: true });
});

test("apply ends on a line that says the device was applied", async () => {
    const commands = await ProjectCommands.open();

    printed.length = 0;
    await commands.apply("switch", true, false);
    expect(printed.at(-1)).toBe("✔ switch applied.");

    printed.length = 0;
    await commands.apply("router", true, false);
    expect(printed.at(-1)).toBe("✔ router applied. No problems found.");
});
