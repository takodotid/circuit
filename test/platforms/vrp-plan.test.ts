import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { LineDiff } from "../../src/platforms/line-diff";

// Seen on a CE6855 on V200R005 after its first SNMPv3 user: an engine ID of its own, and the user's own line before its settings.
test("a VRP SNMPv3 user plans nothing against how the switch prints it", () => {
    const adapter = Platforms.get("vrp");
    const wanted = "snmp-agent\nsnmp-agent usm-user v3 monitoring\nsnmp-agent usm-user v3 monitoring group circuit\n";
    const printed =
        "snmp-agent\nsnmp-agent local-engineid 800007DB03E8ABF39705B1\nsnmp-agent usm-user v3 monitoring\nsnmp-agent usm-user v3 monitoring group circuit\n";

    expect(adapter.plan(wanted, printed, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.show)).toEqual([]);
});

// A CE6855 prints each SNMPv3 key as `cipher %^%#...%^%#`, which can be turned back into the key.
test("a VRP read redacts SNMPv3 keys and plans nothing against the render for them", () => {
    const adapter = Platforms.get("vrp");
    const printed = LineDiff.scrub(
        [
            "snmp-agent usm-user v3 monitoring authentication-mode sha cipher %^%#Ab1:Cd2-Ef3%^%#",
            "snmp-agent usm-user v3 monitoring privacy-mode aes128 cipher %^%#Gh4:Ij5-Kl6%^%#",
        ].join("\n")
    );

    expect(printed).not.toContain("%^%#");
    expect(printed).toContain("authentication-mode sha cipher <redacted>");

    const wanted = [
        "snmp-agent usm-user v3 monitoring authentication-mode sha cipher <secret:EXAMPLE_SNMP_AUTH>",
        "snmp-agent usm-user v3 monitoring privacy-mode aes128 cipher <secret:EXAMPLE_SNMP_PRIVACY>",
    ].join("\n");
    expect(adapter.plan(wanted, printed, { secrets: false, rollback: 10 }).steps).toEqual([]);
});

// `ssh server cipher` lists algorithms, not a secret (seen on tako-mmr-02, 2026-10-24).
test("a VRP read keeps the SSH cipher list, and a change to it is planned", () => {
    const adapter = Platforms.get("vrp");
    expect(LineDiff.scrub("ssh server cipher aes256_ctr aes128_ctr")).toBe("ssh server cipher aes256_ctr aes128_ctr");

    const sent = adapter
        .plan("ssh server cipher aes256_ctr aes128_ctr\n", "ssh server cipher aes128_ctr\n", { secrets: false, rollback: 10 })
        .steps.flatMap((step) => step.send);
    expect(sent).toContain("ssh server cipher aes256_ctr aes128_ctr");
});

// CloudEngine refuses `undo ssh server key-exchange` with the algorithms after it.
test("removing an SSH algorithm list on VRP sends the undo without the algorithms", () => {
    const options = { secrets: false, rollback: 10 };
    const current = "ssh server hmac sha2_256 sha1\nssh server key-exchange dh_group_exchange_sha1 ecdh_sha2_nistp256\n";

    const sent = Platforms.get("vrp")
        .plan("", current, options)
        .steps.flatMap((step) => step.send);
    expect(sent).toEqual(expect.arrayContaining(["undo ssh server hmac", "undo ssh server key-exchange"]));
});
