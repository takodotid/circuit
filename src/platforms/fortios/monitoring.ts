import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Secret, Severity, SnmpTrapTarget } from "../../model";
import { FortiOsNames } from "./names";
import type { FortiOsNode } from "./tree";
import { FortiOsTree } from "./tree";

/** SNMP, its communities and traps, syslog, and NetFlow. */
export class FortiOsMonitoring {
    /** The SNMP trap port (RFC 3417), the platform's default. */
    private static readonly TRAP_PORT = 162;

    /** The syslog ports: over UDP (RFC 5426), the platform's default, and over TLS (RFC 5425). */
    private static readonly SYSLOG_PORT = { udp: 514, tls: 6514 } as const;

    private static readonly SECONDS_PER_MINUTE = 60;

    /** The most syslog collectors the device sends to. */
    static readonly COLLECTORS = 4;

    /** NetFlow's flow timeouts: the active one is set in minutes, the inactive one in seconds. */
    static readonly FLOW_TIMEOUTS = {
        active: { min: 60, max: 3600, default: 1800 },
        inactive: { min: 10, max: 600, default: 15 },
    } as const;

    static readonly LEVEL: Record<Severity, string> = {
        emergency: "emergency",
        alert: "alert",
        critical: "critical",
        error: "error",
        warning: "warning",
        notice: "notification",
        info: "information",
        debug: "debug",
    };

    static snmp(root: FortiOsNode, device: Device): void {
        const snmp = device.monitoring?.snmp;
        if (!snmp) return;

        const sysinfo = root.block("system snmp sysinfo");
        sysinfo.set("status", "enable");
        if (snmp.contact) sysinfo.set("contact-info", FortiOsTree.quote(snmp.contact));
        if (snmp.location) sysinfo.set("location", FortiOsTree.quote(snmp.location));

        FortiOsMonitoring.communities(root, device);

        const traps = snmp.traps ?? [];
        for (const [name, user] of Object.entries(snmp.users ?? {})) {
            const entry = root.block("system snmp user").entry(name);
            entry.set("security-level", "auth-priv");
            if (snmp.port) entry.set("query-port", snmp.port);
            // SHA1 and AES128 are the platform's defaults and are not printed.
            entry.set("auth-pwd", FortiOsTree.quote(Secrets.marker(user.auth_password)));
            if (user.privacy === "des") entry.set("priv-proto", "des");
            entry.set("priv-pwd", FortiOsTree.quote(Secrets.marker(user.privacy_password)));

            // A user sends traps to its notify hosts, on one port, which `unsupported()` requires.
            const receivers = traps.filter((target) => target.user === name);
            const ipv4 = receivers.filter((target) => Address.family(target.address) === "ipv4");
            const ipv6 = receivers.filter((target) => Address.family(target.address) === "ipv6");
            if (ipv4.length) entry.set("notify-hosts", ipv4.map((target) => target.address).join(" "));
            if (ipv6.length) entry.set("notify-hosts6", ipv6.map((target) => target.address).join(" "));
            const port = receivers[0]?.port;
            if (port && port !== FortiOsMonitoring.TRAP_PORT) entry.set("trap-rport", port);
        }
    }

