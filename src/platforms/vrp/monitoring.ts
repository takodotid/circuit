// What a VRP switch reports: sFlow, syslog and the log files, and SNMP, with what it can't report.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device } from "../../model";

export class VrpMonitoring {
    /** The channel that writes the log files on the device's own storage. */
    private static readonly LOGFILE_CHANNEL = 9;

    /** How many log files the device keeps when the config sets none. It is not printed. */
    private static readonly LOGFILES_DEFAULT = 200;

    /** How many log files the platform keeps, at least and at most. */
    private static readonly LOGFILES = { min: 3, max: 500 };

    /** The syslog port the device uses when the config sets none. It is not printed. */
    private static readonly SYSLOG_PORT = 514;

    /** A severity as the platform spells it. `debugging` is the default for a log host and for the log files, and is not printed. */
    private static readonly LOG_LEVEL = {
        emergency: "emergencies",
        alert: "alert",
        critical: "critical",
        error: "error",
        warning: "warning",
        notice: "notification",
        info: "informational",
        debug: "debugging",
    } as const;

    /** The sFlow collectors are numbered from here, in the order the config lists them. */
    private static readonly FIRST_COLLECTOR = 1;

    /** The sFlow sampling rates the platform takes. */
    private static readonly SAMPLING = { min: 4096, max: 4294967295 };

    /** The UDP port traps go to when the config sets none. It is not printed. */
    private static readonly TRAP_PORT = 162;

    /** The SNMPv3 group every user joins, with read access to everything. */
    private static readonly SNMP_GROUP = "circuit";

    private static readonly SNMP_AUTH = { sha1: "sha", sha256: "sha2-256" } as const;
    private static readonly SNMP_PRIVACY = { aes128: "aes128", des: "des56" } as const;

    /** The sFlow agent and its collectors, then a separator. Nothing without sFlow. */
    static flowLines(device: Device): string[] {
        const flow = device.monitoring?.flow_export;
        if (flow?.protocol !== "sflow") return [];

        const lines = device.connection.host ? [`sflow agent ip ${device.connection.host}`] : [];
        flow.collectors.forEach((collector, index) => {
            const number = VrpMonitoring.FIRST_COLLECTOR + index;
            lines.push(`sflow collector ${number} ip ${collector.address} udp-port ${collector.port ?? 6343}`);
        });

        return [...lines, "#"];
    }

    /** What a port samples for sFlow, when the config watches it. */
    static portLines(device: Device, port: string): string[] {
        const flow = device.monitoring?.flow_export;
        const observed = flow?.protocol === "sflow" && (!flow.interfaces || flow.interfaces.includes(port));
        if (!observed) return [];

        const lines = flow.collectors.map((_, index) => `sflow sampling collector ${VrpMonitoring.FIRST_COLLECTOR + index}`);
        return [...lines, `sflow sampling rate ${flow.sampling}`, "sflow sampling inbound"];
    }

    /** The log files' level and count, and each log host, then a separator. Nothing without either. */
    static loggingLines(device: Device): string[] {
        const local = device.system?.logging?.local;
        const collectors = device.monitoring?.syslog;
        if (!device.system?.logging && !collectors) return [];

        const lines: string[] = [];
        if (local && local.level !== "debug")
            lines.push(
                `info-center source default channel ${VrpMonitoring.LOGFILE_CHANNEL} log level ${VrpMonitoring.LOG_LEVEL[local.level]}`
            );

        if (local?.files !== undefined && local.files !== VrpMonitoring.LOGFILES_DEFAULT)
            lines.push(`info-center max-logfile-number ${local.files}`);

        for (const collector of collectors ?? []) {
            const level = collector.level === "debug" ? "" : ` level ${VrpMonitoring.LOG_LEVEL[collector.level]}`;
            const port = collector.port !== undefined && collector.port !== VrpMonitoring.SYSLOG_PORT ? ` port ${collector.port}` : "";
            lines.push(`info-center loghost ${collector.address}${level}${port}`);
        }

        return [...lines, "#"];
    }

