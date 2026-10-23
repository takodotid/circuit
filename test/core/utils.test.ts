// Combining config from several places: records merge, and a name two of them hold is refused.

import { expect, test } from "bun:test";

test("Utils.merge refuses a name two records hold", async () => {
    const { Utils } = await import("../../src/core/utils");

    expect(Utils.merge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(() => Utils.merge({ a: 1 }, { a: 2 })).toThrow("Utils.merge: a is declared twice");
});
