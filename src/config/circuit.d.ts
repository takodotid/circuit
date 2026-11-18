// Circuit's functions, `presets` and `address`, declared as globals, so a project's files use them with no import. The project's tsconfig.json includes this file (Circuit writes both). Each is the same as index.ts gives, which Circuit puts on `globalThis` when it reads a project.

import type * as Circuit from "./index";

declare global {
    /**
     * Declare a network, in `circuit.ts` at the project's root: `export const as64500 = circuit({ asn, prefixes, sites, checks, integrations })`. Name it after its AS. Each device is `as64500.device({ name, include: [sources], ... })` in its own file under `sites/`, and its types come from the network. For several networks, write one `circuit()` for each.
     */
    const circuit: typeof Circuit.circuit;
    /** A part written in one file and used in another: `part("device", {...})`, or a rule list such as `part("filter", [...])`. */
    const part: typeof Circuit.part;
    /** Joins items into one list or one map, depending on the field it goes in. */
    const merge: typeof Circuit.merge;
    /** A value written once and kept as written. */
    const literal: typeof Circuit.literal;
    /** A secret, read by its name when Circuit connects to the device. */
    const secret: typeof Circuit.secret;
    /** A secret, read from a file when Circuit connects to the device. */
    const secretFile: typeof Circuit.secretFile;
    /** An address set Circuit fills with every BGP neighbor address of the device. */
    const bgpNeighbors: typeof Circuit.bgpNeighbors;
    /** Values every network writes the same way, each from a public standard. */
    const presets: typeof Circuit.presets;
    /** IP math for your own checks (RFC 4632, RFC 4291): `address.contains`, `.overlaps`, `.family`, `.host`, `.first`, `.last`. */
    const address: typeof Circuit.address;
}

export {};
