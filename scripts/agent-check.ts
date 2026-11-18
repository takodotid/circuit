// The quick checks Claude Code runs before it ends a turn (the Stop hook in .claude/settings.json). They catch a broken rule while the agent can still fix it. The pre-commit hook and CI run every check.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

const changed = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout.trim();
if (!changed) process.exit(0);

const checks: [name: string, command: string[]][] = [
    ["typecheck", ["bun", "run", "typecheck"]],
    ["lint", ["bun", "run", "lint"]],
    ["repo rules", ["bun", "test", "test/repo.test.ts"]],
];

const failed: string[] = [];
for (const [name, [command, ...args]] of checks) {
    const result = spawnSync(command!, args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) failed.push(`${name} failed:\n${result.stdout}${result.stderr}`.trim());
}

if (failed.length) {
    // Exit code 2 sends what is written here back to the agent, which keeps working until the checks pass.
    console.error(`${failed.join("\n\n")}\n\nFix these before you finish.`);
    process.exit(2);
}
