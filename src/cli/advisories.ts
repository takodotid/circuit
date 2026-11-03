// Security advisories for Circuit: GitHub's, published on the repository, the source npm audit reads too. Each names the versions it affects and the versions that fix it. A version an advisory affects never runs: the person moves to a fixed one first. Read straight from the repository, so an advisory counts the moment it is published, and kept for a few minutes, as GitHub answers 60 requests an hour without a sign-in.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One advisory, as Circuit keeps it. */
export type Advisory = {
    /** Such as `GHSA-xxxx-xxxx-xxxx`. */
    id: string;
    summary: string;
    severity: string;
    url: string;
    /** The versions it affects, each as GitHub writes a range: `>= 1.10.0, < 1.16.0`. */
    affected: string[];
    /** The versions that fix it, such as `1.16.0` and `1.9.5`. */
    patched: string[];
};

/** How a version compares with another: below 0 older, 0 the same, above 0 newer. */
type Compare = (a: string, b: string) => number;

export class Advisories {
    static readonly API = "https://api.github.com/repos/takodotid/circuit/security-advisories?state=published&per_page=100";
    static readonly PACKAGE = "@takodotid/circuit";

    /** How long advisories read count before Circuit asks GitHub again. */
    private static readonly FRESH_SECONDS = 120;
    private static readonly TIMEOUT_MS = 3000;

    /** Whether `version` is in a range as GitHub writes it: constraints joined by commas, each `<`, `<=`, `>`, `>=` or `=` and a version. */
    static inRange(range: string, version: string, compare: Compare): boolean {
        return range
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
            .every((part) => {
                const [, op = "=", bound = ""] = /^(<=|>=|<|>|=)?\s*v?(\S+)$/.exec(part) ?? [];
                const order = compare(version, bound);
                if (op === "<") return order < 0;
                if (op === "<=") return order <= 0;
                if (op === ">") return order > 0;
                if (op === ">=") return order >= 0;
                return order === 0;
            });
    }

    /** The advisories that affect `version`. */
    static affecting(advisories: readonly Advisory[], version: string, compare: Compare): Advisory[] {
        return advisories.filter((advisory) => advisory.affected.some((range) => Advisories.inRange(range, version, compare)));
    }

    /** GitHub's answer, kept to what Circuit uses: only what affects the npm package. */
    static parse(answer: unknown): Advisory[] {
        if (!Array.isArray(answer)) return [];

        return answer.flatMap((item): Advisory[] => {
            const vulnerabilities = (Array.isArray(item?.vulnerabilities) ? item.vulnerabilities : []).filter(
                (vulnerability: any) => vulnerability?.package?.name === Advisories.PACKAGE
            );
            if (!vulnerabilities.length || typeof item.ghsa_id !== "string") return [];

            return [
                {
                    id: item.ghsa_id,
                    summary: String(item.summary ?? ""),
                    severity: String(item.severity ?? "unknown"),
                    url: String(item.html_url ?? `https://github.com/advisories/${item.ghsa_id}`),
                    affected: vulnerabilities
                        .map((vulnerability: any) => String(vulnerability.vulnerable_version_range ?? ""))
                        .filter(Boolean),
                    patched: vulnerabilities
                        .flatMap((vulnerability: any) => String(vulnerability.patched_versions ?? "").split(","))
                        .map((version: string) => version.trim())
                        .filter(Boolean),
                },
            ];
        });
    }

    /** The published advisories: from the cache when read in the last two minutes, else from GitHub. `offline` when GitHub could not be read, with the last answer, if any. */
    static async read(home: string, fresh = false): Promise<{ advisories: Advisory[]; offline: boolean }> {
        const path = join(home, "advisories.json");
        let cached: { checked: number; advisories: Advisory[] } | undefined;
        try {
            cached = JSON.parse(readFileSync(path, "utf8"));
        } catch {}

        if (!fresh && cached && Date.now() - cached.checked < Advisories.FRESH_SECONDS * 1000)
            return { advisories: cached.advisories, offline: false };

        try {
            const response = await fetch(Advisories.API, {
                signal: AbortSignal.timeout(Advisories.TIMEOUT_MS),
                headers: { accept: "application/vnd.github+json", "user-agent": "circuit" },
            });
            if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

            const advisories = Advisories.parse(await response.json());
            try {
                mkdirSync(home, { recursive: true });
                writeFileSync(path, JSON.stringify({ checked: Date.now(), advisories }));
            } catch {}
            return { advisories, offline: false };
        } catch {
            return { advisories: cached?.advisories ?? [], offline: true };
        }
    }
}
