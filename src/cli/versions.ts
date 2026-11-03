// Each project pins its Circuit in `.circuit/version`, committed. The installed `circuit` runs that version, kept once in ~/.circuit/versions/<version>/, so two projects on different versions never clash and updating the app changes no project.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Releases } from "./releases";
import { Ui } from "./ui";
import { VERSION } from "./version";

export class Versions {
    /** The file at a project's root that names its Circuit version. */
    static readonly FILE = ".circuit/version";

    /** Set in the environment of a pinned Circuit this one started, so it doesn't start another. */
    private static readonly RUNNING = "CIRCUIT_PINNED";

    /** The version a project pins, or undefined when it pins none. */
    static pinned(root: string): string | undefined {
        const path = join(root, Versions.FILE);
        if (!existsSync(path)) return undefined;

        const version = readFileSync(path, "utf8").trim();
        return version || undefined;
    }

    static pin(root: string, version: string): void {
        mkdirSync(join(root, ".circuit"), { recursive: true });
        writeFileSync(join(root, Versions.FILE), `${version}\n`);
    }

    /** Where a version is kept once downloaded. */
    static path(version: string): string {
        return join(Releases.home(), "versions", version, process.platform === "win32" ? "circuit.exe" : "circuit");
    }

    /** A version's binary, downloaded and checked first when it is not here yet. */
    static async ensure(version: string): Promise<string> {
        const path = Versions.path(version);
        if (existsSync(path)) return path;

        const bytes = await Ui.step(`Downloading Circuit ${version}, which this project uses`, () => Releases.fetchBinary(version));
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(`${path}.part`, bytes);
        if (process.platform !== "win32") chmodSync(`${path}.part`, 0o755);
        renameSync(`${path}.part`, path);

        return path;
    }

    /** In a project that pins another version, run that version with these arguments, and end with its exit code. Nothing when this Circuit is the one to run. */
    static async runPinned(root: string, argv: string[]): Promise<void> {
        const pinned = Versions.pinned(root);
        if (!pinned || pinned === VERSION || process.env[Versions.RUNNING] || !Releases.binary()) return;

        const binary = await Versions.ensure(pinned);
        const result = spawnSync(binary, argv, { stdio: "inherit", env: { ...process.env, [Versions.RUNNING]: "1" } });
        if (result.error) Ui.fail(`Circuit ${pinned} could not start: ${result.error.message}`);
        process.exit(result.status ?? 1);
    }

    /** Move a project to the newest version of its major, once the person says yes. Gives back the version it moved to. */
    static async updateProject(root: string, confirmed: boolean): Promise<string | undefined> {
        const current = Versions.pinned(root) ?? VERSION;
        const target = await Releases.newer(current);
        if (!target) {
            Ui.done(`This project runs Circuit ${current}, the newest of ${current.split(".")[0]}.x.`);
            return undefined;
        }

        Ui.note(
            `This project runs Circuit ${current}. ${target} is out.\nWhat changed: https://github.com/takodotid/circuit/releases/tag/v${target}\nRun circuit validate and circuit diff after, before you apply.`,
            "Update"
        );
        if (!confirmed) {
            if (!Ui.interactive) Ui.fail("Not updated. Without a person to answer, add --confirm.");
            if (!(await Ui.confirm(`Move this project to Circuit ${target}?`))) return undefined;
        }

        const binary = await Versions.ensure(target);
        Versions.pin(root, target);

        // The new version writes its own editor types and hook.
        spawnSync(binary, ["setup", root], { stdio: "inherit", env: { ...process.env, [Versions.RUNNING]: "1" } });
        Ui.done(`This project runs Circuit ${target} now. Commit ${Versions.FILE}.`);
        return target;
    }
}
