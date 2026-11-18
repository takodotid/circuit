// Each project pins its Circuit in `.circuit/version`, committed. The installed `circuit`, the manager, runs that version for every command in the project. Each version is kept once in ~/.circuit/versions/<version>/, so two projects never clash, and the manager updating itself changes no project.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Installation } from "../core/installation";
import { Releases } from "./releases";
import { Ui } from "./ui";
import { VERSION } from "./version";

export class Versions {
    static readonly FILE = ".circuit/version";

    /** Set in the environment of a pinned Circuit this one started, so it doesn't start another. */
    static readonly RUNNING = "CIRCUIT_PINNED";

    private static readonly JSON_INDENT = 4;

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

    /** The projects Circuit ran in on this machine, by folder. */
    private static projectsFile(): string {
        return join(Installation.home(), "projects.json");
    }

    static known(): string[] {
        try {
            const read = JSON.parse(readFileSync(Versions.projectsFile(), "utf8")) as { projects?: unknown };
            return Array.isArray(read.projects) ? read.projects.filter((root): root is string => typeof root === "string") : [];
        } catch {
            return [];
        }
    }

    private static save(projects: readonly string[]): void {
        try {
            mkdirSync(Installation.home(), { recursive: true });
            writeFileSync(Versions.projectsFile(), `${JSON.stringify({ projects }, null, Versions.JSON_INDENT)}\n`);
        } catch {}
    }

    /** So `prune` keeps the version the project pins. */
    static remember(root: string): void {
        const path = resolve(root);
        const known = Versions.known();
        if (!known.includes(path)) Versions.save([...known, path]);
    }

    /**
     * Removes each kept version that no remembered project still there pins now. The app's own version is never kept apart, as the app runs it. Gives back the versions removed.
     */
    static prune(app: string = VERSION): string[] {
        const projects = Versions.known().filter((root) => existsSync(join(root, "circuit.ts")));
        Versions.save(projects);

        const folder = join(Installation.home(), "versions");
        if (!existsSync(folder)) return [];

        const used = new Set(projects.map((root) => Versions.pinned(root)));
        const removed: string[] = [];
        for (const version of readdirSync(folder)) {
            if (used.has(version) && version !== app) continue;
            // One still running in another terminal is locked on Windows: it goes on a later run.
            try {
                rmSync(join(folder, version), { recursive: true, force: true });
                removed.push(version);
            } catch {}
        }
        return removed;
    }

    /** Where a version is kept once downloaded. */
    static path(version: string): string {
        return join(Installation.home(), "versions", version, process.platform === "win32" ? "circuit.exe" : "circuit");
    }

    /** A version not here yet is downloaded once the person says yes, and its signature checked. Without a person to ask, such as in CI, it is downloaded. */
    static async ensure(version: string): Promise<string> {
        const path = Versions.path(version);
        if (existsSync(path)) return path;

        if (
            Ui.interactive &&
            !(await Ui.confirm(`This project runs Circuit ${version}, which is not on this machine yet. Download it?`, true))
        )
            Ui.fail(`Not run. This project needs Circuit ${version}. To use another version, run circuit update.`);

        const bytes = await Ui.step(`Downloading Circuit ${version}`, () => Releases.fetchBinary(version));
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(`${path}.part`, bytes);
        if (process.platform !== "win32") chmodSync(`${path}.part`, Releases.EXECUTABLE_MODE);
        renameSync(`${path}.part`, path);

        return path;
    }

    /**
     * Before a command in a project. A version a security advisory affects never runs, so the person moves the project to a fixed one first. When the project pins another version, runs it with these arguments, and ends with its exit code.
     */
    static async run(root: string, argv: string[]): Promise<void> {
        if (process.env[Versions.RUNNING] || !Installation.binary()) return;

        let pinned = Versions.pinned(root) ?? VERSION;
        const { advisories } = await Ui.wait("Checking the project's Circuit for security problems", () => Releases.advisories());
        const affected = Releases.affecting(advisories, pinned);
        if (affected.length) {
            if (!Ui.interactive)
                Ui.fail(
                    `This project runs Circuit ${pinned}, which has a security problem: ${affected.map((advisory) => `${advisory.summary} (${advisory.url})`).join("; ")}. Fixed in ${[...new Set(affected.flatMap((advisory) => advisory.patched))].join(" or ")}. Run circuit update in a terminal.`
                );
            pinned =
                (await Versions.updateProject(root, false)) ?? Ui.fail("Not run: the project stays on a version with a security problem.");
        }
        if (pinned === VERSION) return;

        const binary = await Versions.ensure(pinned);
        const result = spawnSync(binary, argv, { stdio: "inherit", env: { ...process.env, [Versions.RUNNING]: "1" } });
        if (result.error) Ui.fail(`Circuit ${pinned} could not start: ${result.error.message}`);
        process.exit(result.status ?? 1);
    }

    /** Whether this Circuit was started by the manager to run a project's version, so it leaves checking and updating to it. */
    static started(): boolean {
        return Boolean(process.env[Versions.RUNNING]);
    }

    /** Move a project to a version the person picks. Gives back the version it moved to. */
    static async updateProject(root: string, confirmed: boolean): Promise<string | undefined> {
        const current = Versions.pinned(root) ?? VERSION;
        const target = await Releases.pick(current, confirmed, "This project");
        if (!target) return undefined;

        const binary = target === VERSION ? (Installation.binary() ?? (await Versions.ensure(target))) : await Versions.ensure(target);
        Versions.pin(root, target);
        Versions.remember(root);

        // The new version writes its own editor types and hook.
        spawnSync(binary, ["setup", root], { stdio: "inherit", env: { ...process.env, [Versions.RUNNING]: "1" } });
        Ui.done(`This project runs Circuit ${target} now. Commit ${Versions.FILE}.`);

        Versions.prune();
        return target;
    }
}
