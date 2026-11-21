// Hardware ACLs and the firewall's chains on VRP, against what a CE6855 on V200R005C00SPC800 printed. Addresses are from documentation ranges.

import { expect, test } from "bun:test";
import type { AclRule, Device } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const switchDevice = Fixtures.device("platforms--example-switch");
const options = { secrets: false, rollback: 10 };

const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

const withAcl = (rules: AclRule[], port: Record<string, unknown> = {}): Device => ({
    ...switchDevice,
    switching: { ...switchDevice.switching, acls: { "ctest-acl": rules } },
    interfaces: {
        ...switchDevice.interfaces,
        ethernet: {
            ...switchDevice.interfaces!.ethernet,
            "10g-1": { ...switchDevice.interfaces!.ethernet!["10g-1"], ingress_acl: "ctest-acl", ...port },
        },
    },
});

const rules: AclRule[] = [
    {
        description: "Hosts reach the server",
        if: { protocol: "tcp", src: "192.0.2.0/24", dst: "198.51.100.1/32", dst_port: 22 },
        then: "accept",
    },
    { if: { protocol: "udp", dst_port: { min: 33434, max: 33534 } }, then: "accept" },
    { if: { protocol: "icmp" }, then: "accept" },
    { if: { protocol: "esp" }, then: "accept" },
    { if: { protocol: "ah", family: "ipv4" }, then: "accept" },
    { if: { protocol: "gre" }, then: "accept" },
    { if: { protocol: "vrrp", family: "ipv4" }, then: "accept" },
    { if: { protocol: "ospf" }, then: "accept" },
    { description: "BGP", if: { protocol: "tcp", src_port: 179 }, then: "accept" },
    { if: { src: ["198.51.100.0/24", "2001:db8:bad::/48"] }, then: "drop" },
    { if: { dst_port: [53, 123] }, then: "accept" },
    { if: { protocol: "tcp", dst_port: { min: 0, max: 1023 } }, then: "accept" },
    {
        if: { protocol: "udp", src: "192.0.2.7/32", src_port: { min: 1024, max: 65535 }, dst: "203.0.113.0/25", dst_port: 123 },
        then: "drop",
    },
    { if: { protocol: "tcp", src: "2001:db8::/32", dst: "2001:db8:1::1/128", dst_port: 22 }, then: "accept" },
    { if: { family: "ipv6", protocol: "udp", dst_port: { min: 1024, max: 65535 } }, then: "accept" },
    { description: "Anything else", then: "drop" },
];

// What a CE6855 printed for these rules, committed with `commit trial` on a spare port.
const printed = [
    "acl name ctest-acl advance",
    " rule 5 permit tcp source 192.0.2.0 0.0.0.255 destination 198.51.100.1 0 destination-port eq 22",
    " rule 5 description Hosts reach the server",
    " rule 10 permit udp destination-port range 33434 33534",
    " rule 15 permit icmp",
    " rule 20 permit 50",
    " rule 25 permit 51",
    " rule 30 permit gre",
    " rule 35 permit 112",
    " rule 40 permit ospf",
    " rule 45 permit tcp source-port eq bgp",
    " rule 45 description BGP",
    " rule 50 deny ip source 198.51.100.0 0.0.0.255",
    " rule 55 permit tcp destination-port eq domain",
    " rule 60 permit tcp destination-port eq 123",
    " rule 65 permit udp destination-port eq dns",
    " rule 70 permit udp destination-port eq ntp",
    " rule 75 permit tcp destination-port lt 1024",
    " rule 80 deny udp source 192.0.2.7 0 source-port gt 1023 destination 203.0.113.0 0.0.0.127 destination-port eq ntp",
    " rule 85 deny ip",
    " rule 85 description Anything else",
    "#",
    "acl ipv6 name ctest-acl advance",
    " rule 5 permit udp destination-port range 33434 33534",
    " rule 10 permit icmpv6",
    " rule 15 permit ipv6-esp",
    " rule 20 permit gre",
    " rule 25 permit ospf",
    " rule 30 permit tcp source-port eq bgp",
    " rule 30 description BGP",
    " rule 35 deny ipv6 source 2001:DB8:BAD::/48",
    " rule 40 permit tcp destination-port eq domain",
    " rule 45 permit tcp destination-port eq 123",
    " rule 50 permit udp destination-port eq dns",
    " rule 55 permit udp destination-port eq ntp",
    " rule 60 permit tcp destination-port lt 1024",
    " rule 65 permit tcp source 2001:DB8::/32 destination 2001:DB8:1::1/128 destination-port eq 22",
    " rule 70 permit udp destination-port gt 1023",
    " rule 75 deny ipv6",
    " rule 75 description Anything else",
    "#",
];

