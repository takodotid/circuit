// Prometheus targets for snmp_exporter, in its file-based discovery format, and the `auths` section of its config: one auth per device, named after it, so each device is asked with its own credentials.
//
// The auths hold no secret. A password is written as `${NAME}`, the name of its secret, and snmp_exporter reads it from its environment when started with `--config.expand-environment-variables`.

import type { Network } from "../../core/define";
import type { Device, Secret } from "../../schema";

export type PrometheusTarget = { targets: string[]; labels: Record<string, string> };

/** snmp_exporter's names for the algorithms. */
const AUTH = { sha1: "SHA", sha256: "SHA256" } as const;
const PRIVACY = { aes128: "AES", des: "DES" } as const;

/** The targets, and the devices left out because their config turns SNMP off. */
export function prometheusTargets(network: Network): { targets: PrometheusTarget[]; withoutSnmp: Device[] } {
    return {
        targets: network.devices
            .filter((device) => device.management?.snmp)
            .map((device) => ({
                targets: [device.connection.host],
                // `__param_auth` picks the device's own auth in snmp_exporter.
                labels: { device: device.name, platform: device.platform, model: device.model, __param_auth: device.name },
            })),
        withoutSnmp: network.devices.filter((device) => !device.management?.snmp),
    };
}

/** A password as snmp_exporter reads it from its environment, or a note when the secret is a file, which it cannot read. */
function fromEnvironment(secret: Secret, notes: string[], where: string): string {
    if ("secret" in secret) return `\${${secret.secret}}`;

    notes.push(`${where} is read from a file; write its value in place of FILL_IN`);
    return "FILL_IN";
}

/** The `auths` section, as YAML, and what the operator must still fill in by hand. */
export function snmpExporterAuths(network: Network): { yaml: string; notes: string[] } {
    const notes: string[] = [];
    const lines = [
        "# Written by `circuit prometheus --auths`. Load it beside snmp.yml, with --config.expand-environment-variables.",
        "auths:",
    ];

    for (const device of network.devices) {
        const snmp = device.management?.snmp;
        if (!snmp) continue;

        const [name, user] = Object.entries(snmp.users ?? {})[0] ?? [];
        lines.push(`  ${device.name}:`);

        if (name && user) {
            lines.push(
                "    version: 3",
                `    username: ${name}`,
                "    security_level: authPriv",
                `    password: ${fromEnvironment(user.auth_password, notes, `${device.name}'s SNMP password`)}`,
                `    auth_protocol: ${AUTH[user.auth]}`,
                `    priv_protocol: ${PRIVACY[user.privacy]}`,
                `    priv_password: ${fromEnvironment(user.privacy_password, notes, `${device.name}'s SNMP privacy password`)}`
            );
        } else {
            // snmp_exporter reads no community from the environment, and Circuit never writes a secret's value.
            lines.push("    version: 2", "    community: FILL_IN");
            notes.push(
                `${device.name} has only an SNMP version 2c community, which snmp_exporter cannot read from its environment; write it in place of FILL_IN, or give the device a version 3 user`
            );
        }
    }

    return { yaml: lines.join("\n") + "\n", notes };
}
