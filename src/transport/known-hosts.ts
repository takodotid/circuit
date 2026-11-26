// Circuit checks each device's SSH host key as OpenSSH's `StrictHostKeyChecking accept-new` does. The first key a host shows is added to the user's known_hosts. A later key that matches none known for the host is refused before any password or key is sent. The file format is sshd(8)'s SSH_KNOWN_HOSTS FILE FORMAT.

import { createHash, createHmac } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ServerHostKeyAlgorithm } from "ssh2";

/** A key line of a known_hosts file whose host patterns match the host. */
type Entry = { file: string; line: number; type: string; key: Buffer; revoked: boolean };

/** How one login checks the device's host key. */
export type HostKeyCheck = {
    /** The host key algorithms to offer: only those of the keys known for the host, so the device shows one of them. Undefined leaves ssh2's own. */
    algorithms: ServerHostKeyAlgorithm[] | undefined;
    /** Whether the key the device shows, in SSH's wire format, may log in. A new host's key is added to the user's file. ssh2 calls it before it sends any password or key. */
    verify: (key: Buffer) => boolean;
    /** The error to give for one ssh2 gave: why `verify` refused, or why the device offered no host key type known for it. Any other error as it is. */
    explain: (error: Error) => Error;
};

export class KnownHosts {
    /** The system's file, which Circuit reads but never writes. */
    static readonly SYSTEM_FILE = "/etc/ssh/ssh_known_hosts";

    /** The `level` of an error that refuses a host key, as ssh2 gives its errors one, so the login is not tried again. */
    static readonly LEVEL = "host-key";

    /** The port a known_hosts name leaves out. Any other is written `[host]:port`. */
    private static readonly PORT = 22;

    /** The bytes of the length before a string in SSH's wire format. */
    private static readonly LENGTH_BYTES = 4;

    private static readonly FOLDER_MODE = 0o700;
    private static readonly FILE_MODE = 0o600;

    /** A hashed name: `|1|salt|hash`, the hash an HMAC-SHA1 of the name keyed with the salt, both in base64. */
    private static readonly HASHED = /^\|1\|([^|]+)\|([^|]+)$/;

    /** What ssh2 says when the device offers none of the host key algorithms Circuit offered. */
    private static readonly NO_COMMON_TYPE = /no matching host key format/;

    /** Each key type known_hosts holds, and the algorithms that sign with it, in ssh2's order of preference. An `ssh-rsa` key signs with SHA-2 too (RFC 8332). */
    private static readonly ALGORITHMS: Readonly<Record<string, readonly ServerHostKeyAlgorithm[]>> = {
        "ssh-ed25519": ["ssh-ed25519"],
        "ecdsa-sha2-nistp256": ["ecdsa-sha2-nistp256"],
        "ecdsa-sha2-nistp384": ["ecdsa-sha2-nistp384"],
        "ecdsa-sha2-nistp521": ["ecdsa-sha2-nistp521"],
        "ssh-rsa": ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"],
    };

    /** A key type as OpenSSH prints it. */
    private static readonly LABELS: Readonly<Record<string, string>> = {
        "ssh-ed25519": "ED25519",
        "ecdsa-sha2-nistp256": "ECDSA",
        "ecdsa-sha2-nistp384": "ECDSA",
        "ecdsa-sha2-nistp521": "ECDSA",
        "ssh-rsa": "RSA",
        "ssh-dss": "DSA",
    };

    /** The user's file and the system's. A test points them at a file of its own, so it never reads or writes the machine's. */
    static files = (): KnownHosts => new KnownHosts(join(homedir(), ".ssh", "known_hosts"), [KnownHosts.SYSTEM_FILE]);

    constructor(
        /** The user's file, which a new host's key is added to. */
        private readonly file: string,
        /** Files that are only read, such as the system's. */
        private readonly readOnly: readonly string[] = []
    ) {}

    /** The name known_hosts gives a host: the host, or `[host]:port` for a port other than 22. */
    static nameOf(host: string, port: number): string {
        const lower = host.toLowerCase();
        return port === KnownHosts.PORT ? lower : `[${lower}]:${port}`;
    }

