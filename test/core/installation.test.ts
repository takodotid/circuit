import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Installation } from "../../src/core/installation";

test("a package's marker beside the binary gives the package manager's commands, and no marker means the installer's Circuit", () => {
    const prefix = mkdtempSync(join(tmpdir(), "circuit-prefix-"));
    const binary = join(prefix, "bin", "circuit");

    expect(Installation.packaged(binary)).toBeUndefined();

    const marker = join(dirname(binary), Installation.PACKAGE_MARKER);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "brew upgrade takodotid/tap/circuit\nbrew uninstall takodotid/tap/circuit\n");

    expect(Installation.packaged(binary)).toEqual({
        update: "brew upgrade takodotid/tap/circuit",
        uninstall: "brew uninstall takodotid/tap/circuit",
    });
});
