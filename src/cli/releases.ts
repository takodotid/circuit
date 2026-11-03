// Which Circuit is current, and getting it. The installed `circuit` is the manager: before every command but `uninstall`, it asks the npm registry, at most every 30 seconds, and updates itself to the newest release of its major version: `latest` on npm, or `rc` while it runs a release candidate. A project's own version changes only when the person picks one (`circuit update`). A version a security advisory affects (see `Advisories`) never runs. Every binary Circuit downloads is checked against its release's SHA256SUMS, signed with the release key (see `Signing`).

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type Advisory, Advisories } from "./advisories";
import { Signing } from "./signing";
import { Ui } from "./ui";
import { VERSION } from "./version";

/** One published version, and why it is deprecated, when it is. */
export type Release = { version: string; deprecated?: string };

/** What Circuit learns from the registry. */
export type Latest = {
    /** The npm dist-tags, such as `{ latest: "1.0.0", rc: "1.1.0-rc.1", "latest-1.9": "1.9.5" }`. */
    tags: Record<string, string>;
    /** Why this version is deprecated, when it is. */
    deprecated?: string;
};

export class Releases {
    static readonly REGISTRY = "https://registry.npmjs.org";
    static readonly PACKAGE = "@takodotid/circuit";
    static readonly DOWNLOADS = "https://github.com/takodotid/circuit/releases/download";

    /** How long a check counts before Circuit asks again. */
    private static readonly FRESH_SECONDS = 30;
    /** How long Circuit waits for the registry before going on without it. */
    private static readonly TIMEOUT_MS = 3000;
    /** Set for the Circuit a manager started after updating itself, so it doesn't update again. */
    private static readonly UPDATED = "CIRCUIT_UPDATED";

    /** How many versions `circuit update` offers, newest first. */
    static readonly OFFERED = 5;

    /** Where Circuit keeps what it learned and the versions projects pin: `~/.circuit`, or `CIRCUIT_HOME` for a test. */
    static home(): string {
        return process.env.CIRCUIT_HOME || join(homedir(), ".circuit");
    }

    private static cachePath(): string {
        return join(Releases.home(), "latest.json");
    }

    /** Below 0 when `a` is older than `b`, 0 when the same, above 0 when newer. Versions as semver writes them, such as `1.0.0-rc.2`. */
    static compare(a: string, b: string): number {
        const parse = (version: string) => {
            const [core, pre] = version.replace(/^v/, "").split("-", 2) as [string, string | undefined];
            return { core: core.split(".").map(Number), pre: pre?.split(".") ?? [] };
        };
        const left = parse(a);
        const right = parse(b);

        for (let i = 0; i < 3; i++) {
            const difference = (left.core[i] ?? 0) - (right.core[i] ?? 0);
            if (difference) return difference;
        }

        // A release candidate comes before its release.
        if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length;

        for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
            const x = left.pre[i];
            const y = right.pre[i];
            if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
            if (x === y) continue;

            const numbers = /^\d+$/.test(x) && /^\d+$/.test(y);
            return numbers ? Number(x) - Number(y) : x < y ? -1 : 1;
        }

