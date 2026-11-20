// A tool built from the vendor's documentation runs only with --experimental. The devices are faked: a read finds nothing, and an apply sends nowhere. Junos reads BGP sessions, but has not had them tested.

import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectCommands } from "../../src/cli/project-commands";
import { Platforms } from "../../src/platforms";
import { PathCheck } from "../../src/transport/path-check";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-untested-tools-")));
const before = process.cwd();
const printed: string[] = [];
const junos = Platforms.get("junos");

/** A project is read once per folder in a process, so each run gets a copy of its own. */
async function openCopy(name: string, experimental: boolean): Promise<ProjectCommands> {
    const copy = join(folder, name);
    cpSync(join(import.meta.dir, "..", "..", "examples", "backbone"), copy, { recursive: true });
    process.chdir(copy);
    return ProjectCommands.open({ experimental });
}

beforeAll(() => {
    spyOn(PathCheck, "measure").mockResolvedValue(undefined);
    spyOn(console, "log").mockImplementation((...line: unknown[]) => void printed.push(line.join(" ")));
    spyOn(console, "error").mockImplementation((...line: unknown[]) => void printed.push(line.join(" ")));
    spyOn(junos, "read").mockResolvedValue("");
    spyOn(junos, "apply").mockResolvedValue(undefined);
    spyOn(junos, "neighbors").mockResolvedValue([]);
});

afterAll(() => {
    mock.restore();
    process.chdir(before);
    rmSync(folder, { recursive: true, force: true });
});

test("apply checks the BGP sessions on Junos only with --experimental, and says so without it", async () => {
    const health = spyOn(junos, "health").mockResolvedValue({ run: async () => [] });

    printed.length = 0;
    await (await openCopy("plain", false)).apply("core-01", true, false);
    expect(health).not.toHaveBeenCalled();
    expect(printed).toContain(
        "\nNot checking the BGP sessions after the change: on junos the check is built from the vendor's documentation, not tested on a device yet. Add --experimental to check them."
    );
    expect(printed.at(-1)).toBe("✔ core-01 applied.");

    printed.length = 0;
    await (await openCopy("experimental", true)).apply("core-01", true, false);
    expect(health).toHaveBeenCalledTimes(1);
    expect(printed.at(-1)).toBe("✔ core-01 applied. No problems found.");
});

test("circuit bgp stops on Junos without --experimental, and says how to run it", async () => {
    const exit = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
    });
    const session = spyOn(junos, "session");

    printed.length = 0;
    await expect((await openCopy("bgp", false)).bgp("core-01", { max: 600 })).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(session).not.toHaveBeenCalled();
    expect(printed.join("\n")).toContain(
        "circuit bgp on junos is built from the vendor's documentation, not tested on a device with BGP sessions yet. Add --experimental to run it"
    );
});
