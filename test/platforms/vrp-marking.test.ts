// Marking on VRP with Huawei's MQC, tried on a CE6855 on V200R005C00SPC800. Circuit's plan was committed with `commit trial`, the policies on spare port 10GE1/0/48 in place of the whole switch. The plan after it differed only by that. `PRINTED` is what the switch printed, with the names of this file. No packet was seen marked.

import { expect, test } from "bun:test";
import type { Device, MarkingRule } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

const rules: MarkingRule[] = [
    { description: "Voice signalling", if: { protocol: "udp", dst_port: 5060 }, then: { dscp: "cs5" } },
    { if: { dscp: "af11" }, then: { dscp: "cs1" } },
    { if: { src: "192.0.2.0/24", dscp: "cs0" }, then: { dscp: "voice-admit" } },
    { if: { family: "ipv6", protocol: "tcp", dst_port: { min: 8000, max: 8080 }, dscp: "le" }, then: { dscp: "nqb" } },
    { then: { dscp: "cs0" } },
];

const marked = (marking: MarkingRule[]): Device => ({ ...base, qos: { marking } });

/** What the switch printed: the behaviors in the order of their names, a DSCP by the name it has, and a space after some lines. The lines that apply the policies to the whole switch are as sent: the switch took them on a spare port instead. */
const PRINTED = `acl name circuit-marking-1 advance
 rule 5 permit udp destination-port eq 5060
 rule 5 description Voice signalling
#
acl name circuit-marking-2 advance
 rule 5 permit ip
#
acl name circuit-marking-3 advance
 rule 5 permit ip source 192.0.2.0 0.0.0.255
#
acl name circuit-marking-5 advance
 rule 5 permit ip
#
acl ipv6 name circuit-marking-1 advance
 rule 5 permit udp destination-port eq 5060
 rule 5 description Voice signalling
#
acl ipv6 name circuit-marking-2 advance
 rule 5 permit ipv6
#
acl ipv6 name circuit-marking-4 advance
 rule 5 permit tcp destination-port range 8000 8080
#
acl ipv6 name circuit-marking-5 advance
 rule 5 permit ipv6
#
traffic classifier circuit-marking-1-ipv4 type and
 if-match acl circuit-marking-1
#
traffic classifier circuit-marking-1-ipv6 type and
 if-match ipv6 acl circuit-marking-1
#
traffic classifier circuit-marking-2-ipv4 type and
 if-match acl circuit-marking-2
 if-match dscp af11
#
traffic classifier circuit-marking-2-ipv6 type and
 if-match ipv6 acl circuit-marking-2
 if-match ipv6 dscp af11
#
traffic classifier circuit-marking-3-ipv4 type and
 if-match acl circuit-marking-3
 if-match dscp default
#
traffic classifier circuit-marking-4-ipv6 type and
 if-match ipv6 acl circuit-marking-4
 if-match ipv6 dscp 1
#
traffic classifier circuit-marking-5-ipv4 type and
 if-match acl circuit-marking-5
#
traffic classifier circuit-marking-5-ipv6 type and
 if-match ipv6 acl circuit-marking-5
#
traffic behavior circuit-dscp-cs0
 remark dscp default
#
traffic behavior circuit-dscp-cs1
 remark dscp cs1
#
traffic behavior circuit-dscp-cs5
 remark dscp cs5
#
traffic behavior circuit-dscp-nqb
 remark dscp 45
#
traffic behavior circuit-dscp-voice-admit
 remark dscp 44
#
traffic policy circuit-marking-ipv4
 classifier circuit-marking-1-ipv4 behavior circuit-dscp-cs5 precedence 5
 classifier circuit-marking-2-ipv4 behavior circuit-dscp-cs1 precedence 10
 classifier circuit-marking-3-ipv4 behavior circuit-dscp-voice-admit precedence 15
 classifier circuit-marking-5-ipv4 behavior circuit-dscp-cs0 precedence 20
#
traffic policy circuit-marking-ipv6
 classifier circuit-marking-1-ipv6 behavior circuit-dscp-cs5 precedence 5
 classifier circuit-marking-2-ipv6 behavior circuit-dscp-cs1 precedence 10
 classifier circuit-marking-4-ipv6 behavior circuit-dscp-nqb precedence 15
 classifier circuit-marking-5-ipv6 behavior circuit-dscp-cs0 precedence 20
#
traffic-policy circuit-marking-ipv4 global inbound
traffic-policy circuit-marking-ipv6 global inbound
#
`;

