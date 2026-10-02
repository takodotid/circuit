// Writes docs/reference/schema.md from the schema's own comments, so the reference never drifts from the code. Run before the site is built.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** The schema files in reading order, with the title each gets. */
const FILES = [
    ["device.ts", "Device"],
    ["interfaces.ts", "Ports and interfaces"],
    ["routing.ts", "Routing"],
    ["policy.ts", "Route policies"],
    ["firewall.ts", "Firewall and ACLs"],
    ["system.ts", "System and management"],
    ["common.ts", "Common values"],
] as const;

type Field = { path: string; type: string; description: string };
type TypeDoc = { name: string; description: string; definition?: string; includes?: string[]; fields: Field[] };

const schemaDirectory = new URL("../src/schema/", import.meta.url);
const outputDirectory = new URL("../docs/reference/", import.meta.url);

/** The text of a JSDoc comment, without its markers, as one paragraph. */
function commentText(lines: string[]): string {
    return lines
        .map((line) => line.replace(/^\s*\/\*\*\s?|\s*\*\/\s*$|^\s*\*\s?/g, "").trim())
        .filter(Boolean)
        .join(" ");
}

/** Schema types that take the device's names as parameters. Their parameter lists are left out of the reference. */
const GENERIC_TYPES = new Set<string>();

/** What a type parameter stands for, where it is not one of the device's names. */
const PARAMETER_MEANING: Record<string, string> = { Pl: "platform", M: "model" };

/** A type as a reader needs it: "name" for each of the device's names, and no parameter list on the schema's own types. */
function withoutGenerics(type: string): string {
    let result = type;
    while (/NoInfer<([^<>]*)>/.test(result)) {
        result = result.replace(/NoInfer<([^<>]*)>/g, (_, inner: string) => (inner.includes("|") ? `(${inner})` : inner));
    }

    for (const name of GENERIC_TYPES) {
        result = result.replace(new RegExp(`\\b${name}<[^<>]*(?:<[^<>]*>[^<>]*)*>`, "g"), name);
    }

    return result
        .replace(/\b(Pl|M|N|V|I|P|S|G|A|AS|U|F|C|L|K)\b/g, (parameter) => PARAMETER_MEANING[parameter] ?? "name")
        .replace(/\bname(?: \| name)+\b/g, "name")
        .replace(/\(name\)/g, "name");
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function parse(source: string): TypeDoc[] {
    const lines = source.split("\n");
    const types: TypeDoc[] = [];

    let comment: string[] = [];
    let inComment = false;
    let current: TypeDoc | undefined;
    let depth = 0;
    const parents: string[] = [];
    let header: string | undefined;

    /** Reads a whole declaration: a type it aliases, the types whose fields it also has, and whether a body opens. */
    function finishHeader(): void {
        const text = header!;
        header = undefined;

        // The part after `=`, with the generic parameter list before it left out.
        const body = text.slice(text.indexOf("> =") >= 0 ? text.indexOf("> =") + 3 : text.indexOf("=") + 1).trim();

        if (!body.includes("{")) {
            current!.definition = body.replace(/;$/, "").replace(/^\|\s*/, "");
        } else {
            const before = body.slice(0, body.indexOf("{"));
            const included = before
                .split("&")
                .map((part) => part.trim())
                .filter((part) => /^\w/.test(part));
            if (included.length) current!.includes = included;
        }

        depth = (text.match(/{/g) ?? []).length - (text.match(/}/g) ?? []).length;
    }

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("/**")) {
            comment = [trimmed];
            inComment = !trimmed.endsWith("*/");
            continue;
        }

        if (inComment) {
            comment.push(trimmed);
            if (trimmed.endsWith("*/")) inComment = false;
            continue;
        }

        // A declaration can span lines before its body opens or it ends.
        if (header !== undefined) {
            header += ` ${trimmed}`;
            if (trimmed.endsWith("{") || trimmed.endsWith(";")) finishHeader();
            continue;
        }

        // A type the schema does not export is documented too, since exported types take its fields.
        const declaration = /^(?:export )?type (\w+)(<)?/.exec(trimmed);
        if (declaration && depth === 0) {
            if (declaration[2]) GENERIC_TYPES.add(declaration[1]!);

            current = { name: declaration[1]!, description: commentText(comment), fields: [] };
            types.push(current);
            comment = [];

            header = trimmed;
            if (trimmed.endsWith("{") || trimmed.endsWith(";")) finishHeader();
            continue;
        }

        if (!current) continue;

        const field = /^(?:readonly\s+)?("?[\w-]+"?)(\?)?:\s*(.*)$/.exec(trimmed);
        if (field && depth >= 1) {
            const [, name, optional, rest] = field;
            const path = [...parents, name!.replace(/"/g, "")].join(".");
            const opensObject = rest!.trim().endsWith("{");
            const type = opensObject ? "object" : rest!.replace(/;$/, "").trim();

            current.fields.push({ path: `${path}${optional ? "?" : ""}`, type, description: commentText(comment) });
            comment = [];

            if (opensObject) {
                parents.push(name!.replace(/"/g, ""));
                depth++;
            }
            continue;
        }

        const opens = (trimmed.match(/{/g) ?? []).length;
        const closes = (trimmed.match(/}/g) ?? []).length;

        for (let index = 0; index < closes - opens; index++) {
            if (parents.length >= depth - 1 && parents.length > 0) parents.pop();
        }

        depth += opens - closes;
        if (depth <= 0) {
            depth = 0;
            parents.length = 0;
        }

        comment = [];
    }

    return types;
}

function render(types: TypeDoc[]): string {
    return types
        .map((type) => {
            const parts = [`### ${type.name}`, ""];
            if (type.description) parts.push(type.description, "");
            if (type.definition) parts.push("```ts", type.definition, "```", "");
            if (type.includes)
                parts.push(
                    `Also has every field of ${type.includes.map((name) => `[${name}](#${name.toLowerCase()})`).join(" and ")}.`,
                    ""
                );

            if (type.fields.length) {
                parts.push("| Field | Type | Description |", "| --- | --- | --- |");
                for (const field of type.fields) parts.push(`| \`${field.path}\` | \`${cell(field.type)}\` | ${cell(field.description)} |`);
                parts.push("");
            }

            return parts.join("\n");
        })
        .join("\n");
}

// Every file is read first, so a type is known to take parameters wherever it is used.
const parsed = FILES.map(([file, title]) => ({ title, types: parse(readFileSync(new URL(file, schemaDirectory), "utf8")) }));

for (const { types } of parsed) {
    for (const type of types) {
        if (type.definition) type.definition = withoutGenerics(type.definition);
        if (type.includes) type.includes = type.includes.map(withoutGenerics);
        for (const field of type.fields) field.type = withoutGenerics(field.type);
    }
}

const sections = parsed.map(({ title, types }) => `## ${title}\n\n${render(types)}`);

const page = [
    "# Schema reference",
    "",
    "Every field a device and the network can hold, generated from the comments in `src/schema/`. A field marked `?` may be left out; left out, it is off or at its default.",
    "",
    ...sections,
].join("\n");

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(new URL("schema.md", outputDirectory), page);
console.log("docs/reference/schema.md written");
