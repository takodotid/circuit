export { defineDevice, defineNetwork, secret } from "./core/define";
export type { Check, Community, Finding, Network } from "./core/define";
export type * from "./schema";

/** Address helpers, for checks of your own. */
export { contains, familyOf, host, isAddress, isCidr, isGlobal, network as prefixOf } from "./core/addr";
