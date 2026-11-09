// `circuit sync prometheus`: writes two files in the project, from each device's `monitoring.snmp`. The targets file is what Prometheus reads with `file_sd_configs`; the auths file is the `auths` part of snmp_exporter's config, one auth per device, named after it.
//
// Neither file holds a secret. A password is written `${NAME}`, the name of its secret, and snmp_exporter reads its value from its environment when started with `--config.expand-environment-variables`. So both files are committed and reviewed like any other change.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Device, Secret } from "../model";
import type { SyncChange, SyncNetwork, SyncPlan, SyncTarget } from "./sync";

/** One entry of the targets file. */
export type PrometheusTarget = { targets: string[]; labels: Record<string, string> };

/** One file to write: its path in the project and what goes in it. */
type File = { path: string; text: string };

/** What `circuit sync prometheus` would do. */
export type PrometheusPlan = SyncPlan & { writes: File[] };

export class Prometheus implements SyncTarget<PrometheusPlan> {
    /** snmp_exporter's names for the algorithms. */
    private static readonly AUTH = { sha1: "SHA", sha256: "SHA256" } as const;
    private static readonly PRIVACY = { aes128: "AES", des: "DES" } as const;

    private static readonly AUTHS_HEADER =
        "# Written by `circuit sync prometheus`. Load it beside snmp.yml, with --config.expand-environment-variables.";

    /** Words YAML 1.1 reads as true, false or nothing, which a name must not be written as plainly. */
    private static readonly YAML_WORDS = /^(y|yes|n|no|true|false|on|off|null|~)$/i;

    readonly name = "Prometheus";
    readonly heading = "Prometheus";
    readonly where: string;

    private readonly targetsPath: string;
    private readonly authsPath: string | undefined;
    private readonly devices: Device[];

    /** `networks` all name the same files, relative to `root`, the project's folder. */
    constructor(
        private readonly root: string,
        networks: readonly SyncNetwork[]
    ) {
        const settings = networks[0]?.integrations.prometheus;
        if (!settings) throw new Error("No network sets integrations.prometheus.");

        this.targetsPath = settings.targets;
        this.authsPath = settings.auths;
        this.devices = networks.flatMap((network) => [...network.devices]);
        this.where = [settings.targets, settings.auths].filter(Boolean).join(" and ");
    }

    /** Compare the files in the project with what they should say. */
    async plan(): Promise<PrometheusPlan> {
        const leftAlone: string[] = [];
        const wanted: File[] = [{ path: this.targetsPath, text: `${JSON.stringify(this.targets(leftAlone), null, 4)}\n` }];
        if (this.authsPath) wanted.push({ path: this.authsPath, text: this.auths(leftAlone) });

        const writes: File[] = [];
        const changes: SyncChange[] = [];

        for (const file of wanted) {
            const full = join(this.root, file.path);
            const current = existsSync(full) ? readFileSync(full, "utf8").replace(/\r\n/g, "\n") : undefined;
            if (current === file.text) continue;

            writes.push(file);
            changes.push(
                current === undefined
                    ? {
                          sign: "+",
                          what: file.path,
                          details: file.text
                              .trimEnd()
                              .split("\n")
                              .map((line) => `+ ${line}`),
                      }
                    : { sign: "~", what: file.path, details: Prometheus.lineChanges(current, file.text) }
            );
        }

        return { changes, summary: [], leftAlone, writes };
    }

