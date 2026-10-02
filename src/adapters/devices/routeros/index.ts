// RouterOS 7: logging in, reading, the fields it cannot express, and sending a plan.
//
// The platform applies every command the moment it arrives and has no candidate configuration, so a run is guarded three ways. Every command is first compiled on the device without running, so a syntax error or an unknown property costs nothing. A backup is saved and a scheduler armed to restore it, and the run must log in again in a fresh session before the scheduler is removed. A command the device refuses restores the backup at once, rather than leaving the device half applied.

import type { Client } from "ssh2";
import { familyOf } from "../../../core/addr";
import { resolve, substitute } from "../../../core/secrets";
import type { Device, Family } from "../../../schema";
import { connect, exec, upload } from "../../../transport/ssh";
import type { ApplyOptions, DeviceAdapter, Plan } from "../types";
import { INSTALL_CERTIFICATE, plan } from "./plan";
import { render } from "./render";

/** The major version this adapter renders for. Version 6 has a different BGP and filter language altogether. */
export const SUPPORTED_MAJOR = 7;

export async function login(device: Device): Promise<Client> {
    const user = device.users?.[device.connection.user];
    if (!user) throw new Error(`${device.name}: connection user ${device.connection.user} is not one of its users`);

    return connect({
        host: device.connection.host,
        port: device.connection.port,
        user: device.connection.user,
        password: resolve(user.password),
    });
}

/** Refuse a device on a version this adapter does not render for, before anything is read or sent. */
export async function checkVersion(client: Client, device: Device): Promise<void> {
    const version = (await exec(client, ":put [/system resource get version]")).trim();
    const major = Number(version.split(".")[0]);

    if (major !== SUPPORTED_MAJOR) {
        throw new Error(`${device.name} runs RouterOS ${version}; this adapter renders for version ${SUPPORTED_MAJOR}`);
    }
}

/** Both dumps stamp the time they were taken. Without the stamp, an unchanged device reads the same twice. */
const EXPORT_TIMESTAMP = /^# \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} by RouterOS/m;

const withoutTimestamp = (text: string) => text.replace(/\r/g, "").replace(EXPORT_TIMESTAMP, "# by RouterOS");

/** Lists certificates in the form the renderer writes them, since an export does not include them. One line, because a script sent over exec runs as one. */
const LIST_CERTIFICATES = [
    ":foreach c in=[/certificate find] do={",
    ':local key "no";',
    ':if ([/certificate get $c private-key]) do={ :set key "yes" };',
    ':put ("add fingerprint=" . [/certificate get $c fingerprint] . " name=" . [/certificate get $c name] . " private-key=" . $key)',
    "}",
].join(" ");

/**
 * What the device runs: its export, its users, and its certificates. Secrets are not part of an export.
 */
export async function read(device: Device): Promise<string> {
    const client = await login(device);

    try {
        await checkVersion(client, device);

        const config = await exec(client, "/export", 300_000);
        const users = await exec(client, "/user export");
        const certificates = (await exec(client, LIST_CERTIFICATES)).trim();

        const listed = certificates.split("\n").every((line) => line.trim().startsWith("add fingerprint="));
        if (certificates && !listed) {
            throw new Error(`${device.name}: certificates could not be listed: ${certificates.slice(0, 120)}`);
        }

        // The user dump repeats the export's header; only its menu is kept.
        const userMenu = users.slice(users.indexOf("\n/")).trim();
        const certificateMenu = certificates ? `/certificate\n${certificates}` : "";
        const text = [config.trim(), userMenu, certificateMenu].filter(Boolean).join("\n");
        return withoutTimestamp(text) + "\n";
    } finally {
        client.end();
    }
}

export function unsupported(device: Device): string[] {
    const found: string[] = [];

    for (const [name, port] of Object.entries(device.ports ?? {})) {
        if (!port) continue;

        if (port.speed) found.push(`ports.${name}.speed, the platform names a speed by medium`);

        const thresholds = Object.values(port.storm_control ?? {});
        const percents = new Set(thresholds.map((threshold) => ("percent" in threshold ? threshold.percent : undefined)));

        if (thresholds.some((threshold) => "pps" in threshold)) {
            found.push(`ports.${name}.storm_control in pps, the platform takes percent`);
        } else if (percents.size > 1) {
            found.push(`ports.${name}.storm_control with a different percent per kind, the platform takes one`);
        }
    }

    const bgp = device.routing?.bgp;

    for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
        const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;
        const families = neighbor.families ?? group?.families ?? [familyOf(neighbor.address)];

        if (families.length > 1) found.push(`routing.bgp.neighbors.${name}.families, one family per session`);
    }

    const management = device.management;

    if (management?.console) found.push("management.console, the console uses the device's users");
    if (management?.privilege_password) found.push("management.privilege_password, the platform has no privileged mode");

    if (management?.ssh?.auth_timeout || management?.ssh?.auth_retries) {
        found.push("management.ssh.auth_timeout and auth_retries");
    }

    for (const [name, user] of Object.entries(management?.snmp?.users ?? {})) {
        if (user.auth !== "sha1") {
            found.push(`management.snmp.users.${name}.auth ${user.auth}, the platform authenticates with SHA1 or MD5`);
        }
    }

    if (device.system?.transceiver_monitoring === false) found.push("system.transceiver_monitoring false, it is always on");
    if (device.flow_export?.protocol === "sflow") found.push("flow_export.protocol sflow, the platform exports NetFlow and IPFIX");

    return found;
}

