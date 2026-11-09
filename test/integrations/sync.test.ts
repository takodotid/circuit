// The flow every `circuit sync <target>` shares, on a fake target: nothing to change, the answer No, no person to answer without --confirm,
// a send that leaves nothing, and a send that leaves something.

import { expect, test } from "bun:test";
import { Sync, type SyncAnswers, type SyncPlan, type SyncTarget } from "../../src/integrations/sync";

/** A target whose plans come one after another from `plans`, and which counts what it was sent. */
function fakeTarget(plans: SyncPlan[]): SyncTarget & { sent: SyncPlan[] } {
    const sent: SyncPlan[] = [];
    let next = 0;

    return {
        name: "Fake",
        heading: "Fake",
        where: "Fake at https://fake.example.com",
        sent,
        plan: async () => plans[Math.min(next++, plans.length - 1)]!,
        send: async (plan) => {
            sent.push(plan);
        },
    };
}

const nothing: SyncPlan = { changes: [], summary: [], leftAlone: ["printer: not in the project, left as it is."] };
const something: SyncPlan = {
    changes: [{ sign: "~", what: "edge-01", details: ['description: "old" to "new"'] }],
    summary: [],
    leftAlone: [],
};

const answers = (overrides: Partial<SyncAnswers>): SyncAnswers => ({
    confirmed: false,
    interactive: true,
    ask: async () => {
        throw new Error("asked");
    },
    ...overrides,
});

test("nothing to change: says so, asks nothing, sends nothing", async () => {
    const target = fakeTarget([nothing]);
    expect(await Sync.run(target, answers({}))).toBe("matches");
    expect(target.sent).toEqual([]);
});

test("the answer No sends nothing; without a person and without --confirm, nothing is sent either", async () => {
    const asked: string[] = [];
    const declined = fakeTarget([something]);
    expect(await Sync.run(declined, answers({ ask: async (question) => (asked.push(question), false) }))).toBe("declined");
    expect(asked).toEqual(["Send these changes to Fake?"]);
    expect(declined.sent).toEqual([]);

    const script = fakeTarget([something]);
    expect(await Sync.run(script, answers({ interactive: false }))).toBe("not-sent");
    expect(script.sent).toEqual([]);
});

test("after sending it reads and plans again: nothing left is done, something left fails", async () => {
    const done = fakeTarget([something, nothing]);
    expect(await Sync.run(done, answers({ confirmed: true, interactive: false }))).toBe("sent");
    expect(done.sent).toEqual([something]);

    const stuck = fakeTarget([something, something]);
    expect(await Sync.run(stuck, answers({ ask: async () => true }))).toBe("left");
});

test("the plan reads + make, ~ change with each field, - delete, then the counts and what is left alone", () => {
    const lines = Sync.text("NetBox", {
        changes: [
            { sign: "+", what: "dcim/devices edge-02", details: [] },
            { sign: "~", what: "dcim/interfaces edge-01/sfp28-2", details: ['description: null to "edge-02 25g-1"'] },
            { sign: "-", what: "dcim/devices edge-old", details: [] },
        ],
        summary: ["dcim/devices: 1 to create, 0 to change, 1 to delete"],
        leftAlone: ["BGP sessions (2): NetBox has no place for them without a plugin."],
    });

    expect(lines.join("\n")).toBe(
        [
            "NetBox: 3 change(s)",
            "  + dcim/devices edge-02",
            "  ~ dcim/interfaces edge-01/sfp28-2",
            '      description: null to "edge-02 25g-1"',
            "  - dcim/devices edge-old",
            "",
            "  dcim/devices: 1 to create, 0 to change, 1 to delete",
            "",
            "Left alone:",
            "  BGP sessions (2): NetBox has no place for them without a plugin.",
        ].join("\n")
    );
});
