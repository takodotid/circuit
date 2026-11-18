import type { IP, Named, Secret, Severity } from "./common";
import type { StaticRoute } from "./routing";
import type { TimeZone } from "./time-zones";

/** A software release channel, with RouterOS's names. `long-term` changes least. `development` is the newest and least tested. */
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
     * Public keys that can log in over SSH, as well as the password. Write each as the one line `ssh-keygen` writes in the `.pub` file, such as `ssh-ed25519 AAAAC3Nza... alice@laptop`. Never a private key. Circuit also logs in with one of these keys if it finds the private key in an SSH agent (1Password's or the system's) or in `~/.ssh/` on your computer. Otherwise it uses the password.
     */
    ssh_keys?: readonly SshPublicKey[];
};

/** A TACACS+ server (RFC 8907). */
export type TacacsServer = {
    address: IP;
    /** The key the device and the server share. */
    secret_key: Secret;
    /** The device's own address it sends from. On FortiOS, every server's is the same, on an interface of the VDOM `root`. */
    source_address?: IP;
};

/** A RADIUS server (RFC 2865, RFC 2866). */
export type RadiusServer = TacacsServer & {
    /** The UDP port for logins. 1812 when absent. On FortiOS, every server's is the same. */
    auth_port?: number;
    /** The UDP port for accounting. 1813 when absent. */
    acct_port?: number;
};

/**
 * Logins checked with TACACS+ or RADIUS servers. A name in `system.users` logs in on the device first. Any other name is checked with the servers, in order: the next one is asked only when one does not answer. Accounting goes to the same servers.
 */
export type Aaa = {
    /** TACACS+ servers. Not with `radius`. */
    tacacs?: readonly TacacsServer[];
    /** RADIUS servers. Not with `tacacs`. */
    radius?: readonly RadiusServer[];
    /** The role of every user a server accepts. */
    remote_role: User["role"];
    /** What the device reports to the servers: each `login` and logout, and each `command` typed. Nothing when absent. */
    accounting_events?: readonly ("login" | "command")[];
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
    /** The certificate, as a PEM file (`.pem` or `.crt`), with the path from the project root. It is public, so keep it in the repository. */
    certificate_file: string;
    /** Its private key. Use `secretFile` for a PEM file, or `secret` for the PEM base64-encoded as one line. A certificate the device only trusts, such as a CA, has no private key. */
    private_key?: Secret;
};

/**
 * Virtual domains (VDOMs), on FortiOS. They keep the device's own traffic apart from the traffic it routes. Everything is in `root` when absent.
 *
 * Turn on multi-VDOM mode by hand, not with a plan. It moves the whole configuration into `root` and ends every session.
 */
export type Vdoms<I extends string> = {
    /** A VDOM for the device's own traffic. FortiGuard, NTP, DNS, and logging leave from it, by its own routes, so they never follow the default route of the routed traffic. Everything not listed here stays in `root`. */
    management: {
        /** Its name, such as `mgmt`. Not `root`. */
        name: string;
        /** The device's ports and interfaces in this VDOM. A LAG's member ports go with the LAG. */
        interfaces: readonly I[];
        /** Its static routes, such as its own default route. */
        static_routes?: readonly StaticRoute<I, never, never>[];
    };
};

/** Device-wide settings: the box itself. `U` is the device's user names, `C` its certificate names, `I` its ports and interfaces. */
export type System<U extends string, C extends string, I extends string> = {
    /** The IANA time zone, for example `Asia/Jakarta`. The editor suggests every name. UTC when absent. */
    timezone?: TimeZone;
    /** Shown at login. */
    banner?: string;
    /** The release channel the device updates from. `stable` when absent. */
    release_channel?: ReleaseChannel;
    /** How the device's own IP stack behaves. */
    ip_stack?: {
        /** Send ICMP redirects. Off when absent. */
        icmp_redirects?: boolean;
        /** Answer a TCP SYN flood with SYN cookies. Off when absent. */
        syn_cookies?: boolean;
    };
    /** Alarms to raise at a different severity than the platform's default. Each key is the alarm's name as the platform spells it, such as `hwOpticalUnAuthorized` on VRP. */
    alarms?: Record<
        string,
        {
            /** The severity it is raised at. */
            severity: AlarmSeverity;
        }
    >;
    /** The DNS resolvers the device uses. To answer DNS queries from others, see `services.dns_server`. */
    dns?: {
        /** Resolvers, in order of preference. */
        servers: readonly IP[];
    };
    /** How the device keeps time. To answer time queries from others, see `services.ntp_server`. */
    ntp?: {
        /** Time sources, by address (alone or with its length) or name, in order of preference. */
        servers: readonly string[];
    };
    /** Log messages kept on the device itself. To send them to collectors, see `monitoring.syslog`. */
    logging?: {
        /** Logs kept on the device's own storage, from `level` up. */
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
    /** Logins, keyed by user name. Circuit removes users not listed here. */
    users?: Named<U, User>;
    /** Logins checked with TACACS+ or RADIUS servers, for names not in `users`. */
    aaa?: Aaa;
    /** Certificates the device presents or trusts, keyed by name. `management.https` and `management.api_tls` use one by name. */
    certificates?: Named<C, Certificate>;
    /** Virtual domains, on FortiOS only. Use them for a management VDOM apart from the routed traffic. */
    vdoms?: Vdoms<I>;
};
