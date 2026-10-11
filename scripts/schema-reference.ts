// Writes docs/reference/schema.md from the schema's own comments, so the reference never drifts from the code. Run before the site is built.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SCHEMA_FILES, schemaTypes, type TypeDoc } from "../src/core/schema-docs";

const schemaDirectory = new URL("../src/schema/", import.meta.url);
const outputDirectory = new URL("../docs/reference/", import.meta.url);

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

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

const sources = SCHEMA_FILES.map(([file]) => readFileSync(new URL(file, schemaDirectory), "utf8"));
const sections = schemaTypes(sources).map((types, index) => `## ${SCHEMA_FILES[index]![1]}\n\n${render(types)}`);

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
