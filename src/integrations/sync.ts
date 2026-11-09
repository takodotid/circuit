// What every `circuit sync <target>` shares: read the other system, print the plan, ask, send, then read and plan again. Each target (NetBox, LibreNMS, PeeringDB, Prometheus) only reads, plans and sends; this file talks to the person.

import { Ui } from "../cli/ui";
import type { Integrations, Site } from "../config/network";
import type { Device, Secret } from "../model";

/** One network of the project, as a sync target reads it. */
export type SyncNetwork = {
    /** Its name in `circuit.ts`, such as `as64500`. */
    name: string;
    asn?: number;
    /** Each site, by name. */
    sites: Readonly<Record<string, Site>>;
    integrations: Integrations;
    devices: readonly Device[];
    /** The value of one of this network's secrets, from its own secrets file. Never printed. */
    reveal: (secret: Secret) => string;
};

/** One thing to make (`+`), change (`~`) or delete (`-`) in the other system. */
export type SyncChange = {
    sign: "+" | "~" | "-";
    /** What it is, such as `dcim/devices edge-02`. */
    what: string;
    /** For a change, each field as `field: before to after`, or each line of a file. Never a secret's value. */
    details: string[];
};

/** What a sync would do. */
export type SyncPlan = {
    changes: SyncChange[];
    /** Counts after the changes, such as `dcim/devices: 1 to create, 0 to change, 1 to delete`. */
    summary: string[];
    /** What Circuit sees but does not touch, each with its reason. */
    leftAlone: string[];
};

/** A system Circuit keeps in step with the project. */
export type SyncTarget<P extends SyncPlan = SyncPlan> = {
    /** Its name in a question, such as `NetBox`. */
    readonly name: string;
    /** Its name over the plan, such as `PeeringDB (AS64500)`. */
    readonly heading: string;
    /** Where it is, for the spinner: `NetBox at https://netbox.example.com`. */
    readonly where: string;
    /** Compare the project with what the system holds. Reads only. */
    plan(): Promise<P>;
    /** Send the plan. */
    send(plan: P): Promise<void>;
};

/** How a sync ended: `matches` and `sent` and `declined` exit 0; `not-sent` and `left` exit 1. */
export type SyncOutcome = "matches" | "declined" | "not-sent" | "sent" | "left";

/** Whether to send without asking, whether a person can answer, and how to ask them. */
export type SyncAnswers = {
    /** `--confirm`: send without asking. */
    confirmed: boolean;
    /** A person is at a terminal. */
    interactive: boolean;
    /** Ask a yes or no question, No by default. */
    ask: (question: string) => Promise<boolean>;
};

export class Sync {
    /** The targets, in the order Circuit lists them. */
    static readonly TARGETS = ["netbox", "librenms", "peeringdb", "prometheus"] as const;

    /** How many changes a plan holds. */
    static count(plan: SyncPlan): number {
        return plan.changes.length;
    }

    /** The plan as the lines Circuit prints: the changes, the counts, then what is left alone. */
    static text(heading: string, plan: SyncPlan): string[] {
        const lines: string[] = [];

        if (plan.changes.length) {
            lines.push(Ui.bold(`${heading}: ${plan.changes.length} change(s)`));

            for (const change of plan.changes) {
                const paint = change.sign === "+" ? Ui.green : change.sign === "-" ? Ui.red : Ui.yellow;
                lines.push(`  ${paint(change.sign)} ${change.what}`);
                for (const detail of change.details) lines.push(`      ${detail}`);
            }

            if (plan.summary.length) lines.push("", ...plan.summary.map((line) => `  ${line}`));
        }

        if (plan.leftAlone.length) {
            if (lines.length) lines.push("");
            lines.push("Left alone:", ...plan.leftAlone.map((line) => `  ${line}`));
        }

        return lines;
    }

    /** Read, plan, print, ask, send, then read and plan again. Returns how it ended; the caller sets the exit code. */
    static async run<P extends SyncPlan>(target: SyncTarget<P>, answers: SyncAnswers): Promise<SyncOutcome> {
        const plan = await Ui.step(`Reading ${target.where}`, () => target.plan());
        const lines = Sync.text(target.heading, plan);
        if (lines.length) console.log(`\n${lines.join("\n")}\n`);

        if (!Sync.count(plan)) {
            Ui.done(`${target.name} already matches the project. Nothing to change.`);
            return "matches";
        }

        if (!answers.confirmed) {
            if (!answers.interactive) {
                console.error(Ui.red("Not sent. Without a person to answer, add --confirm to send.", process.stderr));
                return "not-sent";
            }
            if (!(await answers.ask(`Send these changes to ${target.name}?`))) {
                console.log("Nothing sent.");
                return "declined";
            }
        }

        await Ui.step(`Sending the changes to ${target.name}`, () => target.send(plan));

        const left = await Ui.step(`Reading ${target.where} again`, () => target.plan());
        if (Sync.count(left)) {
            console.log(`\n${Sync.text(target.heading, left).join("\n")}\n`);
            console.error(Ui.red(`Sent, but ${target.name} still differs from the project in what is shown above.`, process.stderr));
            return "left";
        }

        Ui.done(`${target.name} matches the project now.`);
        return "sent";
    }
}
