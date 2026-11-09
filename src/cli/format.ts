// `circuit fmt`: the project's files in its style. It is Prettier, carried inside Circuit, so nothing else is installed. The style is Prettier's own, set by `.editorconfig` (indent, line length, line ends), as VS Code's Prettier extension reads it, so saving in the editor and `circuit fmt` agree. A `.prettierrc.json`, when a project adds one, goes on top, for both. Both are looked up from each file's folder, as the editor does, so a project inside another project's folder takes the outer one's style.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as estree from "prettier/plugins/estree";
import * as typescript from "prettier/plugins/typescript";
import * as babel from "prettier/plugins/babel";
import type { Options } from "prettier";
import { format } from "prettier/standalone";
import { Ui } from "./ui";

export class Format {
    /** What a new project's `.editorconfig` says: four spaces, lines up to 140, LF. */
    static readonly EDITORCONFIG =
        "root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = space\nindent_size = 4\nmax_line_length = 140\n";

    /** Folders that hold nothing of the project's own to format. */
    private static readonly SKIPPED = new Set(["node_modules", ".git", ".circuit", "dist"]);

    /** The settings of `.editorconfig` that apply to a TypeScript file: those under `[*]`, then under a section that names `.ts`. */
    static editorconfig(text: string): Record<string, string> {
        const settings: Record<string, string> = {};
        let applies = false;

        for (const raw of text.split(/\r?\n/)) {
            const line = raw.replace(/[#;].*$/, "").trim();
            const section = /^\[(.+)\]$/.exec(line);
            if (section) {
                applies = section[1] === "*" || /\bts\b/.test(section[1]!);
                continue;
            }

            const [key, value] = line.split("=").map((part) => part.trim());
            if (applies && key && value) settings[key.toLowerCase()] = value.toLowerCase();
        }

        return settings;
    }

    /** Whether an `.editorconfig` says `root = true` before its first section, so none above it counts. */
    static isRoot(text: string): boolean {
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.replace(/[#;].*$/, "").trim();
            if (line.startsWith("[")) return false;
            if (/^root\s*=\s*true$/i.test(line)) return true;
        }
        return false;
    }

    /**
     * The style of the files in `folder`: Prettier's own, then what `.editorconfig` sets, mapped as Prettier's `editorConfigToPrettier`
     * maps it, then a `.prettierrc.json`. As in the editor, every `.editorconfig` from the folder up counts, the nearest winning, up to
     * one that says `root = true`; the nearest `.prettierrc.json` counts.
     */
    static style(folder: string): Options {
        const style: Options = {};
        const found: string[] = [];
        let own: string | undefined;
        let reachedRoot = false;

        for (let current = resolve(folder); ;) {
            const editorconfig = join(current, ".editorconfig");
            if (!reachedRoot && existsSync(editorconfig)) {
                const text = readFileSync(editorconfig, "utf8");
                found.unshift(text);
                reachedRoot = Format.isRoot(text);
            }

            const prettierrc = join(current, ".prettierrc.json");
            if (own === undefined && existsSync(prettierrc)) own = prettierrc;

            const parent = dirname(current);
            if (parent === current || (reachedRoot && own !== undefined)) break;
            current = parent;
        }

        if (found.length) {
            const settings: Record<string, string> = Object.assign({}, ...found.map((text) => Format.editorconfig(text)));
            const whole = (value: string | undefined) => (value && /^[1-9]\d*$/.test(value) ? Number(value) : undefined);

            // What the EditorConfig library fills in before Prettier reads the settings.
            if (settings.indent_style === "tab" && !settings.indent_size) settings.indent_size = "tab";
            if (settings.indent_size && !settings.tab_width && settings.indent_size !== "tab") settings.tab_width = settings.indent_size;
            if (settings.indent_size === "tab" && settings.tab_width) settings.indent_size = settings.tab_width;

            if (settings.indent_style === "space") style.useTabs = false;
            else if (settings.indent_style === "tab" || settings.indent_size === "tab") style.useTabs = true;

            const width = style.useTabs === false && whole(settings.indent_size) ? whole(settings.indent_size) : whole(settings.tab_width);
            if (width) style.tabWidth = width;

            if (settings.max_line_length === "off") style.printWidth = Number.POSITIVE_INFINITY;
            else if (whole(settings.max_line_length)) style.printWidth = whole(settings.max_line_length);

            if (settings.quote_type === "single") style.singleQuote = true;
            else if (settings.quote_type === "double") style.singleQuote = false;

            if (settings.end_of_line === "lf" || settings.end_of_line === "crlf" || settings.end_of_line === "cr")
                style.endOfLine = settings.end_of_line;
        }

        return own === undefined ? style : { ...style, ...(JSON.parse(readFileSync(own, "utf8")) as Options) };
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
        const styles = new Map<string, Options>();
        const styleOf = (path: string) => {
            const folder = dirname(path);
            const known = styles.get(folder);
            if (known) return known;

            const style = Format.style(folder);
            styles.set(folder, style);
            return style;
        };
        const files = named.length ? named.map((file) => relative(root, resolve(process.cwd(), file))) : Format.files(root);
        const off: string[] = [];

        await Ui.wait(`Reading ${files.length} file(s)`, async () => {
            for (const file of files) {
                const path = join(root, file);
                const before = readFileSync(path, "utf8");
                let after: string;
                try {
                    after = await Format.text(before, file, styleOf(path));
                } catch (error) {
                    Ui.fail(`${file}: ${(error as Error).message.split("\n")[0]}`);
                }

                if (after === before) continue;
                off.push(file);
                if (!check) writeFileSync(path, after);
            }
        });

        if (check) {
            for (const file of off) Ui.warn(`${file} is not in the project's style`);
            if (off.length) Ui.fail(`\n${off.length} file(s) to tidy: run circuit fmt.`);
            Ui.done(`${files.length} file(s), all in style.`);
            return;
        }

        Ui.done(
            off.length
                ? `Tidied ${off.length} of ${files.length} file(s): spacing and line breaks only.`
                : `${files.length} file(s), all in style already.`
        );
    }
}
