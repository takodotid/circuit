// The devices of Circuit 0.x's examples, templates and use cases, in the v1 model (`scripts/from-v0.ts`), with what 0.x rendered for each and what it called unsupported. A port of a platform renders each the same.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Utils } from "../src/core/utils";
import type { Device } from "../src/model";

export class Fixtures {
    static readonly FOLDER = join(import.meta.dir, "fixtures", "v0");

    /** Every fixture's name, such as `platforms--example-router`: the example or template, then the device. */
    static names(): string[] {
        return readdirSync(Fixtures.FOLDER)
            .filter((file) => file.endsWith(".v1.json"))
            .map((file) => file.replace(/\.v1\.json$/, ""))
            .sort();
    }

    /** A fixture's device. Its certificates are read from the fixtures' folder. */
    static device(name: string): Device {
        Utils.root = Fixtures.FOLDER;
        return JSON.parse(readFileSync(join(Fixtures.FOLDER, `${name}.v1.json`), "utf8")) as Device;
    }

    /** What Circuit 0.x rendered for the fixture. */
    static render(name: string): string {
        return readFileSync(join(Fixtures.FOLDER, `${name}.render.txt`), "utf8");
    }

    /** What Circuit 0.x called unsupported on the fixture, with 0.x's paths. */
    static unsupported(name: string): string[] {
        return JSON.parse(readFileSync(join(Fixtures.FOLDER, `${name}.unsupported.json`), "utf8")) as string[];
    }

    /** Every fixture of one platform. */
    static ofPlatform(platform: string): string[] {
        return Fixtures.names().filter((name) => Fixtures.device(name).platform === platform);
    }
}
