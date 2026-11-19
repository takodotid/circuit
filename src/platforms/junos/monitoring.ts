import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device } from "../../model";
import type { JunosNames } from "./names";
import { JunosStatements } from "./statements";

/** SNMP, its traps, and sFlow. */
export class JunosMonitoring {
    private static readonly SNMP_AUTH = { sha1: "authentication-sha", sha256: "authentication-sha256" } as const;
    private static readonly SNMP_PRIVACY = { aes128: "privacy-aes128", des: "privacy-des" } as const;

    /** The SNMPv3 group every user joins, with read access to everything. Version 3 traps go out under this name too, as the tag of their receivers. */
    private static readonly SNMP_GROUP = "circuit";

    /** The SNMP trap port (RFC 3417). */
    private static readonly TRAP_PORT = 162;

    /** The sFlow collector port (RFC 3176). */
    private static readonly SFLOW_PORT = 6343;

    static snmp(out: JunosStatements, device: Device): void {
        const snmp = device.monitoring?.snmp;
        if (!snmp) return;

        if (snmp.contact) out.set("snmp contact", JunosStatements.quote(snmp.contact));
        if (snmp.location) out.set("snmp location", JunosStatements.quote(snmp.location));
        if (snmp.community) out.set("snmp community", Secrets.marker(snmp.community), "authorization read-only");

        const traps = snmp.traps ?? [];
        // A version 2c trap group is named by the community its traps carry.
        for (const target of traps) {
            if (!target.community) continue;

            const group = `snmp trap-group ${Secrets.marker(target.community)}`;
            out.set(group, "version v2");
            if (target.port !== undefined && target.port !== JunosMonitoring.TRAP_PORT) out.set(group, "destination-port", target.port);
            out.set(group, "targets", target.address);
        }

        if (!snmp.users) return;

        for (const [name, user] of Object.entries(snmp.users)) {
            const usm = `snmp v3 usm local-engine user ${name}`;
            out.set(usm, JunosMonitoring.SNMP_AUTH[user.auth], "authentication-password", Secrets.marker(user.auth_password));
            out.set(usm, JunosMonitoring.SNMP_PRIVACY[user.privacy], "privacy-password", Secrets.marker(user.privacy_password));
            out.set("snmp v3 vacm security-to-group security-model usm security-name", name, "group", JunosMonitoring.SNMP_GROUP);
        }

        out.set("snmp view all oid .1 include");
        const access = `snmp v3 vacm access group ${JunosMonitoring.SNMP_GROUP} default-context-prefix security-model usm security-level privacy`;
        out.set(access, "read-view all");

        // A version 3 receiver is a target address named by its address, which sends as its user.
        const receivers = traps.flatMap(({ user, address, port }) => (user ? [{ user, address, port }] : []));
        if (!receivers.length) return;

        out.set(access, "notify-view all");
        for (const { user, address, port } of receivers) {
            const target = `snmp v3 target-address ${address}`;
            out.set(target, "address", address);
            if (port !== undefined && port !== JunosMonitoring.TRAP_PORT) out.set(target, "port", port);
            out.set(target, "tag-list", JunosMonitoring.SNMP_GROUP);
            out.set(target, "target-parameters", user);

            const parameters = `snmp v3 target-parameters ${user} parameters`;
            out.set(parameters, "message-processing-model v3");
            out.set(parameters, "security-model usm");
            out.set(parameters, "security-level privacy");
            out.set(parameters, "security-name", user);
        }
        out.set(`snmp v3 notify ${JunosMonitoring.SNMP_GROUP}`, "type trap");
        out.set(`snmp v3 notify ${JunosMonitoring.SNMP_GROUP}`, "tag", JunosMonitoring.SNMP_GROUP);
    }

    static sflow(out: JunosStatements, device: Device, names: JunosNames): void {
        const flow = device.monitoring?.flow_export;
        if (flow?.protocol !== "sflow") return;

        if (device.connection.host) out.set("protocols sflow agent-id", device.connection.host);
        if (flow.sampling !== undefined) out.set("protocols sflow sample-rate ingress", flow.sampling);

        for (const collector of flow.collectors) {
            out.set("protocols sflow collector", collector.address);
            if (collector.port !== undefined && collector.port !== JunosMonitoring.SFLOW_PORT) {
                out.set("protocols sflow collector", collector.address, "udp-port", collector.port);
            }
        }

        const declared = Derive.ports(device).filter(([, settings]) => !settings.in_lag);
        const observed = flow.interfaces ?? declared.map(([port]) => port);

        for (const name of observed) {
            for (const port of names.members(name)) if (!port.startsWith("em")) out.set("protocols sflow interfaces", `${port}.0`);
        }
    }
}
