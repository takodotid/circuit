// Every key of the language is written in some example project in examples/, so a new key comes with its example. The keys no example writes yet are in test/key-gaps.json, a list that may only shrink. A key experimental on every platform that has it needs no example: it is in KeyPaths.EXPERIMENTAL_EVERYWHERE.

import { expect, test } from "bun:test";
import { CHECKS, DEVICE, NETWORK } from "../../src/config/keys";
import { KeyPaths } from "../key-paths";

/** The keys of `circuit()`, with Circuit's checks and their settings. */
const SETTINGS = { ...NETWORK, checks: CHECKS };

const examples = await KeyPaths.examples();
const held = [
    ...examples.written.flatMap((device) => KeyPaths.held(device, DEVICE)),
    ...examples.settings.flatMap((settings) => KeyPaths.held(settings, SETTINGS)),
];
const written = new Set(held.map(({ path }) => path));
const keys = [...KeyPaths.all(SETTINGS), ...KeyPaths.all(DEVICE)];

test("an example writes every key", () => {
    const unwritten = keys.filter((path) => !written.has(path) && !KeyPaths.experimentalEverywhere(path));

    expect(
        KeyPaths.ratchet(KeyPaths.topmost(unwritten), "examples", "no example writes it. Write it in an example project in examples/.")
    ).toEqual([]);
});

test("each key experimental everywhere is a key that no example writes", () => {
    const wrong = Object.keys(KeyPaths.EXPERIMENTAL_EVERYWHERE).flatMap((path) => {
        if (!keys.includes(path)) return [`${path}: not a key. Take it out of KeyPaths.EXPERIMENTAL_EVERYWHERE.`];
        if ([...written].some((one) => one === path || KeyPaths.inside(one, path)))
            return [`${path}: an example writes it, so a platform has it tested. Take it out of KeyPaths.EXPERIMENTAL_EVERYWHERE.`];
        return [];
    });

    expect(wrong).toEqual([]);
});