/** The render with its marking as the switch printed it. */
const printed = (render: string) => `${render.replace(/^acl name circuit-marking-1 advance\n[\s\S]*?global inbound\n#\n/m, "")}${PRINTED}`;

test("VRP marks with an ACL and a classifier for each rule and family, and a policy for each family, and plans nothing against how the switch prints them", () => {
    const desired = vrp.render(marked(rules));

    // A rule of one family, by its addresses or `family`, has no classifier in the other.
    expect(desired).not.toContain("circuit-marking-3-ipv6");
    expect(desired).not.toContain("circuit-marking-4-ipv4");
    expect(desired).toContain("traffic behavior circuit-dscp-voice-admit\n remark dscp 44\n#");
    expect(vrp.plan(desired, printed(desired), options).steps).toEqual([]);
    expect(vrp.unsupported(marked(rules))).toEqual([]);
    expect(vrp.experimental(marked(rules))).toEqual(["qos.marking"]);
});

test("VRP lets go of the policies before it removes them, and removes the ACLs last", () => {
    const desired = vrp.render(marked(rules));

    expect(sent(vrp.render(base), printed(desired)).slice(0, 4)).toEqual([
        "undo traffic-policy circuit-marking-ipv6 global inbound",
        "undo traffic-policy circuit-marking-ipv4 global inbound",
        "undo traffic policy circuit-marking-ipv6",
        "undo traffic policy circuit-marking-ipv4",
    ]);
    expect(sent(vrp.render(base), printed(desired)).slice(-8)).toEqual([
        "undo acl ipv6 name circuit-marking-5",
        "undo acl ipv6 name circuit-marking-4",
        "undo acl ipv6 name circuit-marking-2",
        "undo acl ipv6 name circuit-marking-1",
        "undo acl name circuit-marking-5",
        "undo acl name circuit-marking-3",
        "undo acl name circuit-marking-2",
        "undo acl name circuit-marking-1",
    ]);
});

test("VRP unbinds a classifier whose behavior or place changes, and removes a behavior no rule sets", () => {
    const before = vrp.render(marked(rules.slice(0, 2)));
    const after = vrp.render(marked([{ if: { src: "192.0.2.0/24" }, then: { dscp: "ef" } }, rules[1]!]));

    expect(sent(after, before)).toEqual([
        "acl name circuit-marking-1 advance",
        "undo rule 5",
        "rule 5 permit ip source 192.0.2.0 0.0.0.255",
        "quit",
        "traffic behavior circuit-dscp-ef",
        "remark dscp ef",
        "quit",
        "traffic policy circuit-marking-ipv4",
        "undo classifier circuit-marking-1-ipv4 behavior circuit-dscp-cs5 precedence 5",
        "classifier circuit-marking-1-ipv4 behavior circuit-dscp-ef precedence 5",
        "quit",
        "traffic policy circuit-marking-ipv6",
        "undo classifier circuit-marking-2-ipv6 behavior circuit-dscp-cs1 precedence 10",
        "undo classifier circuit-marking-1-ipv6 behavior circuit-dscp-cs5 precedence 5",
        "classifier circuit-marking-2-ipv6 behavior circuit-dscp-cs1 precedence 5",
        "quit",
        "undo traffic behavior circuit-dscp-cs5",
        "undo traffic classifier circuit-marking-1-ipv6",
        "undo acl ipv6 name circuit-marking-1",
    ]);
});

test("VRP refuses a PCP, which it sets only on what it switches, and an interface to match", () => {
    const refused = marked([
        { if: { in_interface: "mgmt" }, then: { dscp: "ef", pcp: 5 } },
        { if: { src: "192.0.2.0/24", src_address_set: "phones", protocol: "icmp", dst_port: 7 }, then: { dscp: "af41" } },
    ]);

    expect(vrp.unsupported(refused)).toEqual([
        "qos.marking[0].then.pcp, the platform sets the 802.1p priority of what it switches only, not of what it routes",
        "qos.marking[0].if.in_interface, not built yet",
        "qos.marking[1].if.src with src_address_set, not built yet",
        "qos.marking[1].if, ports with protocol icmp: only TCP and UDP have ports",
    ]);
});