    /** A key's fingerprint as OpenSSH prints it: SHA-256 in base64, without padding. */
    static fingerprint(key: Buffer): string {
        return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
    }

    /** The key type a key in SSH's wire format starts with, such as `ssh-ed25519` (RFC 4253, section 6.6). */
    static typeOf(key: Buffer): string {
        const length = key.length >= KnownHosts.LENGTH_BYTES ? key.readUInt32BE(0) : 0;
        return key.subarray(KnownHosts.LENGTH_BYTES, KnownHosts.LENGTH_BYTES + length).toString("latin1");
    }

    /**
     * How a login to `host` checks its key. `allowed` are the host key algorithms the platform takes, and `tell` says a first login.
     *
     * Throws when the host has known keys but none of a type the platform takes, before anything is sent.
     */
    check(host: string, port: number, allowed?: readonly string[], tell?: (message: string) => void): HostKeyCheck {
        const name = KnownHosts.nameOf(host, port);
        const where = port === KnownHosts.PORT ? host : `${host} on port ${port}`;
        const entries = this.entries(name);
        const known = entries.filter((entry) => !entry.revoked);
        const algorithms = KnownHosts.offered(known.length ? new Set(known.map((entry) => entry.type)) : undefined, allowed);

        if (known.length && !algorithms?.length) {
            const types = [...new Set(known.map((entry) => entry.type))].join(", ");
            const takes = allowed ?? Object.values(KnownHosts.ALGORITHMS).flat();
            const scan = `ssh-keyscan${port === KnownHosts.PORT ? "" : ` -p ${port}`} ${host} >> ${KnownHosts.shown(this.file)}`;
            throw KnownHosts.refusal(
                `Circuit can't check the host key of ${where}: ${KnownHosts.lines(known)} holds its ${types} key, and Circuit logs in to it only with a host key of type ${takes.join(", ")}. If you trust the device, add its other keys with \`${scan}\`, then connect again.`
            );
        }

        let refused: Error | undefined;
        const verify = (key: Buffer): boolean => {
            const type = KnownHosts.typeOf(key);
            const described = `${KnownHosts.LABELS[type] ?? type} key ${KnownHosts.fingerprint(key)}`;
            const shows = `the ${described}`;

            const revoked = entries.find((entry) => entry.revoked && entry.key.equals(key));
            if (revoked) {
                refused = KnownHosts.refusal(
                    `${where} shows ${shows}, which ${KnownHosts.lines([revoked])} marks @revoked, so Circuit sent nothing. Give the device a new host key.`
                );
                return false;
            }

            if (!known.length) {
                tell?.(this.add(name, key, `First login to ${where}: its ${described}`));
                return true;
            }
            if (known.some((entry) => entry.key.equals(key))) return true;

            const sameType = known.filter((entry) => entry.type === type);
            const held = sameType.length ? sameType : known;
            const holds = held.map((entry) => `${KnownHosts.lines([entry])} holds ${KnownHosts.fingerprint(entry.key)}`).join(", and ");
            refused = KnownHosts.refusal(
                `The host key of ${where} changed: it shows ${shows}, but ${holds}. Someone may be in the middle, posing as the device to take the password, so Circuit sent nothing. If the device was replaced or reinstalled, remove the old key with ${KnownHosts.removal(held, name)}, then connect again.`
            );
            return false;
        };

        const explain = (error: Error): Error => {
            if (refused) return refused;
            if (!known.length || !KnownHosts.NO_COMMON_TYPE.test(error.message)) return error;

            const types = [...new Set(known.map((entry) => KnownHosts.LABELS[entry.type] ?? entry.type))].join(", ");
            return KnownHosts.refusal(
                `${where} offers none of the host key types ${KnownHosts.lines(known)} holds for it (${types}): it may be another device, or someone in the middle, so Circuit sent nothing. If the device was replaced or reinstalled, remove the old key with ${KnownHosts.removal(known, name)}, then connect again.`
            );
        };

        return { algorithms, verify, explain };
    }

