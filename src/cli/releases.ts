// Which Circuit is current, and updating to it. Circuit asks the npm registry, at most once a minute: the dist-tag `latest` is the newest stable release, `rc` the newest release candidate. A release that fixes something critical is marked by deprecating the versions before it, with a message that starts with "critical"; such a version stops every command but `update`. An update stays within the major version, as `npm update` does: a new major version is a choice.

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Ui } from "./ui";
import { VERSION } from "./version";

/** One published version, and why it is deprecated, when it is. */
export type Release = { version: string; deprecated?: string };

/** What Circuit learns from the registry. */
export type Latest = {
    /** The npm dist-tags, such as `{ latest: "1.0.0", rc: "1.1.0-rc.1" }`. */
    tags: Record<string, string>;
    /** Why this version is deprecated, when it is. */
    deprecated?: string;
};

export class Releases {
    static readonly REGISTRY = "https://registry.npmjs.org";
    static readonly PACKAGE = "@takodotid/circuit";
    static readonly DOWNLOADS = "https://github.com/takodotid/circuit/releases/download";

    /** How long a check counts before Circuit asks again. */
    private static readonly FRESH_SECONDS = 60;
    /** How long Circuit waits for the registry before going on without it. */
    private static readonly TIMEOUT_MS = 3000;

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

    /** The registry's dist-tags, and whether this version is deprecated, from the cache when read in the last minute. `offline` when the registry could not be read, with the last answer, if any. */
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

            mkdirSync(Releases.home(), { recursive: true });
            writeFileSync(Releases.cachePath(), JSON.stringify({ checked: Date.now(), version: VERSION, latest }));
            return { latest, offline: false };
        } catch {
            return { ...(cached ? { latest: cached.latest } : {}), offline: true };
        }
    }

    /** Before a command: stop on a version deprecated as critical, warn when a newer Circuit is out, and warn when Circuit could not check. */
    static async gate(): Promise<void> {
        const { latest, offline } = await Releases.latest();

        if (latest?.deprecated && /^critical/i.test(latest.deprecated)) {
            Ui.fail(
                `Circuit ${VERSION} has a critical problem: ${latest.deprecated}\nNothing runs until Circuit is updated: run circuit update.`
            );
        }
        if (latest?.deprecated) Ui.warn(`Circuit ${VERSION} is deprecated: ${latest.deprecated}`);

        if (offline) {
            Ui.warn("Could not reach the npm registry, so Circuit could not check that it is current. Go carefully.");
            return;
        }

        const target = latest && Releases.target(latest);
        if (target && Releases.compare(VERSION, target) < 0)
            Ui.warn(`Circuit ${target} is out, and this is ${VERSION}. Run circuit update.`);

        const major = latest && Releases.newerMajor(latest);
        if (major) {
            Ui.warn(
                `Circuit ${major} is out, a new major version. circuit update stays on ${Releases.major(VERSION)}.x; read what changed at https://circuit.tako.id before you move.`
            );
        }
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

    /** One release's binary for this system, checked against the release's SHA256SUMS. */
    static async fetchBinary(version: string): Promise<Buffer> {
        const asset = Releases.asset() ?? Ui.fail(`Circuit is not built for ${process.platform} ${process.arch}.`);
        const download = async (file: string) => {
            const response = await fetch(`${Releases.DOWNLOADS}/v${version}/${file}`);
            if (!response.ok) throw new Error(`${file} of Circuit ${version}: GitHub answered ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        };

        const [file, sums] = await Promise.all([download(asset), download("SHA256SUMS")]);
        const expected = sums
            .toString("utf8")
            .split("\n")
            .find((line) => line.trim().endsWith(` ${asset}`) || line.trim().endsWith(`*${asset}`))
            ?.split(/\s+/)[0];
        const actual = createHash("sha256").update(file).digest("hex");
        if (!expected || expected !== actual) throw new Error(`${asset} does not match the release's SHA256SUMS, so it was not installed`);

        return file;
    }

    /** Whether a version is deprecated as critical: it must not run. */
    static critical(release: Release | undefined): boolean {
        return /^critical/i.test(release?.deprecated ?? "");
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
     * The versions to offer after `current`, newest first, at most `count`: of its major version, never one deprecated as critical. A
     * release candidate only while `current` is one.
     */
    static choices(releases: readonly Release[], current: string, count = Releases.OFFERED): Release[] {
        return releases
            .filter(
                (release) =>
                    Releases.major(release.version) === Releases.major(current) &&
                    Releases.compare(release.version, current) > 0 &&
                    !Releases.critical(release) &&
                    (current.includes("-") || !release.version.includes("-"))
            )
            .sort((a, b) => Releases.compare(b.version, a.version))
            .slice(0, count);
    }

    /**
     * Which version `what` moves to: the person picks from the newest few, the newest at the top, or stays, unless the version it runs is
     * deprecated as critical. With `confirmed`, the newest. Undefined when it stays.
     */
    static async pick(current: string, confirmed: boolean, what: string): Promise<string | undefined> {
        const releases = await Releases.releases();
        const choices = Releases.choices(releases, current);
        const stuck = Releases.critical(releases.find((release) => release.version === current));

        if (!choices.length) {
            if (stuck)
                Ui.fail(
                    `${what} runs Circuit ${current}, deprecated as critical, and no safe version of ${Releases.major(current)}.x is out yet.`
                );
            Ui.done(`${what} runs Circuit ${current}, the newest of ${Releases.major(current)}.x.`);
            return undefined;
        }
        if (confirmed) return choices[0]!.version;
        if (!Ui.interactive) Ui.fail("Not updated. Without a person to answer, add --confirm, which takes the newest.");

        Ui.note(
            `${what} runs Circuit ${current}.${stuck ? " It has a critical problem: only safe versions are offered." : ""}\nWhat changed: https://github.com/takodotid/circuit/releases\nRun circuit validate and circuit diff after, before you apply.`,
            "Update"
        );
        const picked = await Ui.select<string>("Which version?", [
            ...choices.map((release, i) => ({
                value: release.version,
                label: release.version,
                hint: [
                    i === 0 ? "newest" : "",
                    release.version.includes("-") ? "release candidate" : "",
                    release.deprecated ? `deprecated: ${release.deprecated}` : "",
                ]
                    .filter(Boolean)
                    .join(", "),
            })),
            ...(stuck ? [] : [{ value: "", label: `Stay on ${current}` }]),
        ]);
        return picked || undefined;
    }

    /** Update the installed app to a version the person picks. Gives back that version. */
    static async updateApp(confirmed: boolean): Promise<string | undefined> {
        const binary =
            Releases.binary() ?? Ui.fail("This Circuit runs from its sources. Update it where it came from, such as with git pull.");
        const target = await Releases.pick(VERSION, confirmed, "The app");
        if (!target) return undefined;

        Releases.replace(binary, await Ui.step(`Downloading Circuit ${target}`, () => Releases.fetchBinary(target)));
        Ui.done(`The Circuit app is ${target} now.`);
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
