// Keeps LibreNMS in step with the config: every device Circuit manages is monitored there, polled with the SNMP credentials its config gives it. A device LibreNMS holds that the config does not is reported, never deleted.

import type { Network } from "../../core/define";
import { resolve } from "../../core/secrets";
import type { Device } from "../../schema";

/** What `librenms` would do. */
export type LibreNmsPlan = {
    /** Devices to add. */
    additions: Device[];
    /** Devices that cannot be added: their config turns SNMP off. */
    withoutSnmp: Device[];
    /** Hostnames LibreNMS holds that no device in the config has. */
    unknown: string[];
};

/** LibreNMS's names for the algorithms. */
const AUTH = { sha1: "SHA", sha256: "SHA-256" } as const;
const PRIVACY = { aes128: "AES", des: "DES" } as const;

function settingsOf(network: Network) {
    if (!network.librenms) throw new Error("the network has no librenms settings");

    return {
        base: `${network.librenms.url.replace(/\/+$/, "")}/api/v0`,
        // The header every version of API v0 accepts.
        headers: { "X-Auth-Token": resolve(network.librenms.api_token), "Content-Type": "application/json" },
    };
}

/** How LibreNMS polls a device: its first SNMP version 3 user, or else its version 2c community. */
function credentials(device: Device): Record<string, string> | undefined {
    const snmp = device.management?.snmp;
    const [name, user] = Object.entries(snmp?.users ?? {})[0] ?? [];

    if (name && user) {
        return {
            snmpver: "v3",
            authlevel: "authPriv",
            authname: name,
            authpass: resolve(user.auth_password),
            authalgo: AUTH[user.auth],
            cryptopass: resolve(user.privacy_password),
            cryptoalgo: PRIVACY[user.privacy],
        };
    }

    if (snmp?.community) return { snmpver: "v2c", community: resolve(snmp.community) };
    return undefined;
}

/** Compare the config with what LibreNMS monitors. A device is known to LibreNMS by its management address. */
export async function planLibreNms(network: Network): Promise<LibreNmsPlan> {
    const { base, headers } = settingsOf(network);

    const response = await fetch(`${base}/devices?type=all`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`LibreNMS answered ${response.status} to the device list`);

    const monitored = new Set(((await response.json()) as { devices: { hostname: string }[] }).devices.map((device) => device.hostname));
    const ours = new Set(network.devices.map((device) => device.connection.host));
    const missing = network.devices.filter((device) => !monitored.has(device.connection.host));

    return {
        additions: missing.filter((device) => device.management?.snmp),
        withoutSnmp: missing.filter((device) => !device.management?.snmp),
        unknown: [...monitored].filter((hostname) => !ours.has(hostname)).sort(),
    };
}

/** Add each device, named after its `name` and polled with the credentials from its config. */
export async function sendLibreNms(network: Network, additions: readonly Device[]): Promise<void> {
    const { base, headers } = settingsOf(network);

    for (const device of additions) {
        const body = { hostname: device.connection.host, display_template: device.name, ...credentials(device) };
        const response = await fetch(`${base}/devices`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        });
        const answer = (await response.json().catch(() => ({}))) as { status?: string; message?: string };

        if (!response.ok || answer.status !== "ok") {
            throw new Error(`${device.name}: LibreNMS refused it: ${answer.message ?? response.status}`);
        }

        console.log(`  ${device.name}: ${answer.message}`);
    }
}