    /** SNMP version 2c with one read community, version 3 with users in one read-only group, or both, guarded by `acl`. Then a separator. */
    static snmpLines(device: Device, acl: number | undefined): string[] {
        const snmp = device.monitoring?.snmp;
        if (!snmp) return [];

        const versions = [snmp.community ? "v2c" : "", snmp.users ? "v3" : ""].filter(Boolean).join(" ");
        const guard = acl === undefined ? "" : ` acl ${acl}`;
        const lines = ["snmp-agent", `snmp-agent sys-info version ${versions}`];

        if (snmp.contact) lines.push(`snmp-agent sys-info contact ${snmp.contact}`);
        if (snmp.location) lines.push(`snmp-agent sys-info location ${snmp.location}`);
        if (snmp.community) lines.push(`snmp-agent community read cipher ${Secrets.marker(snmp.community)}${guard}`);
        if (snmp.users) {
            lines.push("snmp-agent mib-view included all iso");
            lines.push(`snmp-agent group v3 ${VrpMonitoring.SNMP_GROUP} privacy read-view all${guard}`);

            for (const [name, user] of Object.entries(snmp.users)) {
                const auth = VrpMonitoring.SNMP_AUTH[user.auth];
                const privacy = VrpMonitoring.SNMP_PRIVACY[user.privacy];
                // The switch prints a user's own line before its settings.
                lines.push(
                    `snmp-agent usm-user v3 ${name}`,
                    `snmp-agent usm-user v3 ${name} group ${VrpMonitoring.SNMP_GROUP}`,
                    `snmp-agent usm-user v3 ${name} authentication-mode ${auth} cipher ${Secrets.marker(user.auth_password)}`,
                    `snmp-agent usm-user v3 ${name} privacy-mode ${privacy} cipher ${Secrets.marker(user.privacy_password)}`
                );
            }
        }

        lines.push(...VrpMonitoring.trapLines(device));
        return [...lines, "#"];
    }

    /**
     * Each receiver of traps, with every trap on. A user's traps are signed and encrypted, as each user's settings are. The switch leaves the port out when it is 162.
     */
    private static trapLines(device: Device): string[] {
        const snmp = device.monitoring?.snmp;
        const traps = snmp?.traps ?? [];
        if (!traps.length) return [];

        const lines = traps.map((trap) => {
            const port = trap.port !== undefined && trap.port !== VrpMonitoring.TRAP_PORT ? ` udp-port ${trap.port}` : "";
            return `snmp-agent target-host trap address udp-domain ${trap.address}${port} params securityname ${trap.user} v3 privacy`;
        });

        return [...lines, "snmp-agent trap enable"];
    }

    /** A receiver of traps is undone without its version, `... params securityname <user>`. Undefined for any other line. */
    static undo(line: string): string | undefined {
        const target = /^(snmp-agent target-host trap .* params securityname \S+) v3 privacy$/.exec(line);
        return target ? `undo ${target[1]}` : undefined;
    }

    /** Each receiver of traps is one of a list. */
    static head(line: string): string | undefined {
        return line.startsWith("snmp-agent target-host trap ") ? line : undefined;
    }

    /** What the platform can't report as the config says. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const local = device.system?.logging?.local;
        const { min: fewest, max: most } = VrpMonitoring.LOGFILES;

        if (local?.lines_per_file !== undefined)
            found.push("system.logging.local.lines_per_file, the platform sizes a log file in megabytes");
        if (local?.files !== undefined && !VrpMonitoring.inRange(local.files, VrpMonitoring.LOGFILES))
            found.push(`system.logging.local.files, between ${fewest} and ${most} on the platform`);

        const monitoring = device.monitoring ?? {};

        for (const collector of monitoring.syslog ?? []) {
            if (Address.family(collector.address) === "ipv6") found.push(`monitoring.syslog ${collector.address}, IPv6 is not tested`);
        }

        for (const source of monitoring.snmp?.allow ?? []) {
            if (Address.family(Address.split(source).addr) === "ipv6") found.push(`monitoring.snmp.allow ${source}, IPv6 is not tested`);
        }

        (monitoring.snmp?.traps ?? []).forEach((trap, index) => {
            if (Address.family(trap.address) === "ipv6") found.push(`monitoring.snmp.traps[${index}].address, IPv6 is not tested`);
            // A CE6855 undoes a receiver with a community only by that community: "The specified target host does not exist".
            if (trap.community)
                found.push(
                    `monitoring.snmp.traps[${index}].community, the switch takes a receiver away only by its community, which it keeps as a cipher Circuit can't read back: write user`
                );
        });

        if (monitoring.transceivers !== undefined) found.push("monitoring.transceivers");
        // A CE6855 loads a CA into an SSL policy only from a file: "The file to be loaded does not exist in flash:/security/".
        (monitoring.syslog ?? []).forEach((collector, index) => {
            if (collector.transport_security)
                found.push(
                    `monitoring.syslog[${index}].transport_security, the switch loads a CA only from a file on its flash, which Circuit does not copy there`
                );
        });

        const flow = monitoring.flow_export;
        if (flow?.protocol === "ipfix")
            found.push("monitoring.flow_export.protocol ipfix, the platform exports sFlow and NetFlow v9: IPFIX is not tested");
        const sampling = flow?.protocol === "sflow" ? flow.sampling : undefined;
        const { min, max } = VrpMonitoring.SAMPLING;

        if (flow?.protocol === "sflow" && !(sampling !== undefined && VrpMonitoring.inRange(sampling, VrpMonitoring.SAMPLING))) {
            found.push(
                `monitoring.flow_export.sampling, required and between ${min} and ${max}: the platform samples, one packet in ${min} at most`
            );
        }

        return found;
    }

    private static inRange(value: number, range: { min: number; max: number }): boolean {
        return Number.isInteger(value) && value >= range.min && value <= range.max;
    }
}
