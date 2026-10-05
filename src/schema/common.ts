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
          /** Path of a file holding the value, relative to the config file. */
          readonly secret_file: string;
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
