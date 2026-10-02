// Every example validates, renders, and plans nothing against its own render. A plan that is not empty there means the reader and the renderer disagree on a form, which would show up as a change on every apply.

import { describe, expect, test } from "bun:test";
import { adapters } from "../src/adapters/devices";
import { defineNetwork } from "../src/core/define";
import { validate } from "../src/core/validate";
import router from "../examples/router";
import switchDevice from "../examples/switch";

const examples = [router, switchDevice];

describe("examples", () => {
    test("validate", () => {
        const findings = validate(defineNetwork({ devices: examples, state: "" }));
        expect(findings).toEqual([]);
    });

    for (const device of examples) {
        test(`${device.name} plans nothing against its own render`, () => {
            const adapter = adapters[device.platform]!;
            const rendered = adapter.render(device);
            const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
            expect(plan.problems).toEqual([]);
            expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
        });
    }
});
