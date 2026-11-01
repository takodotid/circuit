// Which Circuit is current, and updating to it. Each release writes https://circuit.tako.id/latest.json: the newest stable version, the newest of any, and the minimum, the newest release marked critical. Circuit reads it before each command, at most once a minute, warns when a newer one is out, and stops below the minimum.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Ui } from "./ui";
import { VERSION } from "./version";

/** What latest.json holds. */
export type Latest = {
    /** The newest stable version. */
    latest: string;
    /** The newest version, a release candidate too. */
    next: string;
    /** The newest version marked critical: anything older stops. */
    minimum: string;
};

export class Releases {
    static readonly LATEST_URL = "https://circuit.tako.id/latest.json";
    static readonly DOWNLOADS = "https://github.com/takodotid/circuit/releases/download";

    /** How long a check counts before Circuit asks again. */
    private static readonly FRESH_SECONDS = 60;
    /** How long Circuit waits for latest.json before going on without it. */
    private static readonly TIMEOUT_MS = 3000;

    /** Where Circuit keeps what it installed and what it learned: `~/.circuit`. */
    static home(): string {
        return join(homedir(), ".circuit");
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

    /** The version this Circuit should be at: the newest stable one, or the newest of any while it runs a release candidate. */
    static target(latest: Latest, current = VERSION): string {
        return current.includes("-") && Releases.compare(latest.next, latest.latest) > 0 ? latest.next : latest.latest;
    }

    private static readCache(): { checked: number; latest: Latest } | undefined {
        try {
            return JSON.parse(readFileSync(Releases.cachePath(), "utf8"));
        } catch {
            return undefined;
        }
    }

    private static isLatest(value: unknown): value is Latest {
        const fields = value as Partial<Latest> | null;
        return typeof fields?.latest === "string" && typeof fields.next === "string" && typeof fields.minimum === "string";
    }

    /** latest.json, from the cache when it was read in the last minute. `offline` when it could not be read, with the last one read, if any. */
    static async latest(fresh = false): Promise<{ latest?: Latest; offline: boolean }> {
        const cached = Releases.readCache();
        if (!fresh && cached && Date.now() - cached.checked < Releases.FRESH_SECONDS * 1000)
            return { latest: cached.latest, offline: false };

        try {
            const response = await fetch(Releases.LATEST_URL, { signal: AbortSignal.timeout(Releases.TIMEOUT_MS) });
            const latest: unknown = response.ok ? await response.json() : undefined;
            if (!Releases.isLatest(latest)) return { ...(cached ? { latest: cached.latest } : {}), offline: true };

            mkdirSync(Releases.home(), { recursive: true });
            writeFileSync(Releases.cachePath(), JSON.stringify({ checked: Date.now(), latest }));
            return { latest, offline: false };
        } catch {
            return { ...(cached ? { latest: cached.latest } : {}), offline: true };
        }
    }

    /** Before a command: stop below the minimum, warn when a newer Circuit is out, and warn when Circuit could not check. */
    static async gate(): Promise<void> {
        const { latest, offline } = await Releases.latest();

        if (latest && Releases.compare(VERSION, latest.minimum) < 0) {
            Ui.fail(
                `Circuit ${latest.minimum} fixes a critical problem, and this is Circuit ${VERSION}. Nothing runs until Circuit is updated: run circuit update.`
            );
        }

        if (offline) {
            Ui.warn("Could not reach circuit.tako.id, so Circuit could not check that it is current. Go carefully.");
            return;
        }

        const target = latest ? Releases.target(latest) : VERSION;
        if (Releases.compare(VERSION, target) < 0) Ui.warn(`Circuit ${target} is out, and this is ${VERSION}. Run circuit update.`);
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
        if (binary) rmSync(`${binary}.old`, { force: true });
    }

    /** Download the version this Circuit should be at, check it against the release's checksums, and put it in place of this one. */
    static async update(): Promise<string | undefined> {
        const { latest } = await Ui.step("Checking for a newer Circuit", () => Releases.latest(true));
        if (!latest) Ui.fail("Could not reach circuit.tako.id to learn the newest Circuit. Check the internet connection and try again.");

        const target = Releases.target(latest);
        if (Releases.compare(VERSION, target) >= 0) {
            Ui.done(`Circuit ${VERSION} is the newest.`);
            return undefined;
        }

        const binary =
            Releases.binary() ?? Ui.fail(`This Circuit runs from its sources. Update it where it came from, such as with git pull.`);
        const asset = Releases.asset() ?? Ui.fail(`Circuit is not built for ${process.platform} ${process.arch}.`);

        const bytes = await Ui.step(`Downloading Circuit ${target}`, async () => {
            const download = async (file: string) => {
                const response = await fetch(`${Releases.DOWNLOADS}/v${target}/${file}`);
                if (!response.ok) throw new Error(`${file}: GitHub answered ${response.status}`);
                return Buffer.from(await response.arrayBuffer());
            };

            const [file, sums] = await Promise.all([download(asset), download("SHA256SUMS")]);
            const expected = sums
                .toString("utf8")
                .split("\n")
                .find((line) => line.trim().endsWith(` ${asset}`) || line.trim().endsWith(`*${asset}`))
                ?.split(/\s+/)[0];
            const actual = createHash("sha256").update(file).digest("hex");
            if (!expected || expected !== actual)
                throw new Error(`${asset} does not match the release's SHA256SUMS, so it was not installed`);

            return file;
        });

        Releases.replace(binary, bytes);
        Ui.done(`Circuit ${target} is installed. A project's editor types are written again the next time you run circuit in it.`);
        return target;
    }

    /** Put `bytes` in place of the running binary. Windows does not let a running program be overwritten, but lets it be renamed, so the old one is moved aside and removed on the next run. */
    private static replace(binary: string, bytes: Buffer): void {
        const next = `${binary}.new`;
        writeFileSync(next, bytes);

        if (process.platform === "win32") {
            if (existsSync(`${binary}.old`)) rmSync(`${binary}.old`, { force: true });
            renameSync(binary, `${binary}.old`);
            renameSync(next, binary);
            return;
        }

        chmodSync(next, 0o755);
        renameSync(next, binary);
    }
}
