// Circuit 0.x's example devices moved into the v1 model, for the golden tests, with `Migrate.device`, as `circuit migrate` moves a project's.
// `bun scripts/from-v0.ts <folder>` converts each `<name>.v0.json` there into `<name>.v1.json`, and each certificate into a `.pem` beside it.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Migrate } from "../src/cli/migrate";

if (import.meta.main) {
    const folder = process.argv[2]!;
    for (const file of readdirSync(folder).filter((f) => f.endsWith(".v0.json"))) {
        const id = file.replace(/\.v0\.json$/, "");
        const device = JSON.parse(readFileSync(join(folder, file), "utf8"));
        const v1 = Migrate.device(device, id.split("--")[0]!, (name, pem) => {
            const path = `${id}.${name}.pem`;
            writeFileSync(join(folder, path), pem);
            return path;
        });
        writeFileSync(join(folder, `${id}.v1.json`), JSON.stringify(v1, null, 2) + "\n");
    }
}
