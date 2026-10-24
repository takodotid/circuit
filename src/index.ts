export { defineDevice, defineNetwork, secret, secretFile } from "./core/define";
export { Utils } from "./core/utils";
export type { Check, Community, Finding, NetBoxDevice, Network } from "./core/define";
export type * from "./schema";

/** The platforms, their models and each model's ports, for types of your own: `PortName<"junos", "QFX5100-48S-6Q">` is each port of that model, such as `"10g-1"` or `"40g-6"`. */
export type { ModelName, PlatformName, PortName } from "./platforms/catalog";

/** Address helpers, for checks of your own. */
export { Address } from "./core/address";

/** Secrets, for tools of your own: a secret's value, text with every secret hidden, and how Circuit logs in to a device. */
export { Secrets } from "./core/secrets";
