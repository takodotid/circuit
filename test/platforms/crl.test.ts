// A CA's list of revoked certificates (RFC 5280 §5), `crl_url`. RouterOS was proven on two CHRs with 7.24.6 (test/platforms/routeros-chr-ipsec.test.ts). FortiOS writes it from Fortinet's 6.2 reference.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Certificate, Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const URL = "http://pki.example.net/branch-ca.crl";
const options = { secrets: false, rollback: 10 };

/** A fixture's device with these certificates beside its own, each from the fixture's certificate file. */
function withCertificates(fixture: string, certificates: Record<string, Partial<Certificate>>): Device {
    const device = Fixtures.device(fixture);
    const file = Object.values(device.system?.certificates ?? {})[0]!.certificate_file;
    const added = Object.fromEntries(
        Object.entries(certificates).map(([name, certificate]) => [name, { certificate_file: file, ...certificate }])
    );
    return { ...device, system: { ...device.system, certificates: { ...device.system?.certificates, ...added } } };
}

test("RouterOS turns on downloading and checking lists, before it adds each CA's, and plans nothing against its own render", () => {
    const routeros = Platforms.get("routeros");
    const device = withCertificates("platforms--example-router", { "branch-ca": { crl_url: URL } });
    const desired = routeros.render(device);

    expect(desired).toContain(`/certificate settings\nset crl-download=yes crl-use=yes\n/certificate crl\nadd url=${URL}\n`);
    expect(routeros.plan(desired, desired, options)).toEqual({ steps: [], problems: [] });

    const current = routeros.render(Fixtures.device("platforms--example-router"));
    const titles = routeros.plan(desired, current, options).steps.map((step) => step.title);
    expect(titles.indexOf("/certificate settings")).toBeLessThan(titles.indexOf("/certificate crl"));
    expect(routeros.plan(current, desired, options).steps.flatMap((step) => step.send)).toEqual(
        expect.arrayContaining(["/certificate settings set crl-download=no crl-use=no", `/certificate crl remove [ find url="${URL}" ]`])
    );
});

test("RouterOS refuses a CA without a list beside one with a list, since it then refuses what the first signed", () => {
    const device = withCertificates("platforms--example-router", { "branch-ca": { crl_url: URL }, "syslog-ca": {} });

    expect(Platforms.get("routeros").unsupported(device)).toContain(
        "system.certificates.syslog-ca without crl_url beside a CA with one: RouterOS then refuses a certificate that points to the list of its CA, while it holds no list of that CA. Write crl_url here too"
    );
});

test("FortiOS writes a list's entry of the CA's name, from the vendor's documentation, and names it experimental", () => {
    const fortios = Platforms.get("fortios");
    const device = withCertificates("platforms--example-firewall", { "branch-ca": { crl_url: URL } });
    const desired = fortios.render(device);

    expect(desired).toContain(`config vpn certificate crl\n    edit "branch-ca"\n        set http-url "${URL}"\n    next\nend`);
    expect(fortios.experimental?.(device)).toContain("system.certificates.branch-ca.crl_url");
    expect(fortios.plan(desired, desired, options)).toEqual({ steps: [], problems: [] });
});

test("validate takes a list's URL on a CA's certificate only, over HTTP", () => {
    const device = withCertificates("platforms--example-router", {
        "branch-ca": { crl_url: "ldap://pki.example.net/cn=branch-ca" as `http://${string}` },
        "own-ca": { crl_url: URL, private_key: { secret: "OWN_CA_KEY" } },
    });
    const messages = Checks.run([device], undefined).map((finding) => finding.message);

    expect(messages).toEqual(
        expect.arrayContaining([
            "system.certificates.branch-ca.crl_url ldap://pki.example.net/cn=branch-ca is no HTTP URL: write it as http://host/path",
            "system.certificates.own-ca.crl_url beside a private key: write it on the certificate of the CA that publishes the list, without a private key",
        ])
    );
});