    /** The key lines of every file whose host patterns match `name`. A `@cert-authority` line is left out: Circuit doesn't check host certificates. */
    private entries(name: string): Entry[] {
        return [this.file, ...this.readOnly].flatMap((file) => {
            if (!existsSync(file)) return [];

            return readFileSync(file, "utf8")
                .split("\n")
                .flatMap((text, index) => {
                    const fields = text.trim().split(/\s+/);
                    if (!fields[0] || fields[0].startsWith("#")) return [];

                    const marker = fields[0].startsWith("@") ? fields.shift() : undefined;
                    const [hosts, type, key] = fields;
                    if (marker && marker !== "@revoked") return [];
                    if (!hosts || !type || !key || !KnownHosts.matches(hosts, name)) return [];

                    return [{ file, line: index + 1, type, key: Buffer.from(key, "base64"), revoked: marker === "@revoked" }];
                });
        });
    }

    /** Whether a line's host field takes `name`: one hashed name, or patterns with `*`, `?`, and `!` to leave a host out. */
    static matches(hosts: string, name: string): boolean {
        const hashed = KnownHosts.HASHED.exec(hosts);
        if (hashed) {
            const hash = createHmac("sha1", Buffer.from(hashed[1]!, "base64")).update(name).digest("base64");
            return hash === hashed[2];
        }

        let matched = false;
        for (const pattern of hosts.split(",")) {
            const negated = pattern.startsWith("!");
            const glob = (negated ? pattern.slice(1) : pattern)
                .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, ".*")
                .replace(/\?/g, ".");
            if (!new RegExp(`^${glob}$`, "i").test(name)) continue;
            if (negated) return false;
            matched = true;
        }

        return matched;
    }

    /** The algorithms to offer for the key types known for a host, or all for a host not known, narrowed to those the platform takes. */
    private static offered(
        types: ReadonlySet<string> | undefined,
        allowed: readonly string[] | undefined
    ): ServerHostKeyAlgorithm[] | undefined {
        if (!types && !allowed) return undefined;

        return Object.entries(KnownHosts.ALGORITHMS)
            .filter(([type]) => !types || types.has(type))
            .flatMap(([, algorithms]) => algorithms)
            .filter((algorithm) => !allowed || allowed.includes(algorithm));
    }

    /** Adds a new host's key to the user's file, creating it private as OpenSSH does, and says so. A file that can't be written is said, and the login goes on, as with OpenSSH. */
    private add(name: string, key: Buffer, first: string): string {
        try {
            mkdirSync(dirname(this.file), { recursive: true, mode: KnownHosts.FOLDER_MODE });
            const text = existsSync(this.file) ? readFileSync(this.file, "utf8") : "";
            const start = text && !text.endsWith("\n") ? "\n" : "";
            appendFileSync(this.file, `${start}${name} ${KnownHosts.typeOf(key)} ${key.toString("base64")}\n`, {
                mode: KnownHosts.FILE_MODE,
            });
            return `${first} is now in ${KnownHosts.shown(this.file)}.`;
        } catch (error) {
            return `${first} could not be added to ${KnownHosts.shown(this.file)} (${(error as Error).message}), so the next login can't check it.`;
        }
    }

    /** Where each entry is, such as `~/.ssh/known_hosts line 3`. */
    private static lines(entries: readonly Entry[]): string {
        return [...new Set(entries.map((entry) => `${KnownHosts.shown(entry.file)} line ${entry.line}`))].join(" and ");
    }

    /** The command that removes the host's keys from each file that holds them, as OpenSSH prints it. */
    private static removal(entries: readonly Entry[], name: string): string {
        const quoted = name.startsWith("[") ? `'${name}'` : name;
        return [...new Set(entries.map((entry) => entry.file))]
            .map((file) => `\`ssh-keygen -f ${KnownHosts.shown(file)} -R ${quoted}\``)
            .join(" and ");
    }

    /** A path under the home folder as `~/...`. */
    private static shown(path: string): string {
        const home = homedir();
        return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
    }

    private static refusal(message: string): Error {
        return Object.assign(new Error(message), { level: KnownHosts.LEVEL });
    }
}
