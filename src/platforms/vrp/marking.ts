// Marking on VRP, with Huawei's MQC. Each rule has, for each family, an ACL and a traffic classifier with the ACL and the DSCP a packet arrives with. A behavior sets each DSCP. A policy for each family binds them in order, applied to all the switch receives. A CE6855 on V200R005C00SPC800 took them on a spare port (TRAPS.md).

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { AclRule, Device, Dscp, Family, MarkingRule, Prefix } from "../../model";
import type { Group } from "../line-diff";
import { VrpAcls } from "./acls";

/** A rule of one family: its number, from 1 in `qos.marking`, and its ACL's lines. */
type FamilyRule = { number: number; rule: MarkingRule; matches: string[] };

export class VrpMarking {
    /** Classifiers in a policy, and rules in an ACL, are numbered in steps of 5. */
    private static readonly STEP = 5;

    private static readonly FAMILIES = ["ipv4", "ipv6"] as const;

    /** How the classifier of each family matches its ACL and the DSCP a packet arrives with. One policy refused an IPv4 ACL beside an IPv6 one. */
    private static readonly IF_MATCH: Record<Family, { acl: string; dscp: string }> = {
        ipv4: { acl: "if-match acl", dscp: "if-match dscp" },
        ipv6: { acl: "if-match ipv6 acl", dscp: "if-match ipv6 dscp" },
    };

    /** A DSCP the switch prints by a name of its own: 0 as `default`, 46 as `ef`. Any other prints as its number. */
    private static readonly NAMED: readonly Dscp[] = [
        ...(["cs1", "cs2", "cs3", "cs4", "cs5", "cs6", "cs7", "ef"] as const),
        ...(["af11", "af12", "af13", "af21", "af22", "af23", "af31", "af32", "af33", "af41", "af42", "af43"] as const),
    ];

    /** A classifier's header: its name is all its undo takes. */
    private static readonly CLASSIFIER = /^traffic classifier (\S+) type and$/;

    /** A policy applied to everything the switch receives. */
    private static readonly APPLIED = /^traffic-policy \S+ global inbound$/;

    /** The ACLs, classifiers, behaviors, and policies, then the lines that apply the policies. Nothing without marking. */
    static lines(device: Device): string[] {
        const rules = device.qos?.marking ?? [];
        if (!rules.length) return [];

        const lines: string[] = [];
        const byFamily = VrpMarking.FAMILIES.map((family) => ({ family, rules: VrpMarking.rulesOf(device, family) }));

        for (const { family, rules: own } of byFamily) {
            for (const { number, rule, matches } of own) {
                lines.push(`${family === "ipv4" ? "acl" : "acl ipv6"} name ${VrpMarking.name(number)} advance`);
                matches.forEach((match, at) => {
                    const id = (at + 1) * VrpMarking.STEP;
                    lines.push(` rule ${id} permit ${match}`, ...(rule.description ? [` rule ${id} description ${rule.description}`] : []));
                });
                lines.push("#");
            }
        }

        for (const { family, rules: own } of byFamily) {
            for (const { number, rule } of own) {
                const { acl, dscp } = VrpMarking.IF_MATCH[family];
                const arrives = rule.if?.dscp;
                lines.push(
                    `traffic classifier ${VrpMarking.classifier(number, family)} type and`,
                    ` ${acl} ${VrpMarking.name(number)}`,
                    ...(typeof arrives === "string" ? [` ${dscp} ${VrpMarking.spell(arrives)}`] : []),
                    "#"
                );
            }
        }

        const marked = [...new Set(rules.flatMap((rule) => (rule.then.dscp ? [rule.then.dscp] : [])))];
        for (const dscp of marked)
            lines.push(`traffic behavior ${VrpMarking.behavior(dscp)}`, ` remark dscp ${VrpMarking.spell(dscp)}`, "#");

        const applied: string[] = [];
        for (const { family, rules: own } of byFamily) {
            const bound = own.filter(({ rule }) => rule.then.dscp);
            if (!bound.length) continue;

            lines.push(`traffic policy ${VrpMarking.policy(family)}`);
            bound.forEach(({ number, rule }, at) =>
                lines.push(
                    ` classifier ${VrpMarking.classifier(number, family)} behavior ${VrpMarking.behavior(rule.then.dscp!)} precedence ${(at + 1) * VrpMarking.STEP}`
                )
            );
            lines.push("#");
            applied.push(`traffic-policy ${VrpMarking.policy(family)} global inbound`);
        }

        return applied.length ? [...lines, ...applied, "#"] : lines;
    }

