// The doc comment of each field a device holds, from src/config/, shown when the pointer is on the field's name. The build reads them (src/studio/field-docs.ts) and Vite writes them into the page as `__FIELD_DOCS__`.

/** One field: the index of its doc in `docs` (-1 for none), and the fields inside it. `*` stands for any name or any item. */
export type FieldTree = [number, Record<string, FieldTree>?];

export type PackedFieldDocs = { docs: string[]; tree: Record<string, FieldTree> };

declare const __FIELD_DOCS__: PackedFieldDocs | undefined;

export class FieldDocs {
    /** What the build wrote into the page, or none outside it, such as in a test. */
    private static carried(): PackedFieldDocs {
        return typeof __FIELD_DOCS__ === "undefined" ? { docs: [], tree: {} } : __FIELD_DOCS__;
    }

    /** The doc of the field at a path, with real names in it (`switching.vlans.servers.id`) or `*`, or nothing. */
    static find(path: string, packed: PackedFieldDocs = FieldDocs.carried()): string | undefined {
        let children: Record<string, FieldTree> | undefined = packed.tree;
        let node: FieldTree | undefined;

        for (const part of path.split(".")) {
            node = children?.[part] ?? children?.["*"];
            if (!node) return undefined;
            children = node[1];
        }

        return node && node[0] >= 0 ? packed.docs[node[0]] : undefined;
    }

    /** A table's column that shows a device field: its label, with the field's doc. */
    static column(label: string, path: string): { label: string; doc?: string } {
        const doc = FieldDocs.find(path);
        return doc ? { label, doc } : { label };
    }
}
