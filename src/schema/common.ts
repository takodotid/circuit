/** A value kept out of the repository and resolved by name when a device is applied. Create one with `secret("NAME")`. */
export type Secret = {
    /** Name of the value in the environment or in `.env.local`. */
    readonly secret: string;
};

/** An address without a length, IPv4 or IPv6, for example `10.0.0.1`. */
export type IP = string;

/** A network with its length, for example `10.0.0.0/24`. */
export type Prefix = string;

/** An interface address with its length, for example `10.0.0.1/24`. */
export type Address = string;

/** An address family. */
export type Family = "ipv4" | "ipv6";

/** Bits per second, for example `2G`, `500M` or `64k`. */
export type Rate = `${number}${"k" | "M" | "G"}`;

/** A log severity, most severe first. A threshold includes everything above it. */
export type Severity = "emergency" | "alert" | "critical" | "error" | "warning" | "notice" | "info" | "debug";
