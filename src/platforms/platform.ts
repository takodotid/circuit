import type { Device, Family } from "../schema";
import type { ConsoleDialect } from "../transport/console";
import type { WaitLimits } from "./bgp-wait";
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

/** How the checks after an apply reach the device, and how long they wait. */
export type HealthOptions = ReadOptions & {
    /** How long BGP sessions established before the apply have to be established again. `BgpWait.AFTER_APPLY` when absent. */
    bgp?: WaitLimits;
};

/** The checks after an apply, holding what they compare against, which was read before the plan was sent. */
export type HealthCheck = {
    /** Run the checks. Gives one line per problem, each saying what to do; none when the device is healthy. */
    run(): Promise<string[]>;
};

/** A BGP neighbor in the config and its live session, as `circuit bgp` shows it. A neighbor with no session is not established. */
export type BgpSession = {
    /** The neighbor's name in the config. */
    neighbor: string;
    /** The session's remote address, or `-` when there is no session. */
    remote: string;
    /** Whether the session is established. */
    established: boolean;
    /** How many prefixes it received, as the device prints it, or `-`. */
    prefixes: string;
    /** How long it has been up, as the device prints it, or `no session`. */
    uptime: string;
};

/** One BGP log line: when, as the device printed it, such as `2026-10-24 03:12:44`, and the rest of the line. */
export type BgpLogLine = { at: string; message: string };

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

/** The switch rules a render makes from a device's hardware ACLs, counted. */
export type SwitchRules = {
    /** How many rules there are. */
    count: number;
    /** How many distinct port ranges they use, such as `0-1023`. */
    ranges: number;
};

export abstract class Platform {
    /** The name a device's `platform` field takes. */
    abstract readonly name: PlatformName;
    abstract readonly os: OsSupport;
    /** File extension of a saved snapshot, for syntax highlighting. */
    abstract readonly extension: string;
    /** How the platform's serial console asks for a login and shows its prompt. Present when the platform can be read and applied through a console, `--console`, and opened with `circuit console`. */
    readonly console: ConsoleDialect | undefined = undefined;
    /** Fields this platform cannot express. Validation fails on any of them, so nothing is skipped silently. */
    abstract unsupported(device: Device): string[];
    /** The switch rules the render makes from the device's hardware ACLs, so `validate` can hold them to the model's limits. Absent on a platform whose rules are not counted. */
    switchRules?(device: Device): SwitchRules;
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
    /** Each BGP neighbor in the config, in its order, with its live session, read over a `session()`. Absent on a platform `circuit bgp` does not support yet. */
    bgpSessions?(device: Device, session: ReadSession): Promise<BgpSession[]>;
    /** The device's BGP log lines from the last `minutes`, by the device's own clock, read over a `session()`. */
    bgpLog?(session: ReadSession, minutes: number): Promise<BgpLogLine[]>;
    /**
     * Checks that the device is healthy after an apply, not only that it took the commands. Called before the plan is sent, to read what the checks compare against; the CLI runs them after the apply and the snapshot. Absent on a platform with no checks yet.
     */
    health?(device: Device, plan: Plan, options?: HealthOptions): Promise<HealthCheck>;
}
