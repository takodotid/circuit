import type { Device, Family } from "../../schema";

/** One part of a plan: what a reviewer reads, and what is sent. */
export type Step = { title: string; show: string[]; send: string[] };

/** The commands that turn what a device runs into what its config says. `problems` blocks an apply: something the adapter cannot converge. */
export type Plan = { steps: Step[]; problems: string[] };

export type ApplyOptions = {
    /** Also send every secret, so a rotated value reaches the device. Secrets cannot be read back, so they are otherwise only sent when the object holding them is new. */
    secrets: boolean;
    /** Minutes before a platform that can restore itself does so, if the run does not prove access survived. */
    rollback: number;
};

export type DeviceAdapter = {
    /** File extension of a saved snapshot, for syntax highlighting. */
    extension: string;
    /** Fields this platform cannot express. Validation fails on any of them, so nothing is skipped silently. */
    unsupported(device: Device): string[];
    /** The whole configuration the device should run. Secrets appear as markers, never values. */
    render(device: Device): string;
    /** What the device runs now, secrets removed, in the form `render` produces where the platform allows. */
    read(device: Device, network: readonly Device[]): Promise<string>;
    /** What it takes to go from `current` to `desired`. */
    plan(desired: string, current: string, options: ApplyOptions): Plan;
    /** Replace the contents of a prefix set fetched from a registry. Absent on a platform that cannot hold one. */
    fill?(device: Device, network: readonly Device[], set: string, family: Family, prefixes: string[]): Promise<void>;
    /** Send a plan, keeping the device reachable or restoring it. */
    apply(device: Device, network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void>;
};