test("a hardware ACL renders as the switch prints it, one ACL for each family", () => {
    const device = withAcl(rules);
    const rendered = vrp.render(device);

    expect(rendered).toContain(`${printed.join("\n")}\n`);
    expect(rendered).toContain(
        " storm control enable log\n traffic-filter acl ctest-acl inbound\n traffic-filter ipv6 acl ctest-acl inbound\n"
    );
    expect(vrp.unsupported(device)).toEqual([]);
    expect(vrp.experimental(device)).toEqual([]);
});

test("a port binds only the families its ACL has rules for, and a rule the other family can't match is left out", () => {
    const device = withAcl([{ if: { src: "192.0.2.0/24" }, then: "drop" }]);
    const rendered = vrp.render(device);

    expect(rendered).toContain("acl name ctest-acl advance\n rule 5 deny ip source 192.0.2.0 0.0.0.255\n#");
    expect(rendered).not.toContain("acl ipv6 name ctest-acl");
    expect(rendered).toContain(" traffic-filter acl ctest-acl inbound\n sflow");
    expect(rendered).not.toContain("traffic-filter ipv6");
});

test("a rule that repeats an earlier match is left out, since the switch refuses it and the earlier one decides", () => {
    const rendered = vrp.render(
        withAcl([
            { if: { protocol: "tcp", dst_port: 22 }, then: "accept" },
            { if: { protocol: "tcp", dst_port: [22, 443] }, then: "drop" },
            { if: { protocol: "tcp", dst_port: { min: 0, max: 65535 } }, then: "drop" },
        ])
    );

    expect(rendered).toContain(
        "acl name ctest-acl advance\n rule 5 permit tcp destination-port eq 22\n rule 10 deny tcp destination-port eq 443\n rule 15 deny tcp\n#"
    );
});

test("the switch's printed ACL and port plan nothing against the render", () => {
    const rendered = vrp.render(withAcl(rules));
    const port = rendered.slice(
        rendered.indexOf("interface 10GE1/0/1\n"),
        rendered.indexOf("#", rendered.indexOf("interface 10GE1/0/1\n")) + 1
    );
    const desired = `${printed.join("\n")}\n${port}\n`;
    // The port's filters as the switch printed them, each with a space after it.
    const current = desired.replace(/^( traffic-filter .*)$/gm, "$1 ");

    expect(rendered).toContain(port);
    expect(vrp.plan(desired, current, options).steps).toEqual([]);
});

test("a rule that changes is undone first, and its description is sent again", () => {
    const current = "acl name ctest-acl advance\n rule 5 permit tcp destination-port eq 22\n rule 5 description SSH\n rule 10 deny ip\n#\n";
    const desired =
        "acl name ctest-acl advance\n rule 5 permit tcp destination-port eq 443\n rule 5 description SSH\n rule 10 deny ip\n#\n";

    expect(sent(desired, current)).toEqual([
        "acl name ctest-acl advance",
        "undo rule 5",
        "rule 5 permit tcp destination-port eq 443",
        "rule 5 description SSH",
        "quit",
    ]);
});

