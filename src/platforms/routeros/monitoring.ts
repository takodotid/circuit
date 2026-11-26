// SNMP, flow export, and probes, rendered and refused.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device } from "../../model";
import type { RouterOsRender, Value } from "./render";
import { RouterOsSyntax } from "./syntax";

type Snmp = NonNullable<NonNullable<Device["monitoring"]>["snmp"]>;

export class RouterOsMonitoring {
    private static readonly SNMP_PRIVACY = { aes128: "AES", des: "DES" } as const;

    /** Every kind of trap the platform sends: a port going up or down, SNMP starting, and the temperature too high. */
    private static readonly TRAP_GENERATORS = "interfaces,start-trap,temp-exception";

    /** The SNMP trap port (RFC 3417), the only one `trap-target` sends to. */
    private static readonly TRAP_PORT = 162;

    /** The platform keeps one community it will not delete. With version 2c it becomes the read community; without, it is disabled. Version 3 users are communities of their own. */
    static snmp(render: RouterOsRender, device: Device): void {
        const snmp = device.monitoring?.snmp;

        if (!snmp) {
            render.add("/snmp", "set", { enabled: "no" });
            render.add("/snmp community", "set [ find default=yes ]", { addresses: "::/0", name: "public" });
            return;
        }

        const allow = render.allowed(snmp.allow).join(",");
        render.add("/snmp", "set", {
            contact: snmp.contact ?? "",
            enabled: "yes",
            location: snmp.location ?? "",
            vrf: snmp.vrf,
            ...RouterOsMonitoring.trapSettings(snmp),
        });

        if (snmp.community)
            render.add("/snmp community", "set [ find default=yes ]", { addresses: allow, name: Secrets.marker(snmp.community) });
        else render.add("/snmp community", "set [ find default=yes ]", { addresses: "::/0", disabled: "yes", name: "public" });

        for (const [name, user] of Object.entries(snmp.users ?? {})) {
            render.add("/snmp community", "add", {
                addresses: allow,
                "authentication-password": Secrets.marker(user.auth_password),
                // SHA1 only: unsupported() refuses sha256, so it is never written as SHA1.
                "authentication-protocol": "SHA1",
                "encryption-password": Secrets.marker(user.privacy_password),
                "encryption-protocol": RouterOsMonitoring.SNMP_PRIVACY[user.privacy],
                name,
                security: "private",
            });
        }
    }

    /** One community or user for every receiver, on port 162, as `unsupported()` requires. A version 2c trap carries the read community, named by its value. */
    private static trapSettings(snmp: Snmp): Record<string, Value> {
        const traps = snmp.traps ?? [];
        const [first] = traps;
        if (!first) return {};

        return {
            "trap-community": first.user ?? (snmp.community && Secrets.marker(snmp.community)),
            "trap-generators": RouterOsMonitoring.TRAP_GENERATORS,
            "trap-interfaces": "all",
            "trap-target": traps.map((target) => target.address).join(","),
            "trap-version": first.user ? 3 : 2,
        };
    }

    /** NetFlow version 9 and IPFIX through traffic flow. The platform has no sFlow, which `unsupported()` reports. */
    static flowExport(render: RouterOsRender, device: Device): void {
        const flow = device.monitoring?.flow_export;
        if (!flow) {
            render.add("/ip traffic-flow", "set", { enabled: "no" });
            return;
        }

        const sampled = flow.sampling !== undefined && flow.sampling > 1;
        const interfaces = flow.interfaces?.map((iface) => render.name(iface)).join(",") ?? "all";
        render.add("/ip traffic-flow", "set", {
            "active-flow-timeout": flow.active_timeout && RouterOsSyntax.duration(flow.active_timeout),
            enabled: "yes",
            "inactive-flow-timeout": flow.idle_timeout && RouterOsSyntax.duration(flow.idle_timeout),
            interfaces,
            "packet-sampling": RouterOsSyntax.yesNo(sampled),
            "sampling-interval": sampled ? flow.sampling : undefined,
            "sampling-space": sampled ? 1 : undefined,
        });

        const version = flow.protocol === "ipfix" ? "ipfix" : "9";

        for (const collector of flow.collectors) {
            render.add("/ip traffic-flow target", "add", { "dst-address": collector.address, port: collector.port ?? 2055, version });
        }
    }

    /** Netwatch's ICMP probes, each known by its name. A probe in a VRF names it after the target, `<target>@<vrf>`. */
    static probes(render: RouterOsRender, device: Device): void {
        for (const [name, probe] of Object.entries(device.monitoring?.probes ?? {})) {
            render.add("/tool netwatch", "add", {
                host: RouterOsSyntax.inVrf(Address.canonical(probe.target), probe.vrf),
                interval: RouterOsSyntax.duration(probe.interval),
                name,
                "src-address": probe.source_address && Address.canonical(probe.source_address),
                type: "icmp",
            });
        }
    }

    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const monitoring = device.monitoring;
        const snmp = monitoring?.snmp;

        if (snmp?.port) found.push("monitoring.snmp.port");

        for (const [name, user] of Object.entries(snmp?.users ?? {})) {
            if (user.auth !== "sha1") {
                found.push(
                    `monitoring.snmp.users.${name}.auth ${user.auth}: Circuit writes SHA1 only on RouterOS (SHA-2 comes with RouterOS 7.26, not tested yet)`
                );
            }
        }

        const traps = snmp?.traps ?? [];
        const sender = (target: (typeof traps)[number]) => target.user ?? (target.community && Secrets.referenceOf(target.community));
        traps.forEach((target, index) => {
            const where = `monitoring.snmp.traps[${index}]`;
            if (target.port !== undefined && target.port !== RouterOsMonitoring.TRAP_PORT)
                found.push(`${where}.port, the platform sends traps to port 162`);
            if (sender(target) !== sender(traps[0]!))
                found.push(`${where}, with another community or user than traps[0]: the platform sends every trap with one`);
            if (target.community && (!snmp?.community || Secrets.referenceOf(target.community) !== Secrets.referenceOf(snmp.community)))
                found.push(
                    `${where}.community, other than monitoring.snmp.community: the platform sends traps with one of its communities`
                );
        });

        (monitoring?.syslog ?? []).forEach((collector, index) => {
            if (collector.transport_security)
                found.push(
                    `monitoring.syslog[${index}].transport_security, RouterOS sends each message over TLS without the framing of RFC 5425, no length before it and no line feed after it (TRAPS.md)`
                );
        });

        if (monitoring?.transceivers === false) found.push("monitoring.transceivers false, it is always on");
        if (monitoring?.flow_export?.protocol === "sflow")
            found.push("monitoring.flow_export.protocol sflow, the platform exports NetFlow and IPFIX");

        return found;
    }
}
