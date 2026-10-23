// @ts-check
// A line diff, after Myers' "An O(ND) Difference Algorithm": the fewest lines added and removed that turn one text into another.

/** @typedef {{ kind: "same" | "removed" | "added", text: string }} DiffLine */

export class Diff {
    /** Past this many differences, two texts are too far apart to show line by line. */
    static #MOST_DIFFERENCES = 4000;

    /**
     * The lines of `before` and `after` in order, each marked as kept, removed or added. Undefined when they differ in more than a few thousand lines.
     *
     * @param {readonly string[]} before
     * @param {readonly string[]} after
     * @returns {DiffLine[] | undefined}
     */
    static lines(before, after) {
        const n = before.length;
        const m = after.length;
        const limit = Math.min(n + m, Diff.#MOST_DIFFERENCES);
        const offset = limit + 1;

        // How far along `before` each diagonal reaches, and a copy of that for each number of differences, to walk back through.
        const reach = new Int32Array(2 * offset + 1);
        /** @type {Int32Array[]} */
        const trace = [];

        /**
         * Where diagonal k reached after d differences.
         *
         * @param {number} d
         * @param {number} k
         */
        const reached = (d, k) => /** @type {Int32Array} */ (trace[d])[k + d] ?? 0;

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
                    return Diff.#walkBack(before, after, trace, reached);
                }
            }

            trace.push(reach.slice(offset - d, offset + d + 1));
        }

        return undefined;
    }

    /**
     * The edits, found by walking back from the end through what each step reached.
     *
     * @param {readonly string[]} before
     * @param {readonly string[]} after
     * @param {Int32Array[]} trace
     * @param {(d: number, k: number) => number} reached
     * @returns {DiffLine[]}
     */
    static #walkBack(before, after, trace, reached) {
        /** @type {DiffLine[]} */
        const lines = [];
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
}
