// Shapes every group shares: secrets, addresses, ordered rules, lists in a match.

/**
 * A value kept out of the repository and resolved only when a device is applied.
 *
 * `secret("NAME")` reads a secret from the network's secrets file, `.circuit/secrets`, set with `circuit secrets`, or from the environment; a value written as `op://vault/item/field` is read from 1Password. `secretFile("path")` reads a file, relative to the project root, for a value that spans lines such as a private key in PEM. Keep that file out of git.
 */
export type Secret =
    | {
          /** Name of the secret, as `circuit secrets set NAME` sets it. */
          readonly secret: string;
      }
    | {
          /** Path of the file with the value, relative to the project root. */
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

/**
 * One address, alone or with its length: `10.0.0.1` or `10.0.0.1/24`. A field that names one host takes either, so an address written
 * once with its length (on a site, for an interface) is used as it is. Circuit writes the address alone there.
 */
export type HostAddress = IP | InterfaceAddress;

/** A MAC address, six pairs of hex digits with colons between them, for example `02:00:00:00:00:01`. */
export type MacAddress = `${string}:${string}:${string}:${string}:${string}:${string}`;

/** An address family. */
export type Family = "ipv4" | "ipv6";

/** Bits per second, for example `2G`, `500M` or `64k`. */
export type Rate = `${number}${"k" | "M" | "G"}`;

/** A log severity, most severe first. A threshold includes everything above it. */
export type Severity = "emergency" | "alert" | "critical" | "error" | "warning" | "notice" | "info" | "debug";

/** A TCP or UDP port number, 1 to 65535. */
export type PortNumber = number;

/**
 * Rules where order decides: the first runs first. An ordered list is written whole in one place, the device or one part, and
 * places rules from other files where they go with `merge`: `merge([own_rule, tenants.rules.router_input, last_rule])`. The same list from two places
 * is an error naming both.
 */
export type Ordered<Rule> = readonly Rule[];

/** One value, or a list of them. In a rule's match, a list matches any of them: Circuit writes one rule for each, where the platform has no list of its own. */
export type OneOrMore<T> = T | readonly T[];

/** Entries keyed by name, such as VLANs or policies. A name written here is one the device declares: what its other fields may refer to. */
export type Named<K extends string, V> = { [N in K]?: V };
