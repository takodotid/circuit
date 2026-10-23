// The schema's own comments, read as data: each type, what it is, and each field with its type and description. The schema reference page and Studio both show them.

export type Field = { path: string; type: string; description: string };
export type TypeDoc = { name: string; description: string; definition?: string; includes?: string[]; fields: Field[] };

export class SchemaDocs {
    /** The schema files in reading order, with the title each gets. */
    static readonly FILES = [
        ["device.ts", "Device"],
        ["interfaces.ts", "Ports and interfaces"],
        ["routing.ts", "Routing"],
        ["policy.ts", "Route policies"],
        ["firewall.ts", "Firewall and ACLs"],
        ["system.ts", "System and management"],
        ["common.ts", "Common values"],
    ] as const;

    /** The text of a JSDoc comment, without its markers, as one paragraph. */
    private static commentText(lines: string[]): string {
        return lines
            .map((line) => line.replace(/^\s*\/\*\*\s?|\s*\*\/\s*$|^\s*\*\s?/g, "").trim())
            .filter(Boolean)
            .join(" ");
    }

    /** What a type parameter stands for, where it is not one of the device's names. */
    private static readonly PARAMETER_MEANING: Record<string, string> = { Pl: "platform", M: "model" };

    /** A type as a reader needs it: "name" for each of the device's names, and no parameter list on the schema's own types. */
    private static withoutGenerics(type: string, generics: Set<string>): string {
        let result = type;
        while (/NoInfer<([^<>]*)>/.test(result)) {
            result = result.replace(/NoInfer<([^<>]*)>/g, (_, inner: string) => (inner.includes("|") ? `(${inner})` : inner));
        }

        for (const name of generics) {
            result = result.replace(new RegExp(`\\b${name}<[^<>]*(?:<[^<>]*>[^<>]*)*>`, "g"), name);
        }

        return result
            .replace(/\b(Pl|M|N|V|I|P|S|G|A|AS|U|F|C|L|K)\b/g, (parameter) => SchemaDocs.PARAMETER_MEANING[parameter] ?? "name")
            .replace(/\bname(?: \| name)+\b/g, "name")
            .replace(/\(name\)/g, "name");
    }

    private static parse(source: string, generics: Set<string>): TypeDoc[] {
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
                if (declaration[2]) generics.add(declaration[1]!);

                current = { name: declaration[1]!, description: SchemaDocs.commentText(comment), fields: [] };
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

                current.fields.push({ path: `${path}${optional ? "?" : ""}`, type, description: SchemaDocs.commentText(comment) });
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

    /** Every type in each schema file, in the order given. Every file is read first, so a type is known to take parameters wherever it is used. */
    static read(sources: readonly string[]): TypeDoc[][] {
        const generics = new Set<string>();
        const parsed = sources.map((source) => SchemaDocs.parse(source, generics));

        for (const types of parsed) {
            for (const type of types) {
                if (type.definition) type.definition = SchemaDocs.withoutGenerics(type.definition, generics);
                if (type.includes) type.includes = type.includes.map((name) => SchemaDocs.withoutGenerics(name, generics));
                for (const field of type.fields) field.type = SchemaDocs.withoutGenerics(field.type, generics);
            }
        }

        return parsed;
    }
}
