import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** The commands of the package manager that installed this Circuit, as a person types them. */
export type Packaged = { update: string; uninstall: string };

export class Installation {
    /** A package's marker, from the folder of its binary: `<prefix>/bin/circuit` has `<prefix>/share/circuit/package-manager`. Its first line is the command that updates the package, its second the command that removes it. */
    static readonly PACKAGE_MARKER = join("..", "share", "circuit", "package-manager");

    /** Where Circuit keeps what it learned, the versions projects pin, and the remembered secrets' address: `~/.circuit`, or `CIRCUIT_HOME` for a test. */
    static home(): string {
        return process.env.CIRCUIT_HOME || join(homedir(), ".circuit");
    }

    /** This Circuit's own file, when it runs as the installed binary rather than from its sources. */
    static binary(): string | undefined {
        return /^circuit(-[\w-]+)?(\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : undefined;
    }

    /** Set when a package manager, such as Homebrew or pacman, installed `binary`. Its file is then the package manager's: Circuit never replaces or removes it. */
    static packaged(binary: string | undefined = Installation.binary()): Packaged | undefined {
        const marker = binary && join(dirname(binary), Installation.PACKAGE_MARKER);
        if (!marker || !existsSync(marker)) return undefined;

        const [update = "", uninstall = ""] = readFileSync(marker, "utf8")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
        return { update, uninstall };
    }
}
