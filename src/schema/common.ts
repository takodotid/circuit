/**
 * A value kept out of the repository and resolved only when a device is applied.
 *
 * `secret("NAME")` reads a variable from the environment or `.env` beside the config; a value written as `op://vault/item/field` is read from 1Password. `secretFile("path")` reads a file, relative to the config file, for a value that spans lines such as a private key in PEM. Keep that file out of git.
 */
export type Secret =
    | {
          /** Name of the value in the environment or in `.env`. */
          readonly secret: string;
      }
    | {
          /** Path of the file with the value, relative to the config file. */
          readonly secret_file: string;
      };

/** An IPv4 address, four numbers with dots between them, for example `10.0.0.1`. The type checks the shape; `circuit validate` checks each number is 0 to 255. */
export type IPv4 = `${number}.${number}.${number}.${number}`;

/** An IPv6 address, groups with colons between them, for example `2001:db8::1`. The type only checks there is a colon; `circuit validate` checks the rest. */
export type IPv6 = `${string}:${string}`;

/** An address without a length, IPv4 or IPv6, for example `10.0.0.1` or `2001:db8::1`. */
export type IP = IPv4 | IPv6;

/** A network with its length, for example `10.0.0.0/24` or `2001:db8::/32`. */
export type Prefix = `${IP}/${number}`;

/** An interface address with its length, for example `10.0.0.1/24` or `2001:db8::1/64`. */
export type InterfaceAddress = `${IP}/${number}`;

/** A MAC address, six pairs of hex digits with colons between them, for example `02:00:00:00:00:01`. */
export type MacAddress = `${string}:${string}:${string}:${string}:${string}:${string}`;

/** An address family. */
export type Family = "ipv4" | "ipv6";

/** Bits per second, for example `2G`, `500M` or `64k`. */
export type Rate = `${number}${"k" | "M" | "G"}`;

/** A log severity, most severe first. A threshold includes everything above it. */
export type Severity = "emergency" | "alert" | "critical" | "error" | "warning" | "notice" | "info" | "debug";
