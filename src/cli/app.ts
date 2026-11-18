// The installer puts Circuit in %LOCALAPPDATA%\Programs\Circuit on Windows, listed in Settings > Apps, and in ~/.local/bin elsewhere. `circuit uninstall` removes the program, its PATH entry, the Apps entry, and ~/.circuit, never a project.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Installation } from "../core/installation";
import { Ui } from "./ui";

export class App {
    /** What the installer writes after a line it adds to a shell's startup file, so uninstall removes that line and no other. */
    static readonly MARKER = "# Added by Circuit";

    /** The Windows registry key that lists Circuit in Settings > Apps. */
    static readonly UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Circuit";

    /** The shell startup files the installer may have added Circuit's folder to. */
    private static readonly PROFILES = [".zshrc", ".bashrc", ".bash_profile", ".profile", ".config/fish/config.fish"];

    /** Drops the lines the installer added, which end with the marker. */
    static withoutMarked(text: string): string {
        return text
            .split("\n")
            .filter((line) => !line.trimEnd().endsWith(App.MARKER))
            .join("\n");
    }

    /** How this Circuit runs itself again: the installed binary, or Bun with these sources. */
    static self(): string[] {
        return Installation.binary() ? [process.execPath] : [process.execPath, join(import.meta.dir, "index.ts")];
    }

    /** Once the person says yes, or with `--confirm`. */
    static async uninstall(confirmed: boolean): Promise<void> {
        const binary = Installation.binary() ?? Ui.fail("This Circuit runs from its sources, so there is nothing installed to remove.");
        const folder = dirname(binary);

        if (!confirmed) {
            if (!Ui.interactive) Ui.fail("Not removed. Without a terminal, add --confirm.");
            Ui.note(`${binary}\n${Installation.home()}\nYour projects stay as they are.`, "This removes");
            if (!(await Ui.confirm("Uninstall Circuit?"))) return;
        }

        rmSync(Installation.home(), { recursive: true, force: true });

        if (process.platform === "win32") {
            App.removeFromWindowsPath(folder);
            spawnSync("reg", ["delete", App.UNINSTALL_KEY, "/f"], { stdio: "ignore" });

            // Windows does not let a running program delete itself. So a separate cmd deletes it after this one ends, trying again for about ten seconds. It uses only cmd's own commands, as a program it started, such as ping, would open a console window. The line goes to cmd as written, as cmd can't read paths quoted the usual way.
            const remove = `del /f /q "${binary}" "${binary}.old" 2>nul & if not exist "${binary}" (rmdir "${folder}" 2>nul & exit)`;
            spawn("cmd", ["/d", "/c", `for /l %i in (1,1,10000) do @(${remove})`], {
                detached: true,
                stdio: "ignore",
                windowsHide: true,
                windowsVerbatimArguments: true,
            }).unref();
        } else {
            rmSync(binary, { force: true });
            for (const profile of App.PROFILES) {
                const path = join(homedir(), profile);
                if (existsSync(path)) writeFileSync(path, App.withoutMarked(readFileSync(path, "utf8")));
            }
        }

        Ui.done("Circuit is uninstalled. Open a new terminal so it is gone from there too.");
    }

    private static removeFromWindowsPath(folder: string): void {
        const script = `$p = [Environment]::GetEnvironmentVariable('Path', 'User'); $n = ($p -split ';' | Where-Object { $_ -and $_.TrimEnd('\\') -ne '${folder.replace(/'/g, "''")}'.TrimEnd('\\') }) -join ';'; [Environment]::SetEnvironmentVariable('Path', $n, 'User')`;
        spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore" });
    }
}
