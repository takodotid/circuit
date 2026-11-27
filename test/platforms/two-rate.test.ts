// Rate limits with two rates (RFC 2698). No platform builds them yet, and each says why.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";

const TWO_RATES = { cir: "100M", bc: 1_250_000, pir: "200M", be: 2_500_000, exceed: { dscp: "af12" } } as const;

/** A device of `platform` with these interfaces, and a VLAN `hosts`. */
function device(platform: string, model: string, interfaces: object): Device {
    const written = {
        name: "edge-01",
        site: "lab",
        platform,
        model,
        connection: { host: "192.0.2.10", user: "netops" },
        system: { users: { root: { role: "admin", password: { secret: "ROOT" } } } },
        switching: { vlans: { hosts: { id: 10 } } },
        interfaces,
    };
    return written as Device;
}

const twoRates = (found: string[]) => found.filter((message) => message.includes("two rates"));

test("validate takes two rates with a burst each and the DSCP of what exceeds, and stops one that misses a part", () => {
    const sample = device("routeros", "CHR", {
        ethernet: {
            "virtual-2": { addresses: ["192.0.2.1/30"], rate_limit: { input: TWO_RATES } },
            "virtual-3": {
                addresses: ["198.51.100.1/30"],
                rate_limit: { input: { cir: "200M", bc: 0, pir: "100M", be: 1.5, exceed: { dscp: "af14" } } },
            },
            "virtual-4": { addresses: ["203.0.113.1/30"], rate_limit: { output: { cir: "100M", bc: 1000, pir: "200M" } } },
            "virtual-5": { addresses: ["203.0.113.5/30"], rate_limit: { output: { cir: "100M", bc: 1000, be: 2000 } } },
        },
    });

    const messages = Checks.run([sample], undefined).map((finding) => finding.message);
    expect(messages.filter((message) => message.includes("rate_limit") && !message.startsWith("routeros cannot"))).toEqual([
        "interfaces.ethernet.virtual-3.rate_limit.input.pir 100M is below cir, 200M: the peak rate is at least the committed one (RFC 2698)",
        "interfaces.ethernet.virtual-3.rate_limit.input.bc 0 is not a whole number of bytes above 0: RFC 2698 needs a burst for each rate",
        "interfaces.ethernet.virtual-3.rate_limit.input.be 1.5 is not a whole number of bytes above 0: RFC 2698 needs a burst for each rate",
        "interfaces.ethernet.virtual-4.rate_limit.output.be undefined is not a whole number of bytes above 0: RFC 2698 needs a burst for each rate",
        'interfaces.ethernet.virtual-4.rate_limit.output has no exceed: write { dscp: "af12" }, the DSCP of what passes between cir and pir',
        "interfaces.ethernet.virtual-5.rate_limit.output has be or exceed without pir: write pir, the peak rate, or leave them out",
        'interfaces.ethernet.virtual-3.rate_limit.input.exceed.dscp "af14" is no DSCP name. Did you mean af11?',
    ]);
});

test("each platform refuses two rates, with why", () => {
    const refusals = (platform: string, model: string, port: string, settings: object) =>
        twoRates(Platforms.get(platform).unsupported(device(platform, model, { ethernet: { [port]: settings } })));

    expect(refusals("routeros", "CHR", "virtual-2", { addresses: ["192.0.2.1/30"], rate_limit: { input: TWO_RATES } })).toEqual([
        "interfaces.ethernet.virtual-2.rate_limit.input, two rates: RouterOS has no policer with two rates (RFC 2698). A queue shapes, and the firewall's limit matcher polices one rate (TRAPS.md). Write one rate",
    ]);
    expect(refusals("fortios", "FG-3700D", "10g-28", { addresses: ["192.0.2.1/30"], rate_limit: { output: TWO_RATES } })).toEqual([
        "interfaces.ethernet.10g-28.rate_limit.output, two rates: a FortiGate's shaper marks what passes by the rate it measures, with no burst, not by RFC 2698's two buckets. Write one rate",
    ]);
    expect(refusals("junos", "QFX5100-48S-6Q", "10g-1", { access_vlan: "hosts", rate_limit: { input: TWO_RATES } })).toEqual([
        "interfaces.ethernet.10g-1.rate_limit.input, two rates: a QFX5100's two-rate policer gives what passes above cir a loss priority, and only a rewrite rule writes a DSCP by it, which rewrites every packet of each class. Write one rate",
    ]);
    expect(refusals("vrp", "CE6855-48S6Q-HI", "10g-1", { access_vlan: "hosts", rate_limit: { input: TWO_RATES } })).toEqual([
        "interfaces.ethernet.10g-1.rate_limit.input, two rates: a CE6855's CAR passes what exceeds with a service class and a color, not a DSCP. Write one rate",
    ]);
    expect(refusals("raisecom-ros", "RAX721-C-6C48", "10g-1", { access_vlan: "hosts", rate_limit: { input: TWO_RATES } })).toEqual([
        "interfaces.ethernet.10g-1.rate_limit.input, two rates: the switch polices them, but writes no DSCP on what exceeds, as a policer sets only a local priority. Write one rate",
    ]);
});
