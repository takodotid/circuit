// The box itself: `system.timezone`, `.banner`, `.release_channel`, `.ip_stack`, `.alarms`, `.dns`, `.ntp`, `.logging`, `.hardware_offload`, `.users`, `.certificates`, `.vdoms`.

import type { IP, Named, Secret, Severity } from "./common";
import type { StaticRoute } from "./routing";
import type { TimeZone } from "./time-zones";

/** A software release track, as RouterOS names them. `long-term` changes least; `development` is the newest and least tested. */
export type ReleaseChannel = "long-term" | "stable" | "testing" | "development";

/** How bad an alarm is, most severe first, as ITU-T X.733 ranks them. */
export type AlarmSeverity = "critical" | "major" | "minor" | "warning";

/** A login on the device. */
export type User = {
    /** What the user may do. */
    role: "admin" | "operator" | "read-only";
    /** The login password. */
    password: Secret;
    /** Who the account is for. */
    description?: string;
    /**
     * Public keys that log in over SSH beside the password, each one line as `ssh-keygen` writes it in the `.pub` file, such as
     * `ssh-ed25519 AAAAC3Nza... alice@laptop`. Never a private key. Circuit logs in with one of them too, when it is in an SSH agent
     * (1Password's, or the system's) or in `~/.ssh/` on the computer it runs on, and with the password otherwise.
     */
    ssh_keys?: readonly SshPublicKey[];
};

/** An OpenSSH public key line: its type, the key, then an optional comment. */
export type SshPublicKey = `${
    | "ssh-ed25519"
    | "ssh-rsa"
    | "ecdsa-sha2-nistp256"
    | "ecdsa-sha2-nistp384"
    | "ecdsa-sha2-nistp521"
    | "sk-ssh-ed25519@openssh.com"
    | "sk-ecdsa-sha2-nistp256@openssh.com"} ${string}`;

/** A certificate the device presents or trusts. */
export type Certificate = {
    /** The certificate, a PEM file (`.pem` or `.crt`): a path from the project root. Public, so it is kept in the repository. */
    certificate_file: string;
    /** Its private key: a PEM file through `secretFile`, or PEM base64-encoded as one line through `secret`. A certificate the device only trusts, such as a CA, has none. */
    private_key?: Secret;
};

/**
 * Virtual domains, on FortiOS: the device's own traffic kept apart from the traffic it routes. Everything is in `root` when absent.
 *
 * Multi-VDOM mode is turned on by hand, not by a plan: it moves the whole configuration into `root` and ends every session.
 */
export type Vdoms<I extends string> = {
    /** A VDOM for the device's own traffic: FortiGuard, NTP, DNS and logging leave from it, by its own routes, so they never follow the routed traffic's default route. Everything not listed here stays in `root`. */
    management: {
        /** Its name, such as `mgmt`. Not `root`. */
        name: string;
        /** Some of the device's ports and interfaces: the ones in it. A LAG's member ports go with the LAG. */
        interfaces: readonly I[];
        /** Its static routes, such as its own default route. */
        static_routes?: readonly StaticRoute<I, never, never>[];
    };
};

/** Device-wide settings: the box itself. `U` is the device's user names, `C` its certificate names, `I` its ports and interfaces. */
export type System<U extends string, C extends string, I extends string> = {
    /** IANA zone, for example `Asia/Jakarta`. The editor suggests every name. UTC when absent. */
    timezone?: TimeZone;
    /** Shown at login. */
    banner?: string;
    /** Software release track the device updates from. `stable` when absent. */
    release_channel?: ReleaseChannel;
    /** Host behaviour of the IP stack. */
    ip_stack?: {
        /** Send ICMP redirects. Off when absent. */
        icmp_redirects?: boolean;
        /** Answer a TCP SYN flood with SYN cookies. Off when absent. */
        syn_cookies?: boolean;
    };
    /** Alarms raised at another severity than the platform's own, keyed by the alarm's name as the platform spells it, such as `hwOpticalUnAuthorized` on VRP. */
    alarms?: Record<
        string,
        {
            /** The severity it is raised at. */
            severity: AlarmSeverity;
        }
    >;
    /** Resolvers the device uses. Answering others is `services.dns_server`. */
    dns?: {
        /** Resolvers, in order of preference. */
        servers: readonly IP[];
    };
    /** How the device keeps time. Answering others is `services.ntp_server`. */
    ntp?: {
        /** Time sources, by address (alone or with its length) or name, in order of preference. */
        servers: readonly string[];
    };
    /** Log messages kept on the device itself. Sending them to collectors is `monitoring.syslog`. */
    logging?: {
        /** Kept on the device's own storage, from `level` up. */
        local?: {
            /** The least severe message kept. */
            level: Severity;
            /** How many rotated files to keep. */
            files?: number;
            /** Lines in each file before it rotates. */
            lines_per_file?: number;
        };
    };
    /** Forward in hardware where the platform can. An interface may override it. */
    hardware_offload?: boolean;
    /** Logins, keyed by user name. Users not listed are removed. */
    users?: Named<U, User>;
    /** Certificates the device presents or trusts, keyed by name. `management.https` and `management.api_tls` name one. */
    certificates?: Named<C, Certificate>;
    /** Virtual domains, on FortiOS only: a management VDOM apart from the routed traffic. */
    vdoms?: Vdoms<I>;
};
