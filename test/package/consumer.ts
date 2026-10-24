// A project that uses the built package by its name, as npm installs it: `bun run check` compiles this against dist/types with `nodenext`, the strictest resolution. Each `@ts-expect-error` must fail, so a type that resolves to `any` fails the check.

import { Address, defineDevice, secret, type ModelName, type PlatformName, type PortName, type Prefix } from "@takodotid/circuit";
import { Bgp, Filters } from "@takodotid/circuit/helpers";

export default defineDevice({
    name: "tor-01",
    platform: "junos",
    model: "QFX5100-48S-6Q",
    connection: { host: "192.0.2.10", user: "admin" },
    users: { admin: { role: "admin", password: secret("TOR_PASSWORD") } },
    vlans: { servers: { id: 20 } },
    ports: { "10g-1": { access_vlan: "servers" } },
});

type TenantPorts<P extends PlatformName, M extends ModelName<P>> = Partial<Record<PortName<P, M>, string>>;
export const tenant: TenantPorts<"junos", "QFX5100-48S-6Q"> = { "10g-1": "Tenant A" };
// @ts-expect-error The model has no 10g-49.
export const missing: TenantPorts<"junos", "QFX5100-48S-6Q"> = { "10g-49": "Tenant B" };
// @ts-expect-error Not a prefix.
export const prefix: Prefix = "10.0.0.1";
export const wrong = defineDevice({
    name: "x",
    platform: "junos",
    // @ts-expect-error Not a model of that platform.
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "192.0.2.1", user: "admin" },
    users: { admin: { role: "admin", password: secret("X_PASSWORD") } },
});
export const sanity = Bgp.sanity();
export const spoof = Filters.antiSpoofing("servers", ["10.0.0.0/24"]);
export const inside: boolean = Address.contains("10.0.0.0/8", "10.1.0.0/16");
