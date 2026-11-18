// Every key of the language is written in some example project in examples/, so a new key comes with its example. The keys no example writes yet are in test/key-gaps.json, a list that may only shrink.

import { expect, test } from "bun:test";
import { CHECKS, DEVICE, NETWORK } from "../../src/config/keys";
import { KeyPaths } from "../key-paths";

/** The keys of `circuit()`, with Circuit's checks and their settings. */
const SETTINGS = { ...NETWORK, checks: CHECKS };

test("an example writes every key", async () => {
    const examples = await KeyPaths.examples();
    const held = [
        ...examples.written.flatMap((device) => KeyPaths.held(device, DEVICE)),
        ...examples.settings.flatMap((settings) => KeyPaths.held(settings, SETTINGS)),
    ];
    const written = new Set(held.map(({ path }) => path));
    const unwritten = [...KeyPaths.all(SETTINGS), ...KeyPaths.all(DEVICE)].filter((path) => !written.has(path));

    expect(
        KeyPaths.ratchet(KeyPaths.topmost(unwritten), "examples", "no example writes it. Write it in an example project in examples/.")
    ).toEqual([]);
});
