// The text editor `circuit secrets` opens: the keys a terminal sends, editing the text, saving and leaving, on a terminal of the test's own.

import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { EditorBuffer, type TerminalInput, type TerminalOutput, TextEditor } from "../../src/cli/text-editor";

describe("keys", () => {
    test("arrows, Home, End, Delete and the controls", () => {
        expect(TextEditor.keys("\x1b[A\x1b[B\x1b[C\x1b[D\x1b[H\x1b[F\x1b[3~\x1b[5~\x1b[6~").map((key) => key.kind)).toEqual([
            "up",
            "down",
            "right",
            "left",
            "home",
            "end",
            "delete",
            "page-up",
            "page-down",
        ]);
        expect(TextEditor.keys("\x13\x11\r\x7f").map((key) => key.kind)).toEqual(["save", "quit", "enter", "backspace"]);
        expect(TextEditor.keys("\x18").map((key) => key.kind)).toEqual(["quit"]);
    });

    test("Esc alone leaves; Esc that starts a sequence does not", () => {
        expect(TextEditor.keys("\x1b")).toEqual([{ kind: "quit" }]);
        expect(TextEditor.keys("\x1b[A")).toEqual([{ kind: "up" }]);
    });

    test("typed text stays together, and Enter sent as \\r\\n is one Enter", () => {
        expect(TextEditor.keys("ab\r\ncd")).toEqual([{ kind: "text", text: "ab" }, { kind: "enter" }, { kind: "text", text: "cd" }]);
    });

    test("a paste is text, even with lines and escapes in it", () => {
        expect(TextEditor.keys("\x1b[200~A=1\r\nB=\x1b2\x1b[201~")).toEqual([{ kind: "text", text: "A=1\r\nB=\x1b2" }]);
    });

    test("an unknown sequence, and Ctrl with an arrow, are read without breaking the rest", () => {
        expect(TextEditor.keys("\x1b[1;5Cx\x1b[99zy")).toEqual([
            { kind: "right" },
            { kind: "text", text: "x" },
            { kind: "text", text: "y" },
        ]);
    });
});

describe("the buffer", () => {
    test("typing, a new line, backspace across lines, delete", () => {
        const buffer = new EditorBuffer("A=1\nB=2\n");
        buffer.move("end");
        buffer.insert("0");
        buffer.newline();
        buffer.insert("C=3");
        expect(buffer.text()).toBe("A=10\nC=3\nB=2\n");

        buffer.move("home");
        buffer.backspace();
        expect(buffer.text()).toBe("A=10C=3\nB=2\n");
        buffer.delete();
        expect(buffer.text()).toBe("A=10=3\nB=2\n");
        expect(buffer.modified).toBe(true);
    });

    test("a paste of several lines lands at the cursor", () => {
        const buffer = new EditorBuffer("X=\n");
        buffer.move("end");
        buffer.insert("a\r\nY=b\nZ=");
        expect(buffer.text()).toBe("X=a\nY=b\nZ=\n");
        expect([buffer.row, buffer.col]).toEqual([2, 2]);
    });

    test("the cursor stays inside the text", () => {
        const buffer = new EditorBuffer("long line\nab\n");
        buffer.move("end");
        buffer.move("down");
        expect([buffer.row, buffer.col]).toEqual([1, 2]);
        buffer.move("down", 10);
        buffer.move("right");
        expect([buffer.row, buffer.col]).toEqual([1, 2]);
    });
});

/** A terminal the test types into. */
function terminal() {
    const input = Object.assign(new EventEmitter(), {
        raw: false,
        setRawMode(mode: boolean) {
            this.raw = mode;
        },
        resume() {},
        pause() {},
        setEncoding() {},
    });
    const drawn: string[] = [];
    const output = Object.assign(new EventEmitter(), { rows: 10, columns: 40, write: (text: string) => drawn.push(text) > 0 });
    return { input, output, drawn, type: (data: string) => input.emit("data", data) };
}

describe("the editor", () => {
    test("saves with Ctrl+S, leaves with Ctrl+Q, and gives the terminal back", async () => {
        const t = terminal();
        const saved: string[] = [];
        const done = TextEditor.open({
            title: "Secrets",
            text: "A=1\n",
            save: (text) => void saved.push(text),
            terminal: { input: t.input as unknown as TerminalInput, output: t.output as unknown as TerminalOutput },
        });

        expect(t.input.raw).toBe(true);
        t.type("\x1b[FB\x13");
        t.type("\x11");
        await done;

        expect(saved).toEqual(["A=1B\n"]);
        expect(t.input.raw).toBe(false);
        expect(t.drawn[0]).toContain("\x1b[?1049h");
        expect(t.drawn.at(-1)).toContain("\x1b[?1049l");
    });

    test("a save that fails says why, and leaving unsaved takes a second Ctrl+Q", async () => {
        const t = terminal();
        let left = false;
        const done = TextEditor.open({
            title: "Secrets",
            text: "A=1\n",
            save: () => "line 1: no",
            terminal: { input: t.input as unknown as TerminalInput, output: t.output as unknown as TerminalOutput },
        }).then(() => (left = true));

        t.type("x\x13");
        expect(t.drawn.at(-1)).toContain("Not saved: line 1: no");
        t.type("\x11");
        await Promise.resolve();
        expect(left).toBe(false);
        expect(t.drawn.at(-1)).toContain("Esc again");
        t.type("\x1b");
        await done;
        expect(left).toBe(true);
    });
});
