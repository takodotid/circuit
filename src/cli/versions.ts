// Each project pins its Circuit in `.circuit/version`, committed. The installed `circuit` runs that version, kept once in ~/.circuit/versions/<version>/, so two projects on different versions never clash. Circuit remembers the projects it ran in, so a kept version no project pins any more is removed, and the app follows the newest version a project moves to.

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

    /** The projects Circuit ran in on this machine, by folder. */
    private static projectsFile(): string {
        return join(Releases.home(), "projects.json");
    }

    /** The projects Circuit remembers. */
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
            mkdirSync(Releases.home(), { recursive: true });
            writeFileSync(Versions.projectsFile(), `${JSON.stringify({ projects }, null, 4)}\n`);
        } catch {}
    }

    /** Remember a project, so the version it pins is kept. */
    static remember(root: string): void {
        const path = resolve(root);
        const known = Versions.known();
        if (!known.includes(path)) Versions.save([...known, path]);
    }

    /**
     * Remove each kept version no project pins any more: a project is one Circuit ran in that is still there, and its version is what its
     * `.circuit/version` says now. The app's own version is never kept apart: the app runs it. Gives back the versions removed.
     */
    static prune(app: string = VERSION): string[] {
        const projects = Versions.known().filter((root) => existsSync(join(root, "circuit.ts")));
        Versions.save(projects);

        const folder = join(Releases.home(), "versions");
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

        let binary = await Versions.ensure(pinned);
        // A project on a newer version than the app, such as after a teammate's update: the app follows it.
        if (Releases.compare(pinned, VERSION) > 0) {
            Versions.follow(pinned, binary);
            binary = Releases.binary()!;
            Versions.prune(pinned);
        }

        const result = spawnSync(binary, argv, { stdio: "inherit", env: { ...process.env, [Versions.RUNNING]: "1" } });
        if (result.error) Ui.fail(`Circuit ${pinned} could not start: ${result.error.message}`);
        process.exit(result.status ?? 1);
    }

    /** Move a project to a version the person picks, then the app with it when that version is newer than the app. Gives back the version it moved to. */
    static async updateProject(root: string, confirmed: boolean): Promise<string | undefined> {
        const current = Versions.pinned(root) ?? VERSION;
        const target = await Releases.pick(current, confirmed, "This project");
        if (!target) return undefined;

        const binary = target === VERSION ? (Releases.binary() ?? (await Versions.ensure(target))) : await Versions.ensure(target);
        Versions.pin(root, target);
        Versions.remember(root);

        // The new version writes its own editor types and hook.
        spawnSync(binary, ["setup", root], { stdio: "inherit", env: { ...process.env, [Versions.RUNNING]: "1" } });
        Ui.done(`This project runs Circuit ${target} now. Commit ${Versions.FILE}.`);

        Versions.follow(target, binary);
        Versions.prune(Releases.compare(target, VERSION) > 0 && Releases.binary() ? target : VERSION);
        return target;
    }

    /** The app follows the newest version a project moved to: when `version` is newer than the app, the app becomes it, from the binary already here. A project that still pins the app's old version keeps it, kept apart. */
    private static follow(version: string, binary: string): void {
        const app = Releases.binary();
        if (!app || Releases.compare(version, VERSION) <= 0) return;

        const stillUsed = Versions.known().some((root) => existsSync(join(root, "circuit.ts")) && Versions.pinned(root) === VERSION);
        if (stillUsed && !existsSync(Versions.path(VERSION))) {
            mkdirSync(join(Versions.path(VERSION), ".."), { recursive: true });
            copyFileSync(app, Versions.path(VERSION));
        }

        Releases.replace(app, readFileSync(binary));
        Ui.done(`The Circuit app is ${version} now too, the newest a project of yours runs.`);
    }
}
