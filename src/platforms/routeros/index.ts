// RouterOS 7: logging in, reading, the fields it cannot express, and sending a plan.
//
// The platform applies every command the moment it arrives and has no candidate configuration, so a run is guarded three ways. Every command is first compiled on the device without running, so a syntax error or an unknown property costs nothing. A backup is saved and a scheduler armed to restore it, and the run must log in again in a fresh session before the scheduler is removed. A command the device refuses restores the backup at once, rather than leaving the device half applied.

import type { Client } from "ssh2";
import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Family } from "../../schema";
import { SerialConsole, type ConsoleDialect, ConsoleShell } from "../../transport/console";
import { Ssh } from "../../transport/ssh";
import { type ApplyOptions, type OsSupport, type Plan, type ReadOptions, type ReadSession, Platform } from "../platform";
import { RouterOsPlan } from "./plan";
import { Catalog } from "../catalog";
import { RouterOsRender } from "./render";

/** Where commands run, one at a time, each returning what it printed: an SSH session, or the console. */
type Session = {
    run(command: string, timeout?: number): Promise<string>;
    /** Write a file to the device. Only SSH can. */
    upload?(path: string, content: string): Promise<void>;
    /** A fresh login, which proves access survived: this session ends and a new SSH session opens, or the console logs out and in again. */
    fresh(): Promise<Session>;
    end(): void;
};

