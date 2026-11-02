// A line diff, after Myers' "An O(ND) Difference Algorithm": the fewest lines added and removed that turn one text into another.

export type DiffLine = { kind: "same" | "removed" | "added"; text: string };

export class Diff {
    /** Past this many differences, two texts are too far apart to show line by line. */
    private static readonly MOST_DIFFERENCES = 4000;

    /** The lines of `before` and `after` in order, each marked as kept, removed or added. Undefined when they differ in more than a few thousand lines. */
    static lines(before: readonly string[], after: readonly string[]): DiffLine[] | undefined {
        const n = before.length;
        const m = after.length;
        const limit = Math.min(n + m, Diff.MOST_DIFFERENCES);
        const offset = limit + 1;

        // How far along `before` each diagonal reaches, and a copy of that for each number of differences, to walk back through.
        const reach = new Int32Array(2 * offset + 1);
        const trace: Int32Array[] = [];

        /** Where diagonal k reached after d differences. */
        const reached = (d: number, k: number) => trace[d]![k + d] ?? 0;

        for (let d = 0; d <= limit; d++) {
            for (let k = -d; k <= d; k += 2) {
                const down = k === -d || (k !== d && (reach[k - 1 + offset] ?? 0) < (reach[k + 1 + offset] ?? 0));
                let x = down ? (reach[k + 1 + offset] ?? 0) : (reach[k - 1 + offset] ?? 0) + 1;
                let y = x - k;

                while (x < n && y < m && before[x] === after[y]) {
                    x++;
                    y++;
                }

                reach[k + offset] = x;

                if (x >= n && y >= m) {
                    trace.push(reach.slice(offset - d, offset + d + 1));
                    return Diff.walkBack(before, after, trace, reached);
                }
            }

            trace.push(reach.slice(offset - d, offset + d + 1));
        }

        return undefined;
    }

    /** The edits, found by walking back from the end through what each step reached. */
    private static walkBack(
        before: readonly string[],
        after: readonly string[],
        trace: Int32Array[],
        reached: (d: number, k: number) => number
    ): DiffLine[] {
        const lines: DiffLine[] = [];
        let x = before.length;
        let y = after.length;

        for (let d = trace.length - 1; d > 0; d--) {
            const k = x - y;
            const down = k === -d || (k !== d && reached(d - 1, k - 1) < reached(d - 1, k + 1));
            const previousK = down ? k + 1 : k - 1;
            const previousX = reached(d - 1, previousK);
            const previousY = previousX - previousK;

            while (x > previousX && y > previousY) {
                lines.push({ kind: "same", text: before[--x] ?? "" });
                y--;
            }

            if (down) lines.push({ kind: "added", text: after[--y] ?? "" });
            else lines.push({ kind: "removed", text: before[--x] ?? "" });
        }

        while (x > 0 && y > 0) {
            lines.push({ kind: "same", text: before[--x] ?? "" });
            y--;
        }

        return lines.reverse();
    }

    /** What to show of a diff: each changed line with a few lines around it, and runs of the same folded into a count. */
    static shown(lines: readonly DiffLine[], context = 3): ({ kind: "fold"; count: number } | DiffLine)[] {
        const near = lines.map((_, index) =>
            lines.slice(Math.max(0, index - context), index + context + 1).some((line) => line.kind !== "same")
        );
        const shown: ({ kind: "fold"; count: number } | DiffLine)[] = [];
        let folded = 0;

        for (const [index, line] of lines.entries()) {
            if (!near[index]) {
                folded++;
                continue;
            }
            if (folded) shown.push({ kind: "fold", count: folded });
            folded = 0;
            shown.push(line);
        }
        if (folded) shown.push({ kind: "fold", count: folded });

        return shown;
    }
}
