// The services of a VRP switch, tried on a CE6855 on V200R005C00SPC800 with VLAN interfaces of VLANs no port carries and a VRF, committed with `commit trial`. The plan after each was empty, and a change and the removal went into a candidate. What the switch refused is refused here with what it said.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

test("a new VRF leaves the view its ipv4-family enters, so the next block is not sent into it", () => {
    const device: Device = { ...base, routing: { ...base.routing, vrfs: { ctest: {} } } };
    const lines = sent(vrp.render(device), vrp.render(base));
    const at = lines.indexOf("ip vpn-instance ctest");

    expect(lines.slice(at, at + 4)).toEqual(["ip vpn-instance ctest", "ipv4-family", "quit", "quit"]);
});

test("a CloudEngine answers no DNS queries for others, so VRP refuses a DNS server", () => {
    const device: Device = { ...base, services: { dns_server: true } };
    expect(vrp.unsupported(device)).toContain("services.dns_server, a CloudEngine answers no DNS queries for others");
});
