// Circuit puts these values on `globalThis` before it reads a project, and circuit.d.ts declares them for the editor, so a project never imports them. `lib/` may import the types: `import type { Prefix } from "circuit"`.

export { bgpNeighbors, circuit, literal, merge, part, secret, secretFile } from "./define";
export { presets } from "./presets";
export { address } from "./address";
export type * from "./address";
export type * from "./common";
export type * from "./communities";
export type * from "./device";
export type * from "./firewall";
export type * from "./interfaces";
export type * from "./management";
export type * from "./models";
export type * from "./monitoring";
export type * from "./network";
export type * from "./routing";
export type * from "./services";
export type * from "./switching";
export type * from "./system";
export type * from "./time-zones";
