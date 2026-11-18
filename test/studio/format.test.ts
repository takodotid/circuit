// A value of the model as one line of text, as Studio's tables show it.

import { expect, test } from "bun:test";
import { Format } from "../../src/studio/app/src/lib/format";

test("a field with nothing in it is left out", () => {
    const rule = { if: { protocol: "tcp", tcp_flags: { set: ["fin", "syn"], unset: [] } }, then: "drop" };

    expect(Format.compact(rule)).toBe("if protocol tcp, tcp_flags set fin, syn, then drop");
});
