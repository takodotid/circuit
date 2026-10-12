// Combining config from several places: records merge, and a name two of them hold is refused.

import { expect, test } from "bun:test";

test("merge refuses a name two records hold", async () => {
    const { merge } = await import("../../src/core/merge");

    expect(merge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(() => merge({ a: 1 }, { a: 2 })).toThrow("merge: a is declared twice");
});