export class RouterOs extends Platform {
    /** How the RouterOS console asks for a login. The flags after the user turn off colours and terminal detection, without which the console redraws every line. */
    static readonly CONSOLE: ConsoleDialect = {
        login: /Login: $/,
        password: /Password: $/,
        prompt: /\] > $/,
        logout: "/quit",
        others: [
            [/-- \[Q quit\|D dump\|(?:C-z pause\|)?down\]$/, "D"],
            [/\[Y\/n\]:? ?$/, "n"],
        ],
        user: (user) => `${user}+cwt`,
    };

    /** The major version this adapter renders for. Version 6 has a different BGP and filter language altogether. */
    private static readonly SUPPORTED_MAJOR = 7;

    /** Both dumps stamp the time they were taken. Without the stamp, an unchanged device reads the same twice. */
    private static readonly EXPORT_TIMESTAMP = /^# \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} by RouterOS/m;

    /** Lists certificates in the form the renderer writes them, since an export does not include them. One line, because a script sent over exec runs as one. */
    private static readonly LIST_CERTIFICATES = [
        ":foreach c in=[/certificate find] do={",
        ':local key "no";',
        ':if ([/certificate get $c private-key]) do={ :set key "yes" };',
        ':put ("add fingerprint=" . [/certificate get $c fingerprint] . " name=" . [/certificate get $c name] . " private-key=" . $key)',
        "}",
    ].join(" ");

    private static readonly ROLLBACK_SCHEDULER = "apply-rollback";

    /** Commands that only read: print, monitor, ping, traceroute, torch, profile, sniffer quick, an AS-path regex test, export, and `:put`, `:foreach` or `:delay` scripts. */
    private static readonly READS =
        /\b(print|monitor|monitor-traffic|ping|traceroute|torch|profile|test-as-path-regexp|export|get|find)\b|\bsniffer quick\b|^:(put|foreach|delay)\b/;

    /** Words that change something, or print secrets. A command with any of them is refused, whatever else it holds. */
    private static readonly WRITES =
        /\b(set|add|remove|reset|reset-counters|enable|disable|unset|move|edit|import|reboot|shutdown|clear|run|upgrade|fetch|save|show-sensitive)\b|\bfile=/;

    /** Flags after the user over SSH: no colours, no terminal detection, 300 columns, so output is plain and lines are not cut. */
    private static readonly PLAIN_OUTPUT = "+ct300w";

    readonly name = "routeros";

    readonly os: OsSupport = {
        name: "MikroTik RouterOS",
        versions: "7",
        provedOn: "CCR2216-1G-12XS-2XQ, RouterOS 7.23",
        checked: true,
    };

    readonly extension = ".rsc";

    override readonly console = true;

    unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type === "bridge") found.push(`interfaces.${name}, a bridge, which only FortiOS builds for now`);
        }

        for (const [name, port] of Object.entries(device.ports ?? {})) {
            if (!port) continue;

            if (port.speed && !RouterOsRender.medium(Catalog.spell(device.platform, device.model, name), port.speed)) {
                found.push(`ports.${name}.speed ${port.speed}, the port has no fixed speed by that name`);
            }

            const thresholds = Object.values(port.storm_control ?? {});
            const percents = new Set(thresholds.map((threshold) => ("percent" in threshold ? threshold.percent : undefined)));

            if (thresholds.some((threshold) => "pps" in threshold)) {
                found.push(`ports.${name}.storm_control in pps, the platform takes percent`);
            } else if (percents.size > 1) {
                found.push(`ports.${name}.storm_control with a different percent per kind, the platform takes one`);
            }
        }

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "lag") continue;

            for (const field of ["storm_control", "stp"] as const) {
                if (iface[field] !== undefined) found.push(`interfaces.${name}.${field}, on a LAG`);
            }
        }

        const bgp = device.routing?.bgp;

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;
            const families = neighbor.families ?? group?.families ?? [Address.family(neighbor.address)];

            if (families.length > 1) found.push(`routing.bgp.neighbors.${name}.families, one family per session`);
        }

        const management = device.management;

        if (management?.console) found.push("management.console, the console uses the device's users");
        if (management?.interfaces) found.push("management.interfaces, which only FortiOS builds for now");
        if (management?.privilege_password) found.push("management.privilege_password, the platform has no privileged mode");

        if (management?.snmp?.port) found.push("management.snmp.port");

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

    render(device: Device): string {
        return RouterOsRender.of(device);
    }

    /**
     * What the device runs: its export, its users, and its certificates. Secrets are not part of an export.
     */
    async read(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<string> {
        const session = await RouterOs.open(device, options);

        try {
            await RouterOs.checkVersion(session, device);

            const config = await session.run("/export", 300_000);
            const users = await session.run("/user export");
            const certificates = (await session.run(RouterOs.LIST_CERTIFICATES)).trim();

            const listed = certificates.split("\n").every((line) => line.trim().startsWith("add fingerprint="));
            if (certificates && !listed) {
                throw new Error(`${device.name}: certificates could not be listed: ${certificates.slice(0, 120)}`);
            }

            // The user dump repeats the export's header; only its menu is kept.
            const userMenu = users.slice(users.indexOf("\n/")).trim();
            const certificateMenu = certificates ? `/certificate\n${certificates}` : "";
            const text = [config.trim(), userMenu, certificateMenu].filter(Boolean).join("\n");
            return RouterOs.withoutTimestamp(text) + "\n";
        } finally {
            session.end();
        }
    }

    plan(desired: string, current: string, options: ApplyOptions): Plan {
        return RouterOsPlan.of(desired, current, options);
    }

    async apply(device: Device, _network: readonly Device[], changes: Plan, options: ApplyOptions): Promise<void> {
        const session = await RouterOs.open(device, options);
        await RouterOs.checkVersion(session, device);

        const commands = changes.steps.flatMap((step) => step.send.map((command) => ({ title: step.title, command })));

        for (const { title, command } of commands) {
            if (command.startsWith(RouterOsPlan.INSTALL_CERTIFICATE)) continue;

            const reason = await RouterOs.refusal(session, Secrets.substitute(command));
            if (reason) {
                session.end();
                throw new Error(`${title}: the device will not parse ${command.slice(0, 200)}\n    ${reason}`);
            }
        }

        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        const backup = `pre-apply-${stamp}`;

        // `interval` counts from now; `start-time=startup` would count from boot.
        const armRollback = [
            `/system scheduler add name="${RouterOs.ROLLBACK_SCHEDULER}"`,
            `interval=${options.rollback}m`,
            `on-event="/system backup load name=${backup} password=\\"\\""`,
            "policy=read,write,policy,test,reboot,ftp",
        ].join(" ");

        try {
            console.log(`  saving ${backup}, arming a ${options.rollback} minute rollback`);

            await session.run(`/system backup save name=${backup} dont-encrypt=yes`, 120_000);
            await session.run(`/system scheduler remove [find name="${RouterOs.ROLLBACK_SCHEDULER}"]`);
            await session.run(armRollback);

            for (const { title, command } of commands) {
                if (command.startsWith(RouterOsPlan.INSTALL_CERTIFICATE)) {
                    const certificateName = command.slice(RouterOsPlan.INSTALL_CERTIFICATE.length).trim();
                    await RouterOs.installCertificate(session, device, certificateName);
                    continue;
                }

                const answer = (await session.run(Secrets.substitute(command), 120_000)).trim();
                if (answer) throw new Error(`${title}: ${command.slice(0, 160)}\n    device said: ${answer.slice(0, 300)}`);
            }
        } catch (error) {
            console.log(`  FAILED: ${(error as Error).message}`);
            console.log(`  restoring ${backup} now; the rollback stays armed in case this does not get through`);

            await session.run(`/system backup load name=${backup} password=""`, 30_000).catch(() => undefined);
            session.end();

            throw new Error("apply failed and the backup is being restored");
        }

        // A fresh login is the proof that access survived. Only then is the rollback removed, with the backup, which holds every credential.
        const proof = await session.fresh().catch(() => undefined);
        if (!proof) throw new Error(`could not log in again; the device restores ${backup} within ${options.rollback} minutes`);

        await proof.run(`/system scheduler remove [find name="${RouterOs.ROLLBACK_SCHEDULER}"]`);
        await proof.run(`/file remove [find name="${backup}.backup"]`);
        proof.end();
        console.log("  logged in again, rollback disarmed");
    }

    readOnly(command: string): boolean {
        return RouterOs.READS.test(command) && !RouterOs.WRITES.test(command);
    }

    /** Over SSH, each command runs on its own. */
    async session(device: Device, options: ReadOptions = {}): Promise<ReadSession> {
        const session = options.console
            ? await RouterOs.consoleSession(device, ConsoleShell.SETTLE)
            : RouterOs.sshSession(await RouterOs.login(device, RouterOs.PLAIN_OUTPUT), device);

        return { run: (command, timeout) => session.run(command, timeout), close: () => session.end() };
    }

    /** Replace a list's entries in batches, so each command stays a sane length. */
    async fill(device: Device, _network: readonly Device[], set: string, family: Family, prefixes: string[]): Promise<void> {
        const menu = family === "ipv4" ? "/ip firewall address-list" : "/ipv6 firewall address-list";
        const batchSize = 60;
        const client = await RouterOs.login(device);

        try {
            await Ssh.exec(client, `${menu} remove [find list="${set}" and !dynamic]`);

            for (let start = 0; start < prefixes.length; start += batchSize) {
                const batch = prefixes.slice(start, start + batchSize).map((prefix) => `${menu} add list="${set}" address=${prefix}`);

                const answer = (await Ssh.exec(client, batch.join("; "), 90_000)).trim();
                if (answer) throw new Error(`${set}: ${answer.slice(0, 200)}`);
            }

            const count = (await Ssh.exec(client, `:put [:len [${menu} find list="${set}"]]`)).trim();
            console.log(`  ${set}: ${count} entries on the device`);
        } finally {
            client.end();
        }
    }

    /** Log in over SSH. `flags` go after the user, as RouterOS reads them: `+ct300w`. */
    private static async login(device: Device, flags = ""): Promise<Client> {
        const { port, user, password } = Secrets.loginOf(device);

        return Ssh.connect({
            host: Ssh.hostOf(device),
            port,
            user: `${user}${flags}`,
            password,
        });
    }

    private static sshSession(client: Client, device: Device): Session {
        return {
            run: (command, timeout) => Ssh.exec(client, command, timeout),
            upload: (path, content) => Ssh.upload(client, path, content),
            fresh: async () => {
                client.end();
                return RouterOs.sshSession(await RouterOs.login(device), device);
            },
            end: () => client.end(),
        };
    }

    /** Log in on the console. `settle` is the quiet after the prompt a command waits for, as `ConsoleShell` takes it. */
    private static async consoleSession(device: Device, settle = 0): Promise<Session> {
        const { console, user, password } = SerialConsole.of(device);
        const opened = await SerialConsole.open(console);

        try {
            await SerialConsole.login(opened.channel, RouterOs.CONSOLE, user, password, console.passwordOnly);
        } catch (error) {
            opened.close();
            throw error;
        }

        const shell = new ConsoleShell(opened.channel, RouterOs.CONSOLE, settle);

        const session: Session = {
            run: (command, timeout) => shell.run(command, timeout),
            fresh: async () => {
                await SerialConsole.login(opened.channel, RouterOs.CONSOLE, user, password, console.passwordOnly);
                return session;
            },
            end: () => {
                shell.logout();
                opened.close();
            },
        };

        return session;
    }

    /** Log in over SSH, or on the console when asked. */
    private static async open(device: Device, options: ReadOptions = {}): Promise<Session> {
        return options.console ? RouterOs.consoleSession(device) : RouterOs.sshSession(await RouterOs.login(device), device);
    }

    /** Refuse a device on a version this adapter does not render for, before anything is read or sent. */
    private static async checkVersion(session: Session, device: Device): Promise<void> {
        const version = (await session.run(":put [/system resource get version]")).trim();
        const major = Number(version.split(".")[0]);

        if (major !== RouterOs.SUPPORTED_MAJOR) {
            throw new Error(`${device.name} runs RouterOS ${version}; this adapter renders for version ${RouterOs.SUPPORTED_MAJOR}`);
        }
    }

    private static withoutTimestamp(text: string): string {
        return text.replace(/\r/g, "").replace(RouterOs.EXPORT_TIMESTAMP, "# by RouterOS");
    }

    /** Escape a command so it can sit inside a quoted string on the device. */
    private static escapeForString(text: string): string {
        return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
    }

    /** Compile a command on the device without running it. Returns why it was refused, or undefined. */
    private static async refusal(session: Session, command: string): Promise<string | undefined> {
        const compiled = (await session.run(`:put [:parse "${RouterOs.escapeForString(command)}"]`)).trim();
        const refused = !compiled.startsWith("(") || /syntax error|bad parameter|no such|expected/.test(compiled);
        return refused ? compiled.slice(0, 200) : undefined;
    }

    /** Upload a certificate and its key, import both under one name, and delete the files. */
    private static async installCertificate(session: Session, device: Device, name: string): Promise<void> {
        const certificate = device.certificates?.[name];
        if (!certificate) throw new Error(`certificate ${name} is not declared`);
        if (!session.upload)
            throw new Error(`certificate ${name} is installed from a file, which only SSH can write; apply it without --console`);

        await session.upload(`${name}.crt`, certificate.certificate);
        await session.run(`/certificate import file-name=${name}.crt name=${name} passphrase=""`);

        if (certificate.private_key) {
            // A key from a file is PEM as it is; one from a variable is PEM encoded as one line of base64.
            const value = Secrets.reveal(certificate.private_key);
            const privateKey = value.includes("-----BEGIN") ? `${value}\n` : Buffer.from(value, "base64").toString("utf8");

            await session.upload(`${name}.key`, privateKey);
            await session.run(`/certificate import file-name=${name}.key name=${name} passphrase=""`);
        }

        await session.run(`/file remove [find name="${name}.crt" or name="${name}.key"]`);
    }
}
