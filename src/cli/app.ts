// Circuit installed like an app, by the installer: on Windows in %LOCALAPPDATA%\Programs\Circuit and listed in Settings > Apps, elsewhere in ~/.local/bin. `circuit uninstall` takes it away again: the program, its PATH entry, the Apps entry and ~/.circuit. Projects are never touched.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Releases } from "./releases";
import { Ui } from "./ui";

export class App {
    /** What the installer writes after a line it adds to a shell's startup file, so uninstall removes that line and no other. */
    static readonly MARKER = "# Added by Circuit";

    /** The Windows registry key that lists Circuit in Settings > Apps. */
    static readonly UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Circuit";

    /** The shell startup files the installer may have added Circuit's folder to. */
    private static readonly PROFILES = [".zshrc", ".bashrc", ".bash_profile", ".profile", ".config/fish/config.fish"];

    /** Lines that do not end with the marker, so what the installer added goes and the rest stays. */
    static withoutMarked(text: string): string {
        return text
            .split("\n")
            .filter((line) => !line.trimEnd().endsWith(App.MARKER))
            .join("\n");
    }

    /** Take Circuit off this machine, once the person says yes, or with `--confirm`. */
    static async uninstall(confirmed: boolean): Promise<void> {
        const binary = Releases.binary() ?? Ui.fail("This Circuit runs from its sources, so there is nothing installed to remove.");
        const folder = dirname(binary);

        if (!confirmed) {
            if (!Ui.interactive) Ui.fail("Not removed. Without a person to answer, add --confirm.");
            Ui.note(`${binary}\n${Releases.home()}\nYour projects stay as they are.`, "This removes");
            if (!(await Ui.confirm("Uninstall Circuit?"))) return;
        }

        rmSync(Releases.home(), { recursive: true, force: true });

        if (process.platform === "win32") {
            App.removeFromWindowsPath(folder);
            spawnSync("reg", ["delete", App.UNINSTALL_KEY, "/f"], { stdio: "ignore" });

            // Windows does not let a running program delete itself, so a separate process deletes it once this one has ended: it tries
            // again until the file goes, for about ten seconds. Only cmd's own commands: a program it started, such as ping to wait,
            // would open a console window. The line goes to cmd as written; quoted the usual way, cmd can't read the paths.
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

    /** Take a folder out of the user's PATH on Windows. */
    private static removeFromWindowsPath(folder: string): void {
        const script = `$p = [Environment]::GetEnvironmentVariable('Path', 'User'); $n = ($p -split ';' | Where-Object { $_ -and $_.TrimEnd('\\') -ne '${folder.replace(/'/g, "''")}'.TrimEnd('\\') }) -join ';'; [Environment]::SetEnvironmentVariable('Path', $n, 'User')`;
        spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore" });
    }
}
