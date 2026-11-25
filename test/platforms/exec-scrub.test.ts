// `circuit exec` prints what a command answers. A device's stored credentials stay hidden there, as in a read.

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";

test("VRP hides a reversible cipher on any line, also one a read doesn't know", () => {
    const vrp = Platforms.get("vrp");
    const output = [
        " isis authentication-mode hmac-sha256 key-id 5 cipher %^%#Ab1;cD2%^%#",
        " area-authentication-mode md5 cipher %^%#Ef3:gH4%^%#",
        "Key: %^%#Ij5.kL6%^%#",
    ].join("\n");

    const shown = vrp.scrubOutput!(output);
    expect(shown).not.toContain("%^%#");
    expect(shown).toContain("key-id 5 cipher <redacted>");
});

test("Junos hides a $9$ cipher and an encrypted password", () => {
    const junos = Platforms.get("junos");
    const output = [
        'set system login user netops authentication encrypted-password "$6$salt$hash"',
        'set protocols isis level 2 authentication-key "$9$AbCdEf"',
    ].join("\n");

    const shown = junos.scrubOutput!(output);
    expect(shown).not.toContain("$9$AbCdEf");
    expect(shown).not.toContain("$6$salt$hash");
});

test("FortiOS hides an ENC cipher and a key, also one over several lines", () => {
    const fortios = Platforms.get("fortios");
    const output = [
        "    set password ENC SH2nlSm9QL9tapcHPXIqAXvX7vBJuuqu",
        '    set private-key "-----BEGIN ENCRYPTED PRIVATE KEY-----',
        "MIIFHzBJBgkqhkiG9w0BBQ0wPDAbBgkqhkiG9w0BBQwwDgQI",
        '-----END ENCRYPTED PRIVATE KEY-----"',
        "    set comments ENCRYPTED is not a cipher",
    ].join("\n");

    const shown = fortios.scrubOutput!(output);
    expect(shown).toContain("set password ENC <redacted>");
    expect(shown).not.toContain("SH2nlSm9QL9tapcHPXIqAXvX7vBJuuqu");
    expect(shown).not.toContain("MIIFHzBJBgkqhkiG9w0BBQ0wPDAbBgkqhkiG9w0BBQwwDgQI");
    expect(shown).toContain("set comments ENCRYPTED is not a cipher");
});

test("Raisecom ROS hides an SNMPv3 user's localized keys", () => {
    const raisecom = Platforms.get("raisecom-ros");
    const shown = raisecom.scrubOutput!("snmp-server user netops authkey sha 0a1b2c3d privkey  aes128 4e5f6a7b\n");
    expect(shown).not.toContain("0a1b2c3d");
    expect(shown).not.toContain("4e5f6a7b");
});
