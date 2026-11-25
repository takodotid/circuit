// IS-IS keys and BFD on a VRP VLAN interface, tried on a CE6855 on V200R005C00SPC800 with VLAN interfaces of VLANs no port carries. Circuit's plan was committed with `commit trial`, and the plan after it was empty. A change and the removal went into a candidate during the trial. `PRINTED` is what the switch printed, with each cipher shortened.

import { expect, test } from "bun:test";
import type { Device, Isis } from "../../src/model";
import { LineDiff } from "../../src/platforms/line-diff";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

/** A key for each level, a broadcast link with BFD, and IPv6 in a topology of its own. */
const perLevel: Isis = {
    net: "49.0001.1920.0000.2001.00",
    level_capability: "level-1-2",
    address_families: ["ipv4", "ipv6"],
    multi_topology: true,
    levels: {
        1: { authentication: { algorithm: "hmac-sha-256", key_id: 1, key: { secret: "ISIS_L1_KEY" } } },
        2: { authentication: { algorithm: "hmac-md5", key: { secret: "ISIS_L2_KEY" } } },
    },
    interfaces: { mgmt: { metric: 100, bfd: true } },
};

/** The single-site switch with this IS-IS, and BFD's timers. */
function routed(isis: Isis): Device {
    return { ...base, routing: { ...base.routing, bfd: { interval: 100, multiplier: 5 }, isis } };
}

/** The VLAN interface, the process, and BFD as the switch printed them, as the read hands them on. */
const PRINTED = LineDiff.scrub(`interface Vlanif10
 ipv6 enable
 ip address 192.168.10.2 255.255.255.0
 isis enable 1
 isis ipv6 enable 1
 isis authentication-mode hmac-sha256 key-id 1 cipher %^%#G>/l,A/PVD%^%# level-1
 isis authentication-mode md5 cipher %^%#;;'B=JM4Z1%^%# level-2
 isis ipv6 cost 100
 isis cost 100
 isis bfd enable
 isis bfd min-tx-interval 100 min-rx-interval 100 detect-multiplier 5
#
isis 1
 cost-style wide
 network-entity 49.0001.1920.0000.2001.00
 area-authentication-mode hmac-sha256 key-id 1 cipher %^%#DR[@70}Mf;%^%#
 domain-authentication-mode md5 cipher %^%#OA+h%4k}y4%^%#
 #
 ipv6 enable topology ipv6
 #
#
bfd
#
`);

/** The render with the VLAN interface, the process, and BFD as the switch printed them. */
const printed = (render: string) =>
    `${render
        .replace(/^interface Vlanif10\n[\s\S]*?^#\n/m, "")
        .replace(/^isis 1\n[\s\S]*?^#\n/m, "")
        .replace(/^bfd\n#\n/m, "")}${PRINTED}`;

test("VRP signs each level with its key, and each level's hellos, and runs BFD, as the switch prints them", () => {
    const desired = vrp.render(routed(perLevel));

    expect(desired).toContain(" area-authentication-mode hmac-sha256 key-id 1 cipher <secret:ISIS_L1_KEY>\n");
    expect(desired).toContain(" domain-authentication-mode md5 cipher <secret:ISIS_L2_KEY>\n");
    expect(desired).toContain(" isis authentication-mode md5 cipher <secret:ISIS_L2_KEY> level-2\n");
    expect(desired).toContain(" isis bfd enable\n isis bfd min-tx-interval 100 min-rx-interval 100 detect-multiplier 5\n");
    expect(PRINTED).not.toContain("%^%#");
    expect(vrp.plan(desired, printed(desired), options).steps).toEqual([]);
    expect(vrp.unsupported(routed(perLevel))).toEqual([]);
    expect(vrp.experimental(routed(perLevel))).toEqual([]);
});

test("VRP sends a level's new key over the old, and undoes a hello's key by its level", () => {
    const oneKey: Isis = {
        ...perLevel,
        levels: undefined,
        authentication: { algorithm: "hmac-sha-256", key_id: 0, key: { secret: "ISIS_KEY" } },
        interfaces: { mgmt: { metric: 200, network: "point-to-point" } },
    };

    // No interface runs BFD any more. The switch asks before it deletes BFD, and took this order in a candidate.
    expect(sent(vrp.render(routed(oneKey)), printed(vrp.render(routed(perLevel))))).toEqual([
        "undo bfd",
        "isis 1",
        "area-authentication-mode hmac-sha256 key-id 0 cipher <secret:ISIS_KEY>",
        "domain-authentication-mode hmac-sha256 key-id 0 cipher <secret:ISIS_KEY>",
        "quit",
        "interface Vlanif10",
        "undo isis bfd min-tx-interval 100 min-rx-interval 100 detect-multiplier 5",
        "undo isis bfd enable",
        "undo isis authentication-mode level-2",
        "undo isis authentication-mode level-1",
        "isis circuit-type p2p",
        "isis cost 200",
        "isis ipv6 cost 200",
        "isis authentication-mode hmac-sha256 key-id 0 cipher <secret:ISIS_KEY>",
        "quit",
    ]);

    // BFD goes once no interface runs it, and the switch asks first.
    expect(sent(vrp.render(base), printed(vrp.render(routed(perLevel))))).toEqual(
        expect.arrayContaining(["undo isis 1", "undo bfd", "undo isis authentication-mode level-1", "undo ipv6 enable"])
    );
});