test("a description changes in place, and goes with the rule it belongs to", () => {
    const current = "acl name ctest-acl advance\n rule 5 permit tcp destination-port eq 22\n rule 5 description SSH\n rule 10 deny ip\n#\n";

    expect(sent(current.replace("description SSH", "description Secure shell"), current)).toEqual([
        "acl name ctest-acl advance",
        "rule 5 description Secure shell",
        "quit",
    ]);
    expect(sent(current.replace(" rule 5 description SSH\n", ""), current)).toEqual([
        "acl name ctest-acl advance",
        "undo rule 5 description",
        "quit",
    ]);
    expect(sent("acl name ctest-acl advance\n rule 10 deny ip\n#\n", current)).toEqual([
        "acl name ctest-acl advance",
        "undo rule 5",
        "quit",
    ]);
});

test("an ACL a port lets go of is removed by its name after the port", () => {
    const current = [
        "acl name ctest-acl advance",
        " rule 5 deny ip",
        "#",
        "acl ipv6 name ctest-acl advance",
        " rule 5 deny ipv6",
        "#",
        "interface 10GE1/0/1",
        " traffic-filter acl ctest-acl inbound ",
        " traffic-filter ipv6 acl ctest-acl inbound ",
        "#",
    ].join("\n");

    expect(sent("interface 10GE1/0/1\n#\n", current)).toEqual([
        "interface 10GE1/0/1",
        "undo traffic-filter ipv6 acl ctest-acl inbound",
        "undo traffic-filter acl ctest-acl inbound",
        "quit",
        "undo acl ipv6 name ctest-acl",
        "undo acl name ctest-acl",
    ]);
});

test("what a traffic filter can't hold is refused", () => {
    const device = withAcl(
        [
            { if: { vlan: "servers", src: "192.0.2.0/24" }, then: "drop" },
            { if: { protocol: "tcp" }, then: "accept", rate: "10M" },
            { if: { protocol: "icmp", dst_port: 7 }, then: "drop" },
        ],
        { ethertypes: ["ipv4", "arp"] }
    );

    expect(vrp.unsupported(device)).toEqual([
        "switching.acls.ctest-acl[0].if.vlan, an IP ACL on the switch matches no VLAN",
        "switching.acls.ctest-acl[1].rate, a traffic filter only permits or denies",
        "switching.acls.ctest-acl[2].if, ports with protocol icmp: only TCP and UDP have ports",
        "interfaces.ethernet.10g-1.ingress_acl with ethertypes, which the switch filters with a layer 2 ACL of its own",
    ]);
});

test("a LAG member takes no ACL, and an ACL name the switch refuses is refused", () => {
    const device = withAcl([{ then: "drop" }]);
    const member: Device = {
        ...device,
        switching: { ...device.switching, acls: { "123": [{ then: "drop" }], "ctest-acl": [{ then: "drop" }] } },
        interfaces: {
            ...device.interfaces,
            ethernet: { ...device.interfaces!.ethernet, "40g-1": { ...device.interfaces!.ethernet!["40g-1"], ingress_acl: "ctest-acl" } },
        },
    };

    expect(vrp.unsupported(member)).toEqual([
        "switching.acls.123, a name the switch refuses: up to 32 characters, starting with a letter or digit",
        "interfaces.ethernet.40g-1.ingress_acl on a LAG member: the switch filters no port of a LAG",
    ]);
});

test("each firewall chain is refused with what stands in its way", () => {
    const chains: Device = {
        ...switchDevice,
        firewall: {
            address_sets: { monitoring: ["192.0.2.82/32"] },
            filter: { input: { rules: [] }, forward: { rules: [] }, output: { rules: [] } },
            tcp_mss: [{ mss: 1400 }],
        },
    };

    expect(vrp.unsupported(chains)).toEqual([
        "firewall.address_sets",
        "firewall.filter.input, V200R005 filters traffic to the switch only with a blacklist, which drops what it lists; management.allow guards SSH and SNMP",
        "firewall.filter.forward, the switch's traffic filter checks what it switches as well as what it routes: use switching.acls on the ports",
        "firewall.filter.output, the switch filters nothing it sends itself",
        "firewall.tcp_mss, which the platform does not build",
    ]);
});
