// Where this Circuit is on this machine: its own file when it runs as the installed binary, and the folder where it keeps what it learned. The command and Studio both read it.

import { homedir } from "node:os";
import { basename, join } from "node:path";

export class Installation {
    /** Where Circuit keeps what it learned, the versions projects pin, and the remembered secrets' address: `~/.circuit`, or `CIRCUIT_HOME` for a test. */
    static home(): string {
        return process.env.CIRCUIT_HOME || join(homedir(), ".circuit");
    }

    /** This Circuit's own file, when it runs as the installed binary rather than from its sources. */
    static binary(): string | undefined {
        return /^circuit(-[\w-]+)?(\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : undefined;
    }
}
