// `circuit fmt`: the project's files in Circuit's style. It is Prettier, carried inside Circuit, so nothing else is installed. A project's `.prettierrc.json` changes the style; VS Code's Prettier extension reads the same file, so saving in the editor and `circuit fmt` agree.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as estree from "prettier/plugins/estree";
import * as typescript from "prettier/plugins/typescript";
import * as babel from "prettier/plugins/babel";
import type { Options } from "prettier";
import { format } from "prettier/standalone";
import { Ui } from "./ui";

export class Format {
    /** Circuit's style, the one its own code is written in. */
    static readonly STYLE = {
        printWidth: 140,
        tabWidth: 4,
        semi: true,
        trailingComma: "es5",
        bracketSpacing: true,
        arrowParens: "always",
        endOfLine: "lf",
    } as const;

    /** Folders that hold nothing of the project's own to format. */
    private static readonly SKIPPED = new Set(["node_modules", ".git", ".circuit", "dist"]);

    /** The project's style: its `.prettierrc.json` over Circuit's. */
    static style(root: string): Options {
        const path = join(root, ".prettierrc.json");
        const own = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Options) : {};
        return { ...Format.STYLE, ...own };
    }

    /** Every TypeScript file of the project, relative to it. A JSON file is formatted only when named. */
    static files(root: string, directory = root): string[] {
        return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
            if (entry.isDirectory()) return Format.SKIPPED.has(entry.name) ? [] : Format.files(root, join(directory, entry.name));
            return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [relative(root, join(directory, entry.name))] : [];
        });
    }

    /** A file's text in the style. */
    static async text(text: string, file: string, style: Options): Promise<string> {
        const parser = file.endsWith(".json") ? "json" : "typescript";
        return format(text, { ...style, parser, plugins: [estree, typescript, babel] });
    }

    /** Format the files named, or every file of the project. With `check`, change nothing and exit 1 when a file is not in the style. */
    static async run(root: string, named: readonly string[], check: boolean): Promise<void> {
        const style = Format.style(root);
        const files = named.length ? named.map((file) => relative(root, resolve(process.cwd(), file))) : Format.files(root);
        const off: string[] = [];

        for (const file of files) {
            const path = join(root, file);
            const before = readFileSync(path, "utf8");
            let after: string;
            try {
                after = await Format.text(before, file, style);
            } catch (error) {
                Ui.fail(`${file}: ${(error as Error).message.split("\n")[0]}`);
            }

            if (after === before) continue;
            off.push(file);
            if (!check) writeFileSync(path, after);
        }

        if (check) {
            for (const file of off) Ui.warn(`${file} is not in the project's style`);
            if (off.length) Ui.fail(`\n${off.length} file(s) to format: run circuit fmt.`);
            Ui.done(`${files.length} file(s), all in style.`);
            return;
        }

        Ui.done(off.length ? `Formatted ${off.length} of ${files.length} file(s).` : `${files.length} file(s), all in style already.`);
    }
}
