// The 1Password CLI, `op`, which reads `op://vault/item/field` references.

import { type SpawnSyncReturns, spawnSync } from "node:child_process";

export class OnePassword {
    /** Each reference read in this run, so 1Password asks once. */
    private static readonly cache = new Map<string, string>();
    /** The references whose values Circuit remembers from an earlier run, after a yes (src/cli/remember.ts). */
    private static readonly held = new Set<string>();
    /** Whether a remembered value was used in this run. */
    static usedHeld = false;
    /** Says what Circuit waits for while `op` runs, such as for the person to unlock 1Password; gives back what clears it. The command line sets it. */
    static waiting: ((message: string) => () => void) | undefined;

    /** A reference read before in this run, without asking 1Password. */
    static cached(reference: string): string | undefined {
        return OnePassword.cache.get(reference);
    }

    /** Values Circuit remembers, so this run reads them without asking 1Password. */
    static hold(values: Readonly<Record<string, string>>): void {
        for (const [reference, value] of Object.entries(values)) {
            OnePassword.cache.set(reference, value);
            OnePassword.held.add(reference);
        }
    }

    /** The values read from 1Password itself in this run, which Circuit does not remember yet. */
    static unheld(): Record<string, string> {
        return Object.fromEntries([...OnePassword.cache].filter(([reference]) => !OnePassword.held.has(reference)));
    }

    /** Forget every value of this run, as a new run starts with none. */
    static forget(): void {
        OnePassword.cache.clear();
        OnePassword.held.clear();
        OnePassword.usedHeld = false;
    }

    /** The value behind `op://vault/item/field`, read once per run. */
    static read(reference: string, what: string): string {
        const cached = OnePassword.cache.get(reference);
        if (cached !== undefined) {
            if (OnePassword.held.has(reference)) OnePassword.usedHeld = true;
            return cached;
        }

        const done = OnePassword.waiting?.(`Reading ${reference} from 1Password`);
        let result: SpawnSyncReturns<string>;
        try {
            result = spawnSync("op", ["read", "--no-newline", reference], { encoding: "utf8" });
        } finally {
            done?.();
        }
        if (result.error) throw new Error(`${what} is in 1Password, and the 1Password CLI, op, is not installed`);
        if (result.status !== 0)
            throw new Error(`${what}: 1Password could not read ${reference}: ${result.stderr.trim() || `op exited with ${result.status}`}`);

        OnePassword.cache.set(reference, result.stdout);
        return result.stdout;
    }
}