    /** What marking can't do here. A traffic policy that re-marks the 802.1p priority as packets arrive changes only what the switch switches (Huawei's `remark 8021p` reference). */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        (device.qos?.marking ?? []).forEach((rule, index) => {
            const where = `qos.marking[${index}]`;
            if (rule.then.pcp !== undefined)
                found.push(`${where}.then.pcp, the platform sets the 802.1p priority of what it switches only, not of what it routes`);
            for (const key of ["in_interface", "out_interface"] as const)
                if (rule.if?.[key] !== undefined) found.push(`${where}.if.${key}, not built yet`);
            // An ACL rule has one source and one destination.
            for (const way of ["src", "dst"] as const)
                if (rule.if?.[way] !== undefined && rule.if[`${way}_address_set`] !== undefined)
                    found.push(`${where}.if.${way} with ${way}_address_set, not built yet`);

            const protocol = rule.if?.protocol;
            const ported = rule.if?.src_port !== undefined || rule.if?.dst_port !== undefined;
            if (ported && protocol && protocol !== "tcp" && protocol !== "udp")
                found.push(`${where}.if, ports with protocol ${protocol}: only TCP and UDP have ports`);
        });

        return found;
    }

    /** The switch took the lines, but no packet was seen marked. */
    static experimental(device: Device): string[] {
        return device.qos?.marking?.length ? ["qos.marking"] : [];
    }

    /** A classifier is removed by its name. Undefined for any other line. */
    static undo(line: string): string | undefined {
        const classifier = VrpMarking.CLASSIFIER.exec(line);
        return classifier ? `undo traffic classifier ${classifier[1]}` : undefined;
    }

    /** A behavior or a policy is one of its own, as is a binding: a classifier with another behavior or precedence is unbound first. */
    static head(line: string): string | undefined {
        return /^(classifier \S+ behavior|traffic (behavior|policy)) /.test(line) ? line : undefined;
    }

    /** A policy can't be removed while the switch applies it, so the switch lets go of it first. */
    static order(groups: Group[]): void {
        const top = groups.find((group) => group.path.length === 0);
        if (!top) return;

        const applied = top.remove.filter((line) => VrpMarking.APPLIED.test(line));
        top.remove = [...applied, ...top.remove.filter((line) => !applied.includes(line))];
    }

    /** The rules a family's packets can match, each with its ACL's lines. A rule of the other family, by `family` or its addresses, has none. */
    private static rulesOf(device: Device, family: Family): FamilyRule[] {
        return (device.qos?.marking ?? []).flatMap((rule, index) => {
            const matches = [...new Set(VrpAcls.matchesOf(VrpMarking.aclRule(device, rule), family))];
            return matches.length ? [{ number: index + 1, rule, matches }] : [];
        });
    }

    /** A marking rule's match as an ACL rule that permits, with each address set as its addresses. */
    private static aclRule(device: Device, rule: MarkingRule): AclRule {
        const match = rule.if ?? {};
        // A set may hold an address alone: a prefix of its family's full length.
        const set = (name: string) =>
            (device.firewall?.address_sets?.[name] ?? []).map((entry) =>
                entry.includes("/") ? (entry as Prefix) : (`${entry}/${Address.bits(Address.family(entry))}` as Prefix)
            );
        const src = match.src_address_set ? set(match.src_address_set) : match.src;
        const dst = match.dst_address_set ? set(match.dst_address_set) : match.dst;
        const { family, protocol, src_port: srcPort, dst_port: dstPort } = match;
        return { if: { family, protocol, src, dst, src_port: srcPort, dst_port: dstPort }, then: "accept" };
    }

    /** A DSCP as the switch prints it. */
    private static spell(dscp: Dscp): string {
        if (dscp === "cs0") return "default";
        return VrpMarking.NAMED.includes(dscp) ? dscp : `${Derive.DSCP[dscp]}`;
    }

    /** The ACL of a rule, by its place in `qos.marking`: `circuit-marking-1`, with an ACL6 of the same name. */
    private static name(number: number): string {
        return `circuit-marking-${number}`;
    }

    private static classifier(number: number, family: Family): string {
        return `${VrpMarking.name(number)}-${family}`;
    }

    /** The behavior that sets one DSCP, by its name in the IANA registry: `circuit-dscp-ef`. */
    private static behavior(dscp: Dscp): string {
        return `circuit-dscp-${dscp}`;
    }

    private static policy(family: Family): string {
        return `circuit-marking-${family}`;
    }
}