const ROLLBACK_SCHEDULER = "apply-rollback";

/** Escape a command so it can sit inside a quoted string on the device. */
const escapeForString = (text: string) => text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");

/** Compile a command on the device without running it. Returns why it was refused, or undefined. */
async function refusal(client: Client, command: string): Promise<string | undefined> {
    const compiled = (await exec(client, `:put [:parse "${escapeForString(command)}"]`)).trim();
    const refused = !compiled.startsWith("(") || /syntax error|bad parameter|no such|expected/.test(compiled);
    return refused ? compiled.slice(0, 200) : undefined;
}

/** Upload a certificate and its key, import both under one name, and delete the files. */
async function installCertificate(client: Client, device: Device, name: string): Promise<void> {
    const certificate = device.certificates?.[name];
    if (!certificate) throw new Error(`certificate ${name} is not declared`);

    await upload(client, `${name}.crt`, certificate.certificate);
    await exec(client, `/certificate import file-name=${name}.crt name=${name} passphrase=""`);

    if (certificate.private_key) {
        const privateKey = Buffer.from(resolve(certificate.private_key), "base64").toString("utf8");
        await upload(client, `${name}.key`, privateKey);
        await exec(client, `/certificate import file-name=${name}.key name=${name} passphrase=""`);
    }

    await exec(client, `/file remove [find name="${name}.crt" or name="${name}.key"]`);
}

export async function apply(device: Device, _network: readonly Device[], changes: Plan, options: ApplyOptions): Promise<void> {
    const client = await login(device);
    await checkVersion(client, device);

    const commands = changes.steps.flatMap((step) => step.send.map((command) => ({ title: step.title, command })));

    for (const { title, command } of commands) {
        if (command.startsWith(INSTALL_CERTIFICATE)) continue;

        const reason = await refusal(client, substitute(command));
        if (reason) {
            client.end();
            throw new Error(`${title}: the device will not parse ${command.slice(0, 200)}\n    ${reason}`);
        }
    }

    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const backup = `pre-apply-${stamp}`;

    // `interval` counts from now; `start-time=startup` would count from boot.
    const armRollback = [
        `/system scheduler add name="${ROLLBACK_SCHEDULER}"`,
        `interval=${options.rollback}m`,
        `on-event="/system backup load name=${backup} password=\\"\\""`,
        "policy=read,write,policy,test,reboot,ftp",
    ].join(" ");

    try {
        console.log(`  saving ${backup}, arming a ${options.rollback} minute rollback`);

        await exec(client, `/system backup save name=${backup} dont-encrypt=yes`, 120_000);
        await exec(client, `/system scheduler remove [find name="${ROLLBACK_SCHEDULER}"]`);
        await exec(client, armRollback);

        for (const { title, command } of commands) {
            if (command.startsWith(INSTALL_CERTIFICATE)) {
                const certificateName = command.slice(INSTALL_CERTIFICATE.length).trim();
                await installCertificate(client, device, certificateName);
                continue;
            }

            const answer = (await exec(client, substitute(command), 120_000)).trim();
            if (answer) throw new Error(`${title}: ${command.slice(0, 160)}\n    device said: ${answer.slice(0, 300)}`);
        }
    } catch (error) {
        console.log(`  FAILED: ${(error as Error).message}`);
        console.log(`  restoring ${backup} now; the rollback stays armed in case this does not get through`);

        await exec(client, `/system backup load name=${backup} password=""`, 30_000).catch(() => undefined);
        client.end();

        throw new Error("apply failed and the backup is being restored");
    }

    client.end();

    // A fresh session is the proof that access survived. Only then is the rollback removed, with the backup, which holds every credential.
    const proof = await login(device).catch(() => undefined);
    if (!proof) throw new Error(`could not log in again; the device restores ${backup} within ${options.rollback} minutes`);

    await exec(proof, `/system scheduler remove [find name="${ROLLBACK_SCHEDULER}"]`);
    await exec(proof, `/file remove [find name="${backup}.backup"]`);
    proof.end();
    console.log("  logged in again, rollback disarmed");
}

/** Replace a list's entries in batches, so each command stays a sane length. */
export async function fill(device: Device, _network: readonly Device[], set: string, family: Family, prefixes: string[]): Promise<void> {
    const menu = family === "ipv4" ? "/ip firewall address-list" : "/ipv6 firewall address-list";
    const batchSize = 60;
    const client = await login(device);

    try {
        await exec(client, `${menu} remove [find list="${set}" and !dynamic]`);

        for (let start = 0; start < prefixes.length; start += batchSize) {
            const batch = prefixes.slice(start, start + batchSize).map((prefix) => `${menu} add list="${set}" address=${prefix}`);

            const answer = (await exec(client, batch.join("; "), 90_000)).trim();
            if (answer) throw new Error(`${set}: ${answer.slice(0, 200)}`);
        }

        const count = (await exec(client, `:put [:len [${menu} find list="${set}"]]`)).trim();
        console.log(`  ${set}: ${count} entries on the device`);
    } finally {
        client.end();
    }
}

export const routeros: DeviceAdapter = {
    extension: ".rsc",
    unsupported,
    render,
    read,
    plan,
    apply,
    fill,
};
