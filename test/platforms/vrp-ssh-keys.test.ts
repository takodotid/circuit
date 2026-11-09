// A user's SSH key on VRP, as a CE6855 on V200R005 took it: RSA only, one per user, sent in lines of 200 and printed back in lines of
// 80 with `rsa-key` after it, before the lines that assign it, and let go of before it goes.

import { expect, test } from "bun:test";
import type { SshPublicKey } from "../../src/config/system";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("vrp");
const options = { secrets: false, rollback: 10 };
const switchDevice = Fixtures.device("platforms--example-core-switch");

// An RSA key of 4096 bits, as `ssh-keygen` writes it; made up for this test.
const blob = `AAAAB3NzaC1yc2EAAAADAQABAAACAQ${"Dexamplekeyforatest0123456789".repeat(24)}w==`;
const rsa: SshPublicKey = `ssh-rsa ${blob} alice@laptop`;

const withKeys = (ssh_keys: SshPublicKey[]): Device => {
    const users = switchDevice.system?.users ?? {};
    const [name] = Object.keys(users);
    if (!name) throw new Error("the example switch has no user");
    return { ...switchDevice, system: { ...switchDevice.system, users: { ...users, [name]: { ...users[name]!, ssh_keys } } } };
};

test("the key is written as the switch prints it, and assigned to its user, who logs in with it or the password", () => {
    const rendered = platform.render(withKeys([rsa]));
    const name = Object.keys(switchDevice.system?.users ?? {})[0];
    const text = `ssh-rsa ${blob}`;

    expect(rendered).toContain(`rsa peer-public-key ${name} encoding-type openssh\n public-key-code begin\n  ${text.slice(0, 80)}\n`);
    expect(rendered).toContain(
        `  ${text.slice(Math.floor((text.length - 1) / 80) * 80)} rsa-key\n public-key-code end\n peer-public-key end`
    );
    expect(rendered).not.toContain("alice@laptop");
    expect(rendered).toContain(`ssh user ${name} authentication-type all\nssh user ${name} assign rsa-key ${name}\n`);
});

test("a new key is sent whole first, in lines the CLI takes; one that goes is let go of, then removed", () => {
    const without = platform.render(withKeys([]));
    const keyed = platform.render(withKeys([rsa]));
    const name = Object.keys(switchDevice.system?.users ?? {})[0];

    const adding = platform.plan(keyed, without, options);
    const [first] = adding.steps;
    expect(first?.title).toBe(`SSH key ${name}`);
    expect(first?.send[0]).toBe(`rsa peer-public-key ${name} encoding-type openssh`);
    expect(first?.send.slice(2, -2).join("")).toBe(`ssh-rsa ${blob}`);
    expect(Math.max(...(first?.send ?? []).map((line) => line.length))).toBeLessThanOrEqual(200);
    expect(adding.steps.flatMap((step) => step.send)).toContain(`ssh user ${name} assign rsa-key ${name}`);

    const removing = platform.plan(without, keyed, options);
    const sent = removing.steps.flatMap((step) => step.send);
    expect(sent.indexOf(`undo ssh user ${name} assign rsa-key`)).toBeLessThan(sent.indexOf(`undo rsa peer-public-key ${name}`));

    expect(platform.plan(keyed, keyed, options).steps).toEqual([]);
});

test("a key the platform can't take is refused by name", () => {
    const name = Object.keys(switchDevice.system?.users ?? {})[0];
    const ed25519: SshPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFuIGV4YW1wbGUga2V5LCBuZXZlciBhIHJlYWwgb25l alice@laptop";

    expect(platform.unsupported(withKeys([ed25519]))).toContain(
        `system.users.${name}.ssh_keys[0], not RSA: the platform takes RSA keys only`
    );
    expect(platform.unsupported(withKeys([rsa, rsa]))).toContain(`system.users.${name}.ssh_keys, more than one: a user takes one key`);
    expect(platform.unsupported(withKeys([rsa])).filter((line) => line.includes("ssh_keys"))).toEqual([]);
});
