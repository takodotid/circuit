// Prometheus targets for snmp_exporter, in its file-based discovery format, and the `auths` section of its config: one auth per device, named after it, so each device is asked with its own credentials.
//
// The auths hold no secret. A password is written as `${NAME}`, the name of its secret, and snmp_exporter reads it from its environment when started with `--config.expand-environment-variables`.

import { Document } from "yaml";
import type { Network } from "../core/define";
import type { Device, Secret } from "../schema";

export type PrometheusTarget = { targets: string[]; labels: Record<string, string> };

/** One auth in snmp_exporter's config. */
type SnmpExporterAuth =
    | {
          version: 3;
          username: string;
          security_level: "authPriv";
          password: string;
          auth_protocol: string;
          priv_protocol: string;
          priv_password: string;
      }
    | { version: 2; community: string };

export class Prometheus {
    /** snmp_exporter's names for the algorithms. */
    private static readonly AUTH = { sha1: "SHA", sha256: "SHA256" } as const;
    private static readonly PRIVACY = { aes128: "AES", des: "DES" } as const;

    private static readonly AUTHS_HEADER =
        " Written by `circuit prometheus --auths`. Load it beside snmp.yml, with --config.expand-environment-variables.";

    /** The targets, and the devices left out because their config turns SNMP off. */
    static targets(network: Network): { targets: PrometheusTarget[]; withoutSnmp: Device[] } {
        return {
            targets: network.devices
                .filter((device) => device.management?.snmp && device.connection.host)
                .map((device) => ({
                    targets: [device.connection.host!],
                    // `__param_auth` picks the device's own auth in snmp_exporter.
                    labels: { device: device.name, platform: device.platform, model: device.model, __param_auth: device.name },
                })),
            withoutSnmp: network.devices.filter((device) => !device.management?.snmp),
        };
    }

    /** The `auths` section, as YAML, and what the operator must still fill in by hand. */
    static snmpExporterAuths(network: Network): { yaml: string; notes: string[] } {
        const notes: string[] = [];
        const auths: Record<string, SnmpExporterAuth> = {};

        for (const device of network.devices) {
            const snmp = device.management?.snmp;
            if (!snmp) continue;

            const [name, user] = Object.entries(snmp.users ?? {})[0] ?? [];

            if (name && user) {
                auths[device.name] = {
                    version: 3,
                    username: name,
                    security_level: "authPriv",
                    password: Prometheus.fromEnvironment(user.auth_password, notes, `${device.name}'s SNMP password`),
                    auth_protocol: Prometheus.AUTH[user.auth],
                    priv_protocol: Prometheus.PRIVACY[user.privacy],
                    priv_password: Prometheus.fromEnvironment(user.privacy_password, notes, `${device.name}'s SNMP privacy password`),
                };
            } else {
                // snmp_exporter reads no community from the environment, and Circuit never writes a secret's value.
                auths[device.name] = { version: 2, community: "FILL_IN" };
                notes.push(
                    `${device.name} has only an SNMP version 2c community, which snmp_exporter cannot read from its environment; write it in place of FILL_IN, or give the device a version 3 user`
                );
            }
        }

        // YAML 1.1 rules quote words such as `yes` and `on`, which older YAML readers take as true.
        const document = new Document({ auths }, { version: "1.1" });
        document.contents!.commentBefore = Prometheus.AUTHS_HEADER;

        return { yaml: document.toString({ indent: 2 }), notes };
    }

    /** A password as snmp_exporter reads it from its environment, or a note when the secret is a file, which it cannot read. */
    private static fromEnvironment(secret: Secret, notes: string[], where: string): string {
        if ("secret" in secret) return `\${${secret.secret}}`;

        notes.push(`${where} is read from a file; write its value in place of FILL_IN`);
        return "FILL_IN";
    }
}
