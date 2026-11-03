// A table on the command line: every row as wide as the heading, numbers on the right, and the last column on more lines in a narrow terminal.

import { afterEach, describe, expect, test } from "bun:test";
import { Ui } from "../../src/cli/ui";

const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");

afterEach(() => {
    if (tty) Object.defineProperty(process.stdout, "isTTY", tty);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    if (columns) Object.defineProperty(process.stdout, "columns", columns);
    else delete (process.stdout as { columns?: number }).columns;
});

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

describe("Ui.table", () => {
    test("lines up every cell, with a number column on the right", () => {
        const table = plain(
            Ui.table(
                [{ title: "Neighbor" }, { title: "Prefixes", right: true }],
                [
                    ["hurricane-electric", "987654"],
                    ["de-cix", "0"],
                ]
            )
        );

        expect(table).toBe(
            [
                "┌────────────────────┬──────────┐",
                "│ Neighbor           │ Prefixes │",
                "├────────────────────┼──────────┤",
                "│ hurricane-electric │   987654 │",
                "│ de-cix             │        0 │",
                "└────────────────────┴──────────┘",
            ].join("\n")
        );
    });

    test("in a narrow terminal, the last column goes on more lines", () => {
        Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
        Object.defineProperty(process.stdout, "columns", { value: 40, configurable: true });

        const lines = plain(
            Ui.table([{ title: "Neighbor" }, { title: "Why" }], [["de-cix", "limit exceeded: over 100000 prefixes"]])
        ).split("\n");

        for (const line of lines) expect(line.length).toBeLessThanOrEqual(40);
        expect(lines.filter((line) => line.startsWith("│")).length).toBeGreaterThan(2);
    });
});
