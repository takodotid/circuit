import type { Device, Family } from "../schema";
import type { PlatformName } from "./catalog";

/** One part of a plan: what a reviewer reads, and what is sent. */
export type Step = { title: string; show: string[]; send: string[] };

/** The commands that turn what a device runs into what its config says. `problems` blocks an apply: something the adapter cannot converge. */
export type Plan = { steps: Step[]; problems: string[] };

export type ApplyOptions = {
    /** Also send every secret, so a rotated value reaches the device. Secrets cannot be read back, so they are otherwise only sent when the object holding them is new. */
    secrets: boolean;
    /** Minutes before a platform that can restore itself does so, if the run does not prove access survived. */
    rollback: number;
    /** Reach the device through its serial console, `connection.console`, instead of SSH to its management address. */
    console?: boolean;
};

/** How a device is read. */
export type ReadOptions = Pick<ApplyOptions, "console">;

/** A login on a device for commands that only read, as `circuit show` runs them. */
export type ReadSession = {
    /**
     * Run one command and return what it printed, without its echo or the prompt.
     *
     * At `timeout` milliseconds, a command run on its own over SSH is left, and what it printed so far is returned. In a shell or on a console, where it would hold up every command after it, the run fails instead.
     */
    run(command: string, timeout?: number): Promise<string>;
    /** Log out. */
    close(): void;
};

/** The operating system a platform runs, and the versions it is proved on. */
export type OsSupport = {
    /** Its name in full, such as `MikroTik RouterOS`. */
    name: string;
    /** The versions the adapter renders for, such as `7`. */
    versions: string;
    /** The device and version it was proved on, such as `CCR2216-1G-12XS-2XQ, RouterOS 7.23`. */
    provedOn: string;
    /** Whether a read or an apply refuses a device on another version. */
    checked: boolean;
};

export abstract class Platform {
    /** The name a device's `platform` field takes. */
    abstract readonly name: PlatformName;
    abstract readonly os: OsSupport;
    /** File extension of a saved snapshot, for syntax highlighting. */
    abstract readonly extension: string;
    /** The platform can be read and applied through a serial console, `--console`. */
    readonly console: boolean = false;
    /** Fields this platform cannot express. Validation fails on any of them, so nothing is skipped silently. */
    abstract unsupported(device: Device): string[];
    /** The whole configuration the device should run. Secrets appear as markers, never values. */
    abstract render(device: Device): string;
    /** What the device runs now, secrets removed, in the form `render` produces where the platform allows. */
    abstract read(device: Device, network: readonly Device[], options?: ReadOptions): Promise<string>;
    /** What it takes to go from `current` to `desired`. */
    abstract plan(desired: string, current: string, options: ApplyOptions): Plan;
    /** Replace the contents of a prefix set fetched from a registry. Absent on a platform that cannot hold one. */
    fill?(device: Device, network: readonly Device[], set: string, family: Family, prefixes: string[]): Promise<void>;
    /** Send a plan, keeping the device reachable or restoring it. */
    abstract apply(device: Device, network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void>;
    /** Whether a command only reads on this platform, so `circuit show` may send it. Anything not known to only read is refused. */
    abstract readOnly(command: string): boolean;
    /** Log in for commands that only read, over SSH or on the console, the way the platform's read logs in. */
    abstract session(device: Device, options?: ReadOptions): Promise<ReadSession>;
}