    /** Write each file that differs, its folder made when missing. */
    async send(plan: PrometheusPlan): Promise<void> {
        for (const file of plan.writes) {
            const full = join(this.root, file.path);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, file.text);
        }
    }

    /** One target per device with SNMP and a management address. `__param_auth` picks the device's own auth in snmp_exporter. */
    private targets(leftAlone: string[]): PrometheusTarget[] {
        const targets: PrometheusTarget[] = [];

        for (const device of this.devices) {
            if (!device.monitoring?.snmp) {
                leftAlone.push(`${device.name} has no monitoring.snmp, so Prometheus can't poll it.`);
                continue;
            }
            if (!device.connection.host) {
                leftAlone.push(`${device.name} has no connection.host, so Prometheus has no address to poll.`);
                continue;
            }

            targets.push({
                targets: [device.connection.host],
                labels: { device: device.name, platform: device.platform, model: device.model, __param_auth: device.name },
            });
        }

        return targets;
    }

    /** The `auths` file, as YAML: each device's first SNMP version 3 user, or `FILL_IN` for a community. */
    private auths(leftAlone: string[]): string {
        const lines = [Prometheus.AUTHS_HEADER, "auths:"];
        const scalar = Prometheus.scalar;

        for (const device of this.devices) {
            const snmp = device.monitoring?.snmp;
            if (!snmp || !device.connection.host) continue;

            const [name, user] = Object.entries(snmp.users ?? {})[0] ?? [];
            lines.push(`    ${scalar(device.name)}:`);

            if (name && user) {
                const password = Prometheus.fromEnvironment(user.auth_password, leftAlone, `${device.name}'s SNMP password`);
                const privacy = Prometheus.fromEnvironment(user.privacy_password, leftAlone, `${device.name}'s SNMP privacy password`);
                lines.push(
                    "        version: 3",
                    `        username: ${scalar(name)}`,
                    "        security_level: authPriv",
                    `        password: ${scalar(password)}`,
                    `        auth_protocol: ${Prometheus.AUTH[user.auth]}`,
                    `        priv_protocol: ${Prometheus.PRIVACY[user.privacy]}`,
                    `        priv_password: ${scalar(privacy)}`
                );
                continue;
            }

            // snmp_exporter reads no community from its environment, and Circuit never writes a secret's value.
            lines.push("        version: 2", "        community: FILL_IN");
            leftAlone.push(
                `${device.name} has only an SNMP v2c community, which snmp_exporter can't read from its environment: write it in place of FILL_IN where you deploy the file, or give the device a v3 user.`
            );
        }

        if (lines.length === 2) lines[1] = "auths: {}";
        return `${lines.join("\n")}\n`;
    }

    /** A password as snmp_exporter reads it from its environment, `${NAME}`, or `FILL_IN` for a secret kept in a file, which it can't read. */
    private static fromEnvironment(secret: Secret, leftAlone: string[], where: string): string {
        if ("secret" in secret) return `\${${secret.secret}}`;

        leftAlone.push(
            `${where} is read from a file, which snmp_exporter can't read: write its value in place of FILL_IN where you deploy the file.`
        );
        return "FILL_IN";
    }

    /** A YAML value: plain when it reads back as the same text, quoted otherwise. */
    private static scalar(text: string): string {
        const plain = (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(text) || /^\$\{[A-Za-z0-9_]+\}$/.test(text)) && !Prometheus.YAML_WORDS.test(text);
        return plain ? text : JSON.stringify(text);
    }

    /** The lines removed (`-`) and added (`+`) from `before` to `after`, in order. */
    private static lineChanges(before: string, after: string): string[] {
        const a = before.trimEnd().split("\n");
        const b = after.trimEnd().split("\n");

        // The longest run of lines both keep, counted from the end.
        const kept = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
        for (let i = a.length - 1; i >= 0; i--)
            for (let j = b.length - 1; j >= 0; j--)
                kept[i]![j] = a[i] === b[j] ? kept[i + 1]![j + 1]! + 1 : Math.max(kept[i + 1]![j]!, kept[i]![j + 1]!);

        const lines: string[] = [];
        let [i, j] = [0, 0];
        while (i < a.length || j < b.length) {
            if (i < a.length && j < b.length && a[i] === b[j]) {
                i++;
                j++;
            } else if (i < a.length && (j === b.length || kept[i + 1]![j]! >= kept[i]![j + 1]!)) lines.push(`- ${a[i++]}`);
            else lines.push(`+ ${b[j++]}`);
        }

        return lines;
    }
}
