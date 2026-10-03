export { defineDevice, defineNetwork, secret, secretFile } from "./core/define";
export { merge } from "./core/merge";
export type { Check, Community, Finding, Network } from "./core/define";
export type * from "./schema";

/** Address helpers, for checks of your own. */
export { contains, familyOf, host, isAddress, isCidr, isGlobal, network as prefixOf } from "./core/addr";
