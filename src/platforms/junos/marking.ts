import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device, Family, MarkingRule, Ports } from "../../model";
import type { JunosNames } from "./names";
import { JunosQos } from "./qos";
import { JunosStatements } from "./statements";

/**
 * Marking on a QFX5100: a filter for each family, on each VLAN interface, routed port, routed LAG, and tunnel with an address of it. A term for each rule, in order, sets the DSCP and the forwarding class. Its accept ends the filter, as the first rule that matches ends marking. A packet no term matches is accepted, and keeps its DSCP.
 */
export class JunosMarking {
    /** A filter's name is unique across families (TRAPS.md). */
    static readonly FILTER = { ipv4: "circuit-marking", ipv6: "circuit-marking-v6" } as const;

    private static readonly FAMILY = { ipv4: "inet", ipv6: "inet6" } as const;

    /** The DSCP as each family's header names it: IPv6 carries it in its traffic class. */
    private static readonly DSCP_FIELD = { ipv4: "dscp", ipv6: "traffic-class" } as const;

    /** Where routed packets arrive: a loopback takes only what the switch receives itself. */
    private static readonly ROUTED_KINDS = new Set(["ethernet", "lag", "vlan_interface", "gre"]);

    /** The protocols that have ports, which a rule with ports and no protocol matches. */
    private static readonly PORTED = ["tcp", "udp"] as const;

    static render(out: JunosStatements, device: Device, names: JunosNames): void {
        const rules = device.qos?.marking ?? [];
        if (!rules.length) return;

        for (const family of ["ipv4", "ipv6"] as const) {
            const filter = `firewall family ${JunosMarking.FAMILY[family]} filter ${JunosMarking.FILTER[family]}`;
            const written = rules.map((rule, index) => JunosMarking.term(out, device, filter, family, rule, index)).some(Boolean);
            if (!written) continue;

            out.set(filter, "term circuit-default then accept");
            for (const unit of JunosMarking.units(device, names, family))
                out.set(
                    `interfaces ${unit.replace(".", " unit ")} family ${JunosMarking.FAMILY[family]} filter input`,
                    JunosMarking.FILTER[family]
                );
        }
    }

    /** A rule's term in one family's filter, when the rule can match a packet of that family. */
    private static term(out: JunosStatements, device: Device, filter: string, family: Family, rule: MarkingRule, index: number): boolean {
        const match = rule.if ?? {};
        if (match.family && match.family !== family) return false;

        const src = JunosMarking.addresses(device, match.src, match.src_address_set, family);
        const dst = JunosMarking.addresses(device, match.dst, match.dst_address_set, family);
        if (src?.length === 0 || dst?.length === 0) return false;

        const label = `${index + 1}`;
        const term = `${filter} term ${JunosStatements.quote(rule.description ? `${label} ${rule.description}` : label)}`;
        const field = JunosMarking.DSCP_FIELD[family];
        const ported = match.src_port !== undefined || match.dst_port !== undefined;
        const protocols = match.protocol ? [match.protocol] : ported ? JunosMarking.PORTED : [];

        for (const address of src ?? []) out.set(term, "from source-address", address);
        for (const address of dst ?? []) out.set(term, "from destination-address", address);
        for (const protocol of protocols)
            out.set(
                term,
                "from",
                family === "ipv4" ? "protocol" : "next-header",
                family === "ipv6" && protocol === "icmp" ? "icmp6" : protocol
            );
        for (const port of JunosMarking.eachPort(match.src_port)) out.set(term, "from source-port", port);
        for (const port of JunosMarking.eachPort(match.dst_port)) out.set(term, "from destination-port", port);
        for (const dscp of [match.dscp ?? []].flat()) out.set(term, "from", field, Derive.DSCP[dscp]);

        const { dscp, class: named } = rule.then;
        if (dscp !== undefined) out.set(term, "then", field, Derive.DSCP[dscp]);

        // The switch classified the packet as it arrived, so a new DSCP takes its class here.
        const written = dscp !== undefined && device.qos?.default_class ? JunosQos.classOfWritten(device, Derive.DSCP[dscp]) : undefined;
        const className = named ?? written;
        if (className) {
            out.set(term, "then forwarding-class", className);
            out.set(term, "then loss-priority", JunosQos.LOSS_PRIORITY);
        }
        out.set(term, "then accept");
        return true;
    }