    /**
     * Version 2c communities: the read community first, then each other community traps carry. A community answers its allowed sources and sends traps to its receivers, each one host, on one port, which `unsupported()` requires. Version 1 is off.
     */
    private static communities(root: FortiOsNode, device: Device): void {
        const snmp = device.monitoring?.snmp;
        const communities: { community: Secret; read: boolean; receivers: SnmpTrapTarget[] }[] = [];
        if (snmp?.community) communities.push({ community: snmp.community, read: true, receivers: [] });

        for (const target of snmp?.traps ?? []) {
            if (!target.community) continue;

            const reference = Secrets.referenceOf(target.community);
            const known = communities.find((each) => Secrets.referenceOf(each.community) === reference);
            if (known) known.receivers.push(target);
            else communities.push({ community: target.community, read: false, receivers: [target] });
        }

        communities.forEach(({ community, read, receivers }, index) => {
            const entry = root.block("system snmp community").entry(index + 1);
            entry.set("name", FortiOsTree.quote(Secrets.marker(community)));

            const hosts: { prefix: string; trap: boolean }[] = [
                ...(read ? (snmp?.allow ?? FortiOsNames.allowed(device)) : []).map((prefix) => ({ prefix, trap: false })),
                ...receivers.map((target) => ({ prefix: target.address, trap: true })),
            ];
            for (const family of ["ipv4", "ipv6"] as const) {
                hosts
                    .filter(({ prefix }) => Address.family(Address.host(prefix)) === family)
                    .forEach(({ prefix, trap }, number) => {
                        const network = FortiOsNames.network(prefix);
                        const host = entry.block(family === "ipv4" ? "hosts" : "hosts6").entry(number + 1);
                        host.set(family === "ipv4" ? "ip" : "ipv6", family === "ipv4" ? FortiOsNames.subnet(network) : network);
                        // A host of the default type, `any`, is also sent traps.
                        if (receivers.length) host.set("host-type", trap ? "trap" : "query");
                    });
            }

            entry.set("query-v1-status", "disable");
            if (!read) entry.set("query-v2c-status", "disable");
            if (read && snmp?.port) entry.set("query-v2c-port", snmp.port);
            entry.set("trap-v1-status", "disable");
            if (!receivers.length) entry.set("trap-v2c-status", "disable");
            const port = receivers[0]?.port;
            if (port && port !== FortiOsMonitoring.TRAP_PORT) entry.set("trap-v2c-rport", port);
        });
    }

    static logging(root: FortiOsNode, device: Device): void {
        const logging = device.system?.logging;

        // The device prints whether it keeps logs in memory either way, and keeps them unless told not to.
        root.block("log memory setting").set("status", logging?.local ? "enable" : "disable");
        if (logging?.local && logging.local.level !== "info")
            root.block("log memory filter").set("severity", FortiOsMonitoring.LEVEL[logging.local.level]);

        // The disk keeps logs unless told not to; the config keeps them only in memory.
        root.block("log disk setting").set("status", "disable");

        (device.monitoring?.syslog ?? []).slice(0, FortiOsMonitoring.COLLECTORS).forEach((collector, index) => {
            const number = index === 0 ? "" : String(index + 1);
            const setting = root.block(`log syslogd${number} setting`);
            setting.set("status", "enable");
            setting.set("server", FortiOsTree.quote(collector.address));
            // TLS runs over TCP, as RFC 6587 frames it, and the device checks the collector's certificate against its CA certificates. Each of the two settings sets the port back to its default, so the port comes last (TRAPS.md).
            if (collector.transport_security) {
                setting.set("mode", "reliable");
                setting.set("enc-algorithm", "high");
            }
            const port =
                collector.port ?? (collector.transport_security ? FortiOsMonitoring.SYSLOG_PORT.tls : FortiOsMonitoring.SYSLOG_PORT.udp);
            if (port !== FortiOsMonitoring.SYSLOG_PORT.udp) setting.set("port", port);

            if (collector.level !== "info")
                root.block(`log syslogd${number} filter`).set("severity", FortiOsMonitoring.LEVEL[collector.level]);
        });
    }

    static flowExport(root: FortiOsNode, device: Device): void {
        const flow = device.monitoring?.flow_export;
        const collector = flow?.collectors[0];
        if (!flow || !collector) return;

        if (flow.protocol === "sflow") {
            const block = root.block("system sflow").set("collector-ip", collector.address);
            if (collector.port && collector.port !== 6343) block.set("collector-port", collector.port);
        }

        if (flow.protocol === "netflow-v9") {
            const block = root.block("system netflow").set("collector-ip", collector.address);
            if (collector.port && collector.port !== 2055) block.set("collector-port", collector.port);

            const { active, inactive } = FortiOsMonitoring.FLOW_TIMEOUTS;
            if (flow.active_timeout && flow.active_timeout !== active.default)
                block.set("active-flow-timeout", flow.active_timeout / FortiOsMonitoring.SECONDS_PER_MINUTE);
            if (flow.idle_timeout && flow.idle_timeout !== inactive.default) block.set("inactive-flow-timeout", flow.idle_timeout);
        }
    }
}
