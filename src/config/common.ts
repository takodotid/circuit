// Shapes every group shares: secrets, addresses, ordered rules, lists in a match.

/**
 * A password, key or other value that is never written in plain text in the project. Circuit reads its value only when it connects to the device, such as for `diff` or `apply`.
 *
 * `secret("NAME")` reads a value from the network's secrets file (`.circuit/secrets` by default) or from the environment. You set it with `circuit secrets`. If the value is an `op://vault/item/field` reference, Circuit reads it from 1Password.
 *
 * `secretFile("path")` reads a file, with the path from the project root. Use it for a value of several lines, such as a private key in PEM. Keep that file out of git.
 */
export type Secret =
    | {
          /** The secret's name, as you set it with `circuit secrets set NAME`. */
          readonly secret: string;
      }
    | {
          /** Path of the file with the value, relative to the project root. */
          readonly secret_file: string;
      };

/** An IPv4 address, four numbers with dots between them, for example `192.0.2.1`. The editor checks the shape, and `circuit validate` checks that each number is 0 to 255. */
export type IPv4 = `${number}.${number}.${number}.${number}`;

/** An IPv6 address, groups with colons between them, for example `2001:db8::1`. The editor only checks that there is a colon, and `circuit validate` checks the rest. */
export type IPv6 = `${string}:${string}`;

/** An IPv4 or IPv6 address without a length, for example `192.0.2.1` or `2001:db8::1`. */
export type IP = IPv4 | IPv6;

/** A network with its length, for example `192.0.2.0/24` or `2001:db8::/32`. */
export type Prefix = `${IP}/${number}`;

/** An interface address with its length, for example `192.0.2.1/24` or `2001:db8::1/64`. */
export type InterfaceAddress = `${IP}/${number}`;

/**
 * One address, alone or with its length, such as `192.0.2.1` or `192.0.2.1/24`. A field for one host takes either, so you can reuse an address you wrote with its length, such as an interface's. Circuit writes only the address to the device.
 */
export type HostAddress = IP | InterfaceAddress;

/** A MAC address, six pairs of hex digits with colons between them, for example `02:00:00:00:00:01`. */
export type MacAddress = `${string}:${string}:${string}:${string}:${string}:${string}`;

/** An address family. */
export type Family = "ipv4" | "ipv6";

/** Bits per second, for example `2G`, `500M` or `64k`. */
export type Rate = `${number}${"k" | "M" | "G"}`;

/** A log severity, from most to least severe. A threshold also takes every more severe level. */
export type Severity = "emergency" | "alert" | "critical" | "error" | "warning" | "notice" | "info" | "debug";

/** A TCP or UDP port number, 1 to 65535. */
export type PortNumber = number;

/**
 * Rules in order. The first rule runs first. Write an ordered list whole, in one place: the device or one part. To add rules from other files, place them with `merge`, such as `merge([own_rule, tenants.rules.router_input, last_rule])`. If two places write the same list, Circuit stops and shows both.
 */
export type Ordered<Rule> = readonly Rule[];

/** One value, or a list of values. In a rule's match, a list matches any of its values. If the platform has no lists, Circuit writes one rule for each value. */
export type OneOrMore<T> = T | readonly T[];

/** Entries keyed by name, such as VLANs or policies. Each name here is declared by the device, so its other fields can use it. */
export type Named<K extends string, V> = { [N in K]?: V };
