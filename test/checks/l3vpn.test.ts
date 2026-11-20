// What validate says about an L3VPN: the route distinguishers and route targets of each VRF (RFC 4364, RFC 4360, RFC 5668), and the sessions that carry VPN routes.

import { beforeAll, expect, test } from "bun:test";
import { DeviceChecks } from "../../src/checks/device";
import { L3vpnChecks } from "../../src/checks/l3vpn";
import type { Device, Neighbor } from "../../src/model";
import type { Vrf } from "../../src/config/routing";
import { Fixtures } from "../fixtures";

/** pe-01 of the MPLS core example, with its VRF bank and its VPN session to pe-02. */
let pe01: Device;

beforeAll(async () => {
    pe01 = (await Fixtures.example("mpls-core"))["pe-01"]!;
});

const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

/** pe-01 with these VRFs. */
const withVrfs = (vrfs: Record<string, Vrf>): Device => ({ ...pe01, routing: { ...pe01.routing, vrfs } });

/** pe-01 with its session to pe-02 changed. */
function withSession(settings: Partial<Neighbor>): Device {
    const bgp = pe01.routing!.bgp!;
    return { ...pe01, routing: { ...pe01.routing, bgp: { ...bgp, neighbors: { "pe-02": { ...bgp.neighbors!["pe-02"]!, ...settings } } } } };
}

test("a route distinguisher or target is an AS or an IPv4 address and a number that fit in 6 bytes together", () => {
    for (const fine of ["64500:101", "64500:4294967295", "4200000000:65535", "192.0.2.1:65535", "64500:0"])
        expect(L3vpnChecks.valueProblem(fine)).toBeUndefined();

    expect(L3vpnChecks.valueProblem("64500")).toBe(
        "is not a number after a colon: write an AS number or an IPv4 address, a colon, and a number, such as 64500:101"
    );
    expect(L3vpnChecks.valueProblem("4200000000:65536")).toBe(
        "has 65536 after AS4200000000, a 4-byte AS, where the number takes 2 bytes: write a number up to 65535"
    );
    expect(L3vpnChecks.valueProblem("192.0.2.1:70000")).toBe(
        "has 70000 after an IPv4 address, where the number takes 2 bytes: write a number up to 65535"
    );
    expect(L3vpnChecks.valueProblem("192.0.2.300:1")).toBe(
        "starts with 192.0.2.300, which is no IPv4 address: write an AS number or an IPv4 address, a colon, and a number, such as 64500:101"
    );
    expect(L3vpnChecks.valueProblem("0:1")).toBe(
        "starts with 0, which is no AS number from 1 to 4294967295: write an AS number or an IPv4 address, a colon, and a number, such as 64500:101"
    );
    expect(L3vpnChecks.valueProblem("64500:4294967296")).toBe("has 4294967296: write a number up to 4294967295");
});

test("each VRF in an L3VPN has a route distinguisher of its own and route targets, each written once", () => {
    expect(errors(pe01)).toEqual([]);

    expect(
        errors(
            withVrfs({
                bank: { route_targets: { import: ["64500:101"], export: ["64500:101"] } },
                school: { route_distinguisher: "64500:102" },
                guest: { route_distinguisher: "64500:102", route_targets: {} },
                shop: { route_distinguisher: "64500:103", route_targets: { import: ["64500:103", "64500:103"] } },
            })
        )
    ).toEqual([
        "routing.vrfs.bank has route_targets without route_distinguisher, which each of its VPN routes carries. Write one, such as 64500:101",
        'routing.vrfs.school has route_distinguisher without route_targets, so it takes and sends no VPN route. Write route_targets: { import: ["64500:102"], export: ["64500:102"] }, or remove route_distinguisher',
        "routing.vrfs.guest.route_distinguisher 64500:102 is VRF school's too, and it is what keeps their routes apart. Give each VRF its own",
        'routing.vrfs.guest.route_targets has no target. Write import, export, or both, such as { import: ["64500:101"], export: ["64500:101"] }',
        "routing.vrfs.shop.route_targets.import lists 64500:103 twice. Remove one",
    ]);

    const withoutBgp: Device = { ...pe01, routing: { ...pe01.routing, bgp: undefined } };
    expect(errors(withoutBgp)).toEqual([
        "routing.vrfs.bank is in an L3VPN, and BGP carries its routes. Write routing.bgp, with a neighbor whose address_families has vpnv4 or vpnv6",
    ]);
});

test("a session that carries VPN routes is iBGP, in the main table, from the LSR ID, over MPLS", () => {
    expect(errors(withSession({ remote_as: 64501 }))).toContain(
        "routing.bgp.neighbors.pe-02 carries vpnv4 to AS64501, another AS. Circuit carries VPN routes between the PEs of one AS: write them on an iBGP neighbor, remote_as 64500"
    );
    expect(errors(withSession({ local_address: "10.0.12.1" }))).toEqual([
        "routing.bgp.neighbors.pe-02 carries vpnv4 from 10.0.12.1, and the far PE sends the VRFs' traffic to that address, by the label LDP gives this router's LSR ID. Write local_address: \"10.255.0.1\"",
    ]);
    expect(errors(withSession({ local_address: undefined }))).toEqual([
        "routing.bgp.neighbors.pe-02 carries vpnv4 without local_address, and the far PE sends the VRFs' traffic to that address, by the label LDP gives this router's LSR ID. Write local_address: \"10.255.0.1\"",
    ]);
    expect(errors(withSession({ send_default_route: true }))).toEqual([
        "routing.bgp.neighbors.pe-02 carries vpnv4 only, and send_default_route sends an ipv4 or ipv6 default route. Remove send_default_route",
    ]);

    const withoutMpls: Device = { ...pe01, routing: { ...pe01.routing, mpls: undefined } };
    expect(errors(withoutMpls)).toContain(
        "routing.bgp.neighbors.pe-02 carries vpnv4 without routing.mpls, and traffic to a VPN route crosses the core by label. Write routing.mpls.ldp"
    );
});