    /** A side's prefixes of the family, each with its length, or undefined when the rule matches any address. An empty list matches no packet of the family. */
    private static addresses(
        device: Device,
        prefixes: string | readonly string[] | undefined,
        set: string | undefined,
        family: Family
    ): string[] | undefined {
        const listed = set ? (device.firewall?.address_sets?.[set] ?? []) : prefixes === undefined ? undefined : [prefixes].flat();
        if (listed === undefined) return undefined;

        return listed
            .map((entry) => Address.canonical(entry))
            .filter((entry) => Address.family(Address.host(entry)) === family)
            .map((entry) => (entry.includes("/") ? entry : `${entry}/${Address.bits(family)}`));
    }

    /** Each port or range as a filter writes it: `53`, `1000-2000`. */
    private static eachPort(ports: Ports | undefined): string[] {
        if (ports === undefined) return [];
        return [ports].flat().map((port) => (typeof port === "number" ? String(port) : `${port.min}-${port.max}`));
    }

    /** The logical interfaces with an address of the family where routed packets arrive: VLAN interfaces, routed ports and LAGs, and tunnels. */
    private static units(device: Device, names: JunosNames, family: Family): string[] {
        return Derive.holders(device).flatMap(({ kind, name, settings }) => {
            if (!JunosMarking.ROUTED_KINDS.has(kind)) return [];
            if (kind === "ethernet" && names.port(name).startsWith("em")) return [];
            const switched =
                kind === "ethernet" ? device.interfaces?.ethernet?.[name] : kind === "lag" ? device.interfaces?.lag?.[name] : undefined;
            if (switched?.access_vlan || switched?.trunk_vlans || switched?.qinq_vlan) return [];

            const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
            return addresses.some((address) => Address.family(address) === family) ? [names.unit(name)] : [];
        });
    }

    /** What marking can't do here. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        (device.qos?.marking ?? []).forEach((rule, index) => {
            const where = `qos.marking[${index}]`;
            if (rule.then.pcp !== undefined)
                found.push(
                    `${where}.then.pcp, which a QFX5100 sets only with a rewrite rule on the port a packet leaves through, for every packet of a class, the ones it switches too`
                );
            for (const key of ["out_interface", "out_interface_set"] as const)
                if (rule.if?.[key] !== undefined)
                    found.push(
                        `${where}.if.${key}, which the filter can't see: it sits where packets arrive, before the switch routes them`
                    );
            for (const key of ["in_interface", "in_interface_set"] as const)
                if (rule.if?.[key] !== undefined) found.push(`${where}.if.${key}, not built yet`);

            const protocol = rule.if?.protocol;
            const ported = rule.if?.src_port !== undefined || rule.if?.dst_port !== undefined;
            if (ported && protocol && !(JunosMarking.PORTED as readonly string[]).includes(protocol))
                found.push(`${where}.if, ports with protocol ${protocol}: only TCP and UDP have ports`);
        });

        // An interface takes one input filter of each family, and a routed port's hardware ACL is one.
        if (device.qos?.marking?.length)
            for (const [name, port] of Derive.ports(device))
                if (port.ingress_acl && !port.access_vlan && !port.trunk_vlans)
                    found.push(`interfaces.ethernet.${name}.ingress_acl beside qos.marking: a routed port takes one filter of each family`);

        return found;
    }

    /** Only `commit check` ran on a QFX5100, in a candidate that was never committed. */
    static experimental(device: Device): string[] {
        return device.qos?.marking?.length ? ["qos.marking"] : [];
    }
}
