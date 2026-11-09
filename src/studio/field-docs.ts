// The doc comment of every field a device can hold, read from src/config/ when Studio's page is built, so the page shows a field's documentation when the pointer is on its name. Only the build runs it: the TypeScript compiler API is not in the `circuit` binary.

import { join } from "node:path";
import ts from "typescript-6";
import type { FieldTree, PackedFieldDocs } from "./app/src/lib/field-docs.ts";

export class FieldDocsReader {
    /**
     * Every field of a device, by path, with its doc comment: `routing.bgp.neighbors.*.remote_as`. `*` stands for any name in a map
     * keyed by name, and for any item of a list.
     */
    static read(configFolder = join(import.meta.dirname, "..", "config")): Record<string, string> {
        const file = join(configFolder, "device.ts");
        const program = ts.createProgram([file], {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: [],
        });
        const checker = program.getTypeChecker();

        const source = program.getSourceFile(file);
        const module = source && checker.getSymbolAtLocation(source);
        const device = module && checker.getExportsOfModule(module).find((symbol) => symbol.name === "AnyDevice");
        if (!device) throw new Error(`no AnyDevice in ${file}`);

        const docs: Record<string, string> = {};
        FieldDocsReader.walk(checker, checker.getDeclaredTypeOfSymbol(device), "", docs, []);
        return docs;
    }

    /** The object types a field's value can be: each member of a union, each item of a list, each value of a map. */
    private static shapes(checker: ts.TypeChecker, type: ts.Type): { type: ts.Type; stars: string }[] {
        const members = type.isUnion() ? type.types : [type];

        return members.flatMap((member) => {
            if (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) return [];
            if (checker.isArrayType(member) || checker.isTupleType(member)) {
                const items = checker.getTypeArguments(member as ts.TypeReference);
                return items
                    .flatMap((item) => FieldDocsReader.shapes(checker, item))
                    .map((shape) => ({ ...shape, stars: `${shape.stars}.*` }));
            }
            if (!(member.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) || member.getCallSignatures().length) return [];

            // A map keyed by name, such as VLANs: each value as the item.
            const byName = checker.getIndexInfoOfType(member, ts.IndexKind.String);
            if (byName && !checker.getPropertiesOfType(member).length)
                return FieldDocsReader.shapes(checker, byName.type).map((shape) => ({ ...shape, stars: `${shape.stars}.*` }));

            return [{ type: member, stars: "" }];
        });
    }

    private static walk(checker: ts.TypeChecker, type: ts.Type, path: string, docs: Record<string, string>, seen: ts.Type[]): void {
        // A type inside itself, such as a nested group, is read once.
        if (seen.includes(type) || seen.length > 12) return;

        for (const property of checker.getPropertiesOfType(type)) {
            const at = path ? `${path}.${property.name}` : property.name;
            const doc = ts.displayPartsToString(property.getDocumentationComment(checker)).replace(/\s+/g, " ").trim();
            // The members of a union may each say it their own way: each is kept, once.
            if (doc && !docs[at]?.includes(doc)) docs[at] = docs[at] ? `${docs[at]} ${doc}` : doc;

            const value = checker.getNonNullableType(checker.getTypeOfSymbol(property));
            for (const shape of FieldDocsReader.shapes(checker, value))
                FieldDocsReader.walk(checker, shape.type, `${at}${shape.stars}`, docs, [...seen, type]);
        }
    }

    /** The docs as the page carries them: each text once, and the paths as a tree, so a path shared by many fields is written once. A secret's own fields are left out: Studio shows a secret as `secret("NAME")`. */
    static pack(docs: Readonly<Record<string, string>>): PackedFieldDocs {
        const texts: string[] = [];
        const tree: Record<string, FieldTree> = {};

        for (const [path, doc] of Object.entries(docs)) {
            if (/\.secret(_file)?$/.test(path)) continue;

            if (!texts.includes(doc)) texts.push(doc);
            let children = tree;
            let node: FieldTree | undefined;
            for (const part of path.split(".")) {
                node = children[part] ??= [-1];
                children = node[1] ??= {};
            }
            if (node) node[0] = texts.indexOf(doc);
        }

        // A field with nothing inside keeps no empty map.
        const prune = (node: FieldTree): void => {
            if (!node[1]) return;
            if (!Object.keys(node[1]).length) node.length = 1;
            else Object.values(node[1]).forEach(prune);
        };
        Object.values(tree).forEach(prune);

        return { docs: texts, tree };
    }
}