        return 0;
    }

    private static major(version: string): number {
        return Number(version.replace(/^v/, "").split(".")[0]);
    }

    /** The version this Circuit should be at: the newest stable one of its major version, or the newest release candidate while it runs one. Undefined when the registry names none. */
    static target(latest: Latest, current = VERSION): string | undefined {
        const candidates = [latest.tags.latest, current.includes("-") ? latest.tags.rc : undefined].filter(
            (version): version is string => version !== undefined && Releases.major(version) === Releases.major(current)
        );

        return candidates.sort((a, b) => Releases.compare(b, a))[0];
    }

    /** A newer major version than this one, when the registry's stable release is one. */
    static newerMajor(latest: Latest, current = VERSION): string | undefined {
        const stable = latest.tags.latest;
        return stable && Releases.major(stable) > Releases.major(current) ? stable : undefined;
    }

    private static readCache(): { checked: number; version: string; latest: Latest } | undefined {
        try {
            const cached = JSON.parse(readFileSync(Releases.cachePath(), "utf8"));
            return cached.version === VERSION ? cached : undefined;
        } catch {
            return undefined;
        }
    }

    private static async json(url: string): Promise<Record<string, unknown>> {
        const response = await fetch(url, { signal: AbortSignal.timeout(Releases.TIMEOUT_MS), headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`the registry answered ${response.status}`);
        return (await response.json()) as Record<string, unknown>;
    }

    /** The registry's dist-tags, and whether this version is deprecated, from the cache when read in the last 30 seconds. `offline` when the registry could not be read, with the last answer, if any. */
    static async latest(fresh = false): Promise<{ latest?: Latest; offline: boolean }> {
        const cached = Releases.readCache();
        if (!fresh && cached && Date.now() - cached.checked < Releases.FRESH_SECONDS * 1000)
            return { latest: cached.latest, offline: false };

        try {
            const [tags, own] = await Promise.all([
                Releases.json(`${Releases.REGISTRY}/-/package/${Releases.PACKAGE}/dist-tags`),
                // A version not published, such as one built from the sources, is not deprecated.
                Releases.json(`${Releases.REGISTRY}/${Releases.PACKAGE}/${VERSION}`).catch(() => ({}) as Record<string, unknown>),
            ]);
            const latest: Latest = {
                tags: tags as Record<string, string>,
                ...(typeof own.deprecated === "string" ? { deprecated: own.deprecated } : {}),
            };

            try {
                mkdirSync(Releases.home(), { recursive: true });
                writeFileSync(Releases.cachePath(), JSON.stringify({ checked: Date.now(), version: VERSION, latest }));
            } catch {}
            return { latest, offline: false };
        } catch {
            return { ...(cached ? { latest: cached.latest } : {}), offline: true };
        }
    }

    /** The security advisories, from the cache when read in the last two minutes. */
    static advisories(fresh = false): Promise<{ advisories: Advisory[]; offline: boolean }> {
        return Advisories.read(Releases.home(), fresh);
    }

    /** The advisories that affect `version`. */
    static affecting(advisories: readonly Advisory[], version: string): Advisory[] {
        return Advisories.affecting(advisories, version, Releases.compare);
    }

    /**
     * Before every command but `uninstall`: the manager updates itself to the newest release of its major and runs the command again
     * as that version; it warns when it could not check, and when this version is deprecated. Run from the sources, or as a version a
     * manager started, it only checks.
     */
    static async check(argv: readonly string[]): Promise<void> {
        const [{ latest, offline }, advisories] = await Ui.wait("Checking for a newer Circuit", () =>
            Promise.all([Releases.latest(), Releases.advisories()])
        );

        if (offline || advisories.offline)
            Ui.warn("Could not reach the npm registry or GitHub, so Circuit could not check that it is current and safe. Go carefully.");
        if (latest?.deprecated) Ui.warn(`Circuit ${VERSION} is deprecated: ${latest.deprecated}`);

        const major = latest && Releases.newerMajor(latest);
        if (major)
            Ui.warn(
                `Circuit ${major} is out, a new major version. Circuit stays on ${Releases.major(VERSION)}.x; read what changed at https://circuit.tako.id before you move.`
            );

        const target = latest && Releases.target(latest);
        if (!target || Releases.compare(VERSION, target) >= 0 || Releases.affecting(advisories.advisories, target).length) return;

        const binary = Releases.binary();
        if (!binary || process.env[Releases.UPDATED]) {
            Ui.warn(`Circuit ${target} is out, and this is ${VERSION}.`);
            return;
        }

        try {
            Releases.replace(binary, await Ui.step(`Updating Circuit to ${target}`, () => Releases.fetchBinary(target)));
        } catch (error) {
            Ui.warn(`Circuit ${target} is out, and could not be installed: ${(error as Error).message}`);
            return;
        }
        Ui.done(`Circuit is ${target} now. Your projects keep the version they pin.`);

        // The command runs on as the new version.
        const result = spawnSync(binary, argv, { stdio: "inherit", env: { ...process.env, [Releases.UPDATED]: "1" } });
        if (result.error) Ui.fail(`Circuit ${target} could not start: ${result.error.message}`);
        process.exit(result.status ?? 1);
    }

    /** This Circuit's own file, when it runs as the installed binary rather than from its sources. */
    static binary(): string | undefined {
        return /^circuit(-[\w-]+)?(\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : undefined;
    }

    /** The release file for this system, such as `circuit-linux-x64`. Undefined on a system Circuit is not built for. */
    static asset(platform: string = process.platform, arch: string = process.arch): string | undefined {
        const systems: Record<string, string> = { linux: "linux", darwin: "darwin", win32: "windows" };
        const system = systems[platform];
        if (!system || !["x64", "arm64"].includes(arch) || (system === "windows" && arch !== "x64")) return undefined;

        return `circuit-${system}-${arch}${system === "windows" ? ".exe" : ""}`;
    }

    /** Remove what an update on Windows left: the old binary, kept aside while it still ran. */
    static tidy(): void {
        const binary = Releases.binary();
        if (!binary) return;

        const folder = dirname(binary);
        for (const name of readdirSync(folder).filter((file) => file.startsWith(`${basename(binary)}.old`))) {
            // One still running in another terminal is locked on Windows: it goes on a later run.
            try {
                rmSync(join(folder, name), { force: true });
            } catch {}
        }
    }

    /** The file of a release's SHA256SUMS that names `asset`, when the signature is the release key's. Throws otherwise. */
    static expectedHash(sums: Buffer, signature: string, asset: string, keys: readonly string[] = Signing.KEYS): string {
        if (!Signing.verify(sums, signature, keys))
            throw new Error("the release's SHA256SUMS is not signed with Circuit's release key, so nothing was installed");

        const expected = sums
            .toString("utf8")
            .split("\n")
            .find((line) => line.trim().endsWith(` ${asset}`) || line.trim().endsWith(`*${asset}`))
            ?.split(/\s+/)[0];
        if (!expected) throw new Error(`the release's SHA256SUMS names no ${asset}`);
        return expected;
    }

    /** One release's binary for this system, checked against the release's SHA256SUMS and its signature. */
    static async fetchBinary(version: string): Promise<Buffer> {
        const asset = Releases.asset() ?? Ui.fail(`Circuit is not built for ${process.platform} ${process.arch}.`);
        const download = async (file: string) => {
            const response = await fetch(`${Releases.DOWNLOADS}/v${version}/${file}`);
            if (!response.ok) throw new Error(`${file} of Circuit ${version}: GitHub answered ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        };

        const [file, sums, signature] = await Promise.all([download(asset), download("SHA256SUMS"), download("SHA256SUMS.sig")]);
        const expected = Releases.expectedHash(sums, signature.toString("utf8"), asset);
        const actual = createHash("sha256").update(file).digest("hex");
        if (expected !== actual) throw new Error(`${asset} does not match the release's signed SHA256SUMS, so it was not installed`);

        return file;
    }

    /** Every published version, and which are deprecated. A stop when the registry can't be read. */
    static async releases(): Promise<Release[]> {
        try {
            const packument = await Ui.step("Checking for a newer Circuit", async () => {
                const response = await fetch(`${Releases.REGISTRY}/${Releases.PACKAGE}`, {
                    signal: AbortSignal.timeout(Releases.TIMEOUT_MS * 3),
                    // The short form npm itself installs from: each version and whether it is deprecated.
                    headers: { accept: "application/vnd.npm.install-v1+json" },
                });
                if (!response.ok) throw new Error(`the registry answered ${response.status}`);
                return (await response.json()) as { versions?: Record<string, { deprecated?: string }> };
            });
            return Object.entries(packument.versions ?? {}).map(([version, about]) => ({
                version,
                ...(about.deprecated ? { deprecated: about.deprecated } : {}),
            }));
        } catch {
            return Ui.fail("Could not reach the npm registry to learn the newest Circuit. Check the internet connection and try again.");
        }
    }

    /**
     * The versions to offer after `current`, newest first, at most `count`: of its major version, never one an advisory affects. A
     * release candidate only while `current` is one. The safe version closest to `current`, the fix that changes the least, is always
     * among them.
     */
    static choices(
        releases: readonly Release[],
        current: string,
        advisories: readonly Advisory[] = [],
        count = Releases.OFFERED
    ): Release[] {
        const safe = releases
            .filter(
                (release) =>
                    Releases.major(release.version) === Releases.major(current) &&
                    Releases.compare(release.version, current) > 0 &&
                    !Releases.affecting(advisories, release.version).length &&
                    (current.includes("-") || !release.version.includes("-"))
            )
            .sort((a, b) => Releases.compare(b.version, a.version));

        const offered = safe.slice(0, count);
        const closest = safe.at(-1);
        if (closest && !offered.includes(closest)) offered[offered.length - 1] = closest;
        return offered;
    }

    /**
     * Which version `what` moves to: the person picks from the newest few, the newest at the top, or stays, unless an advisory affects
     * the version it runs: then it must move. With `confirmed`, the newest. Undefined when it stays.
     */
    static async pick(current: string, confirmed: boolean, what: string): Promise<string | undefined> {
        const [releases, { advisories }] = await Promise.all([Releases.releases(), Releases.advisories(true)]);
        const choices = Releases.choices(releases, current, advisories);
        const affected = Releases.affecting(advisories, current);
        const closest = choices.at(-1)?.version;

        if (!choices.length) {
            if (affected.length)
                Ui.fail(
                    `${what} runs Circuit ${current}, which ${affected[0]!.id} affects, and no fixed version of ${Releases.major(current)}.x is out yet. See ${affected[0]!.url}`
                );
            Ui.done(`${what} runs Circuit ${current}, the newest of ${Releases.major(current)}.x.`);
            return undefined;
        }
        if (confirmed) return choices[0]!.version;
        if (!Ui.interactive) Ui.fail("Not updated. Without a person to answer, add --confirm, which takes the newest.");

        const problem = affected.map((advisory) => `${advisory.summary} (${advisory.severity}): ${advisory.url}`).join("\n");
        Ui.note(
            `${what} runs Circuit ${current}.${affected.length ? `\nIt has a security problem, so it must move to a fixed version:\n${problem}` : ""}\nWhat changed: https://github.com/takodotid/circuit/releases\nRun circuit validate and circuit diff after, before you apply.`,
            affected.length ? "Update required" : "Update"
        );
        const picked = await Ui.select<string>(affected.length ? "Move to which fixed version?" : "Which version?", [
            ...choices.map((release, i) => ({
                value: release.version,
                label: release.version,
                hint: [
                    i === 0 ? "newest" : "",
                    release.version === closest && choices.length > 1 ? "closest to yours, the least that changes" : "",
                    release.version.includes("-") ? "release candidate" : "",
                    release.deprecated ? `deprecated: ${release.deprecated}` : "",
                ]
                    .filter(Boolean)
                    .join(", "),
            })),
            ...(affected.length ? [] : [{ value: "", label: `Stay on ${current}` }]),
        ]);
        return picked || undefined;
    }

    /** Update the installed manager to a version the person picks. Gives back that version. */
    static async updateApp(confirmed: boolean): Promise<string | undefined> {
        const binary =
            Releases.binary() ?? Ui.fail("This Circuit runs from its sources. Update it where it came from, such as with git pull.");
        const target = await Releases.pick(VERSION, confirmed, "Circuit");
        if (!target) return undefined;

        Releases.replace(binary, await Ui.step(`Downloading Circuit ${target}`, () => Releases.fetchBinary(target)));
        Ui.done(`Circuit is ${target} now.`);
        return target;
    }

    /** Put `bytes` in place of the running binary. Windows does not let a running program be overwritten, but lets it be renamed, so the old one is moved aside and removed on the next run. */
    static replace(binary: string, bytes: Buffer): void {
        const next = `${binary}.new`;
        writeFileSync(next, bytes);

        if (process.platform === "win32") {
            // An old one still running elsewhere can't be removed: the new one goes in beside it, under another name.
            try {
                rmSync(`${binary}.old`, { force: true });
            } catch {}
            if (existsSync(`${binary}.old`)) renameSync(`${binary}.old`, `${binary}.old-${Date.now()}`);
            renameSync(binary, `${binary}.old`);
            renameSync(next, binary);
            return;
        }

        chmodSync(next, 0o755);
        renameSync(next, binary);
    }
}
