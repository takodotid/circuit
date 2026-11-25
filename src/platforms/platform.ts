import type { Neighbor } from "../core/cabling";
import type { Device, Finding } from "../model";
import type { ConsoleDialect } from "../transport/console";
import type { WaitLimits } from "./bgp-wait";
import type { Platform as PlatformName } from "../config/models";

/** One part of a plan: `show` is what a reviewer reads, `send` what is sent. */
export type Step = { title: string; show: string[]; send: string[] };

/** The commands that turn what a device runs into its config. Any of `problems` blocks an apply: something the adapter can't converge. */
export type Plan = { steps: Step[]; problems: string[] };

export type ApplyOptions = {
    /** Also send every secret, so a rotated value reaches the device. Secrets can't be read back, so otherwise they are sent only when the object holding them is new. */
    secrets: boolean;
    /** Minutes before a platform that can restore itself does so, if the run doesn't test that access survived. */
    rollback: number;
    /** Reach the device through its serial console, `connection.console`, instead of SSH. */
    console?: boolean;
};

export type ReadOptions = Pick<ApplyOptions, "console">;

/** A login for commands that only read, as `circuit exec` runs them. */
export type ReadSession = {
    /**
     * What one command printed, without its echo or the prompt.
     *
     * At `timeout` milliseconds, a command run on its own over SSH is left, and what it printed so far is returned. In a shell or on a console, where it would hold up every command after it, the run fails instead.
     */
    run(command: string, timeout?: number): Promise<string>;
    close(): void;
};

/** How the checks after an apply reach the device, and how long they wait. */
export type HealthOptions = ReadOptions & {
    /** How long BGP sessions established before the apply have to be established again. `BgpWait.AFTER_APPLY` when absent. */
    bgp?: WaitLimits;
};

/** The checks after an apply. They hold what they compare against, read before the plan was sent. */
export type HealthCheck = {
    /** One line per problem, each saying what to do. None when the device is healthy. */
    run(): Promise<string[]>;
};

/** A BGP neighbor in the config and its live session, as `circuit bgp` shows it. A neighbor with no session is not established. */
export type BgpSession = {
    /** Its name in the config. */
    neighbor: string;
    /** The session's remote address, or `-` when there is no session. */
    remote: string;
    established: boolean;
    /** How many prefixes it received, as the device prints it, or `-`. */
    prefixes: string;
    /** How long it has been up, as the device prints it, or `no session`. */
    uptime: string;
    /** Why it is down, when the device says: `limit exceeded`, `admin down`, `connecting`, or the BGP state it prints, such as `Active`. */
    reason?: string;
    /** It closed because the neighbor sent more prefixes than its limit, and stays closed until cleared. */
    limit?: BgpLimit;
};

/** A session closed on its prefix limit: the limit, and when it closed, as the device prints it and in milliseconds, to compare. */
export type BgpLimit = { max?: number; stopped?: string; stoppedAt?: number };

/** One BGP log line: when, as the device printed it, such as `2026-10-24 03:12:44`, and the rest of the line. */
export type BgpLogLine = { at: string; message: string };

/** The operating system a platform runs, and the versions it is tested on. */
export type OsSupport = {
    /** Its full name, such as `MikroTik RouterOS`. */
    name: string;
    /** The versions the adapter renders for, such as `7`. */
    versions: string;
    /** The device and version it was tested on, such as `CCR2216-1G-12XS-2XQ, RouterOS 7.23`. */
    testedOn: string;
    /** Whether a read or an apply refuses a device on another version. */
    checked: boolean;
};

/** Circuit's own tools that read a device's state: `circuit bgp`, and the checks after an apply. */
export type Tool = "bgp" | "health";

/** The switch rules a render makes from a device's hardware ACLs, counted. */
export type SwitchRules = {
    count: number;
    /** How many distinct port ranges they use, such as `0-1023`. */
    ranges: number;
};

export abstract class Platform {
    /** The value of a device's `platform` field. */
    abstract readonly name: PlatformName;
    abstract readonly os: OsSupport;
    /** The config's file extension, for syntax highlighting. */
    abstract readonly extension: string;
    /** How the serial console asks for a login and shows its prompt. Present when `--console` and `circuit access-console` work on the platform. */
    readonly console: ConsoleDialect | undefined = undefined;
    /** Tools built from the vendor's documentation, not yet tested on a device. Each runs only with `--experimental`. */
    readonly experimentalTools: readonly Tool[] = [];
    /** Fields this platform can't express. Validation fails on any of them, so nothing is skipped silently. */
    abstract unsupported(device: Device): string[];
    /** Fields this platform renders but hasn't tested on a device yet. Validation refuses them, unless `--experimental` makes each a warning. Absent on a platform with none. */
    experimental?(device: Device): string[];
    /** What the platform does with a config that it may not do elsewhere, as `validate` reports it. An error stops `diff` and `apply`; a warning is only reported. Absent on a platform with none. */
    checks?(device: Device): Finding[];
    /** The switch rules the render makes from the hardware ACLs, so `validate` can hold them to the model's limits. Absent on a platform whose rules are not counted. */
    switchRules?(device: Device): SwitchRules;
    /** The whole configuration the device should run. Secrets appear as markers, never values. */
    abstract render(device: Device): string;
    /** What the device runs now, secrets removed, in the form `render` produces where the platform allows. */
    abstract read(device: Device, network: readonly Device[], options?: ReadOptions): Promise<string>;
    /** The LLDP neighbors the device sees, by Circuit's port names, which `diff` and `apply` compare with each port's `link`. Absent on a platform whose LLDP command isn't tested on a device yet. */
    neighbors?(device: Device, network: readonly Device[], options?: ReadOptions): Promise<Neighbor[]>;
    /** What it takes to go from `current` to `desired`. */
    abstract plan(desired: string, current: string, options: ApplyOptions): Plan;
    /** Send a plan, keeping the device reachable or restoring it. */
    abstract apply(device: Device, network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void>;
    /** Whether a command only reads, so `circuit exec` may send it. Anything not known to only read is refused. */
    abstract readOnly(command: string): boolean;
    /** Log in for commands that only read, over SSH or the console, as the platform's read does. */
    abstract session(device: Device, options?: ReadOptions): Promise<ReadSession>;
    /** A command's output as `exec` prints it: the stored credentials a read hides, such as reversible ciphers, hidden too. Absent on a platform whose output holds none. */
    scrubOutput?(text: string): string;
    /** Each BGP neighbor in the config, in its order, with its live session. Absent on a platform `circuit bgp` doesn't support yet. */
    bgpSessions?(device: Device, session: ReadSession): Promise<BgpSession[]>;
    /** The device's BGP log lines from the last `minutes`, by the device's own clock. */
    bgpLog?(session: ReadSession, minutes: number): Promise<BgpLogLine[]>;
    /** Open again these sessions, each closed on its prefix limit, as `bgpSessions` read them. Only a session still closed on its limit is touched. */
    bgpClearLimit?(session: ReadSession, sessions: readonly BgpSession[]): Promise<void>;
    /** Checks that the device is healthy after an apply, not only that it took the commands. Called before the plan is sent, to read what the checks compare against; the CLI runs them after the apply. Absent on a platform with no checks yet. */
    health?(device: Device, plan: Plan, options?: HealthOptions): Promise<HealthCheck>;
}
