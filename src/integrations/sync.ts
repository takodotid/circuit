// A target only reads, plans, and sends. The command in src/cli/sync.ts prints the plan and asks the person.

import type { Integrations, Site } from "../config/network";
import type { Device, Secret } from "../model";

/** One network of the project, as a sync target reads it. */
export type SyncNetwork = {
    /** Its name in `circuit.ts`, such as `as64500`. */
    name: string;
    asn?: number;
    sites: Readonly<Record<string, Site>>;
    integrations: Integrations;
    devices: readonly Device[];
    /** The value of one of this network's secrets, from its own secrets file. Never printed. */
    reveal: (secret: Secret) => string;
};

/** One thing to make (`+`), change (`~`), or delete (`-`) in the other system. */
export type SyncChange = {
    sign: "+" | "~" | "-";
    /** What it is, such as `dcim/devices edge-02`. */
    what: string;
    /** For a change, each field as `field: before to after`, or each line of a file. Never a secret's value. */
    details: string[];
};

export type SyncPlan = {
    changes: SyncChange[];
    /** Counts after the changes, such as `dcim/devices: 1 to create, 0 to change, 1 to delete`. */
    summary: string[];
    /** What Circuit sees but does not touch, each with its reason. */
    leftAlone: string[];
};

/** A system Circuit keeps in sync with the project. */
export type SyncTarget<P extends SyncPlan = SyncPlan> = {
    /** Its name in a question, such as `NetBox`. */
    readonly name: string;
    /** Its name over the plan, such as `PeeringDB (AS64500)`. */
    readonly heading: string;
    /** Where it is, for the spinner: `NetBox at https://netbox.example.com`. */
    readonly where: string;
    /** Compare the project with what the system holds. Reads only. */
    plan(): Promise<P>;
    send(plan: P): Promise<void>;
};
