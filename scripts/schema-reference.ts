// Writes docs/reference/schema.md from the schema's own comments, so the reference never drifts from the code. Run before the site is built.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SchemaDocs, type TypeDoc } from "../src/core/schema-docs";

class SchemaReference {
    private static readonly SCHEMA_DIRECTORY = new URL("../src/schema/", import.meta.url);
    private static readonly OUTPUT_DIRECTORY = new URL("../docs/reference/", import.meta.url);

    /** Read the schema's comments and write the page. */
    static main(): void {
        const sources = SchemaDocs.FILES.map(([file]) => readFileSync(new URL(file, SchemaReference.SCHEMA_DIRECTORY), "utf8"));
        const sections = SchemaDocs.read(sources).map(
            (types, index) => `## ${SchemaDocs.FILES[index]![1]}\n\n${SchemaReference.render(types)}`
        );

        const page = [
            "# Schema reference",
            "",
            "Every field a device and the network can hold, generated from the comments in `src/schema/`. A field marked `?` may be left out; left out, it is off or at its default.",
            "",
            ...sections,
        ].join("\n");

        mkdirSync(SchemaReference.OUTPUT_DIRECTORY, { recursive: true });
        writeFileSync(new URL("schema.md", SchemaReference.OUTPUT_DIRECTORY), page);
        console.log("docs/reference/schema.md written");
    }

    private static cell(text: string): string {
        return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
    }

    private static render(types: TypeDoc[]): string {
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
                    for (const field of type.fields)
                        parts.push(
                            `| \`${field.path}\` | \`${SchemaReference.cell(field.type)}\` | ${SchemaReference.cell(field.description)} |`
                        );
                    parts.push("");
                }

                return parts.join("\n");
            })
            .join("\n");
    }
}

SchemaReference.main();
