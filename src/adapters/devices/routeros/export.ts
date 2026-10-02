// Reading an export into commands, and normalising both sides so that only a real difference survives a comparison.

import { network } from "../../../core/addr";

export type Command = {
    /** The menu the command belongs to, such as `/ip address`. */
    menu: string;
    verb: "add" | "set";
    /** What a `set` addresses: `[ find default-name=ether1 ]`, `ftp`, `1`, or nothing for a menu of one. */
    selector: string;
    /** Words without a value, such as `blackhole`. */
    flags: string[];
    /** Properties, unquoted and unescaped. */
    attrs: Record<string, string>;
};

export type Parsed = {
    commands: Command[];
    /** Address lists whose entries are filled by `refresh`, not by the render. */
    generated: Set<string>;
};

/** Undo the line wrapping an export applies: a backslash at the end of a line continues it. */
const unwrap = (text: string) => text.replace(/\r/g, "").replace(/\\\n\s*/g, "");

/** A quoted value without its quotes and escapes. `\_` is an escaped space. */
function unquote(value: string): string {
    if (!value.startsWith('"')) return value;

    return value.slice(1, -1).replace(/\\(.)/g, (_, escaped: string) => (escaped === "_" ? " " : escaped));
}

/** Split a command into words, keeping quoted values and bracketed selectors whole. */
function words(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    let bracketDepth = 0;

    for (let i = 0; i < line.length; i++) {
        const char = line[i]!;
        if (inQuotes) {
            current += char;
            if (char === "\\") current += line[++i] ?? "";
            else if (char === '"') inQuotes = false;
            continue;
        }

        if (char === '"') inQuotes = true;
        if (char === "[") bracketDepth++;
        if (char === "]") bracketDepth--;
        if (char === " " && bracketDepth === 0) {
            if (current) result.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    if (current) result.push(current);
    return result;
}

/** One `add` or `set` line into a command. */
function parseLine(menu: string, line: string): Command {
    const [verb, ...rest] = words(line) as ["add" | "set", ...string[]];

    let selector = "";
    const first = rest[0];
    if (verb === "set" && first && (first.startsWith("[") || !first.includes("="))) {
        selector = rest.shift()!.replace(/\s+/g, " ");
    }

    const flags: string[] = [];
    const attrs: Record<string, string> = {};
    // A property of the same group as the one before it is written `.name`, which only reads back inside its own command, so it is expanded here.
    let group = "";

    for (const word of rest) {
        const equals = word.indexOf("=");
        if (equals < 0) {
            flags.push(word);
            continue;
        }

        let name = word.slice(0, equals);
        if (name.startsWith(".")) name = group + name;
        else if (name.includes(".")) group = name.split(".")[0]!;
        attrs[name] = unquote(word.slice(equals + 1));
    }

    return { menu, verb, selector, flags, attrs };
}

export function parse(text: string): Parsed {
    const commands: Command[] = [];
    const generated = new Set<string>();
    let menu = "";

    for (const raw of unwrap(text).split("\n")) {
        const line = raw.trim();
        if (line.startsWith("/")) {
            menu = line;
            continue;
        }

        const marker = /^# generated (\S+)$/.exec(line);
        if (marker) generated.add(marker[1]!);
        if (menu && /^(add|set)( |$)/.test(line)) commands.push(parseLine(menu, line));
    }

    return { commands, generated };
}

/**
 * Values the platform holds when nothing was set, per menu, and under `*` for every menu.
 *
 * A property at its default is dropped from both sides of a comparison, and this is the value a property the config does not state is reset to. A property the device holds that is not here cannot be reset, which the plan reports as a problem.
 */
export const DEFAULTS: Record<string, Record<string, string>> = {
    "*": { disabled: "no", comment: "", instance: "default", "routing-table": "main", vrf: "main" },
    "/interface bridge": { "protocol-mode": "rstp", priority: "0x8000", "vlan-filtering": "no", pvid: "1" },
    "/interface bridge port": { pvid: "1", "frame-types": "admit-all", edge: "auto", "path-cost": "10", priority: "0x80" },
    "/interface bonding": { mode: "balance-rr", "transmit-hash-policy": "layer-2", mtu: "1500" },
    "/interface ethernet": { mtu: "1500", "auto-negotiation": "yes" },
    "/interface ethernet switch port": {
        "storm-rate": "100",
        "limit-broadcasts": "yes",
        "limit-unknown-multicasts": "no",
        "limit-unknown-unicasts": "no",
    },
    "/interface vlan": { "l3-hw-offloading": "yes", mtu: "1500" },
    "/interface vrrp": { priority: "100", "preemption-mode": "yes", interval: "1s", version: "3", "v3-protocol": "ipv4" },
    "/interface vxlan": { port: "4789" },
    "/interface wireguard peers": {
        "client-allowed-address": "",
        "endpoint-address": "",
        "endpoint-port": "0",
        "persistent-keepalive": "0s",
    },
    "/ipv6 address": { advertise: "yes" },
    "/ip dhcp-server": { "lease-time": "30m" },
    "/ip dns": { servers: "", "allow-remote-requests": "no" },
    "/ip service": { address: "", certificate: "none" },
    "/ip ssh": { "strong-crypto": "no" },
    "/ip traffic-flow": { enabled: "no", interfaces: "all", "packet-sampling": "no" },
    "/tool mac-server": { "allowed-interface-list": "all" },
    "/tool mac-server mac-winbox": { "allowed-interface-list": "all" },
    "/tool mac-server ping": { enabled: "yes" },
    "/tool bandwidth-server": { enabled: "yes" },
    "/ip neighbor discovery-settings": { "discover-interface-list": "!dynamic", protocol: "cdp,lldp,mndp" },
    "/snmp": { enabled: "no", contact: "", location: "" },
    "/snmp community": {
        addresses: "::/0",
        name: "public",
        security: "none",
        "authentication-protocol": "MD5",
        "encryption-protocol": "DES",
        "read-access": "yes",
        "write-access": "no",
    },
    "/ip settings": { "send-redirects": "yes", "tcp-syncookies": "no" },
    "/system clock": { "time-zone-autodetect": "yes", "time-zone-name": "manual" },
    "/system note": { note: "", "show-at-login": "yes" },
    "/system ntp client": { enabled: "no" },
    "/system ntp server": { enabled: "no" },
    "/system logging action": { "disk-file-count": "2", "disk-lines-per-file": "1000" },
    "/system package update": { channel: "stable" },
    "/system routerboard settings": { "enter-setup-on": "any-key" },
    "/interface ethernet switch": { "l3-hw-offloading": "no" },
    "/interface ethernet switch l3hw-settings": { autorestart: "no", "ipv6-hw": "no" },
};

/** Whether each `/ip service` ships disabled. */
const SERVICE_DISABLED: Record<string, string> = {
    ftp: "no",
    ssh: "no",
    telnet: "no",
    www: "no",
    "www-ssl": "yes",
    "reverse-proxy": "no",
    winbox: "no",
    api: "no",
    "api-ssl": "no",
};

/** Helpers of `/ip firewall service-port` that ship disabled. The rest ship enabled. */
const HELPER_DISABLED: Record<string, string> = { irc: "yes", rtsp: "yes" };

/** The default of one property of a command, or undefined when it is not known. */
export function defaultOf(command: Command, property: string): string | undefined {
    if (command.menu === "/ip service" && property === "disabled") return SERVICE_DISABLED[command.selector];

    if (command.menu === "/ip firewall service-port" && property === "disabled") return HELPER_DISABLED[command.selector] ?? "no";

    return DEFAULTS[command.menu]?.[property] ?? DEFAULTS["*"]![property];
}

/** A property the device stops printing once another returns to its default. Resetting that other one clears it, so it is never reset on its own. */
export const CLEARED_WITH: Record<string, Record<string, string>> = {
    "/interface ethernet": { speed: "auto-negotiation" },
};

/** Properties whose value cannot be read back from the device. They are compared only by the presence of what holds them. */
export const SECRET_KEYS = new Set(["private-key", "password", "tcp-md5-key", "authentication-password", "encryption-password"]);

/** How the renderer writes a secret. */
export const isSecretMarker = (value: string) => value.startsWith("<secret:");

/** A filter rule as the platform prints it, with its own spacing, squeezed so that only a real change survives. */
const canonicalRule = (rule: string) =>
    rule
        .replace(/\s*([=&|;{}(),<>!]+)\s*/g, "$1")
        .replace(/\s+/g, " ")
        .trim();

/** One property value in the form both sides compare in. */
function normalValue(command: Command, property: string, value: string): string {
    if (property === "rule") return canonicalRule(value);
    // A list whose order means nothing.
    if (property === "tagged" || property === "untagged" || property === "slaves") return value.split(",").sort().join(",");

    const onInterface = property === "address" && (command.menu === "/ip address" || command.menu === "/ipv6 address");
    const isAddress = /(^|-)address$/.test(property);
    // On an interface, a bare address is shorthand for /32 on IPv4 and /64 on IPv6.
    if (onInterface && !value.includes("/")) return `${value}/${value.includes(":") ? 64 : 32}`;
    // Elsewhere a host is printed bare on IPv4 and with /128 on IPv6.
    if (!onInterface && isAddress && /^[\d.]+\/32$/.test(value)) return value.slice(0, -3);

    if (!onInterface && isAddress && value.includes(":") && !value.includes("/") && !value.includes(",")) return `${value}/128`;

    return value;
}

/** A command's properties without defaults or secrets, in the form both sides compare in. */
export function normal(command: Command): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [property, raw] of Object.entries(command.attrs)) {
        if (SECRET_KEYS.has(property) || isSecretMarker(raw)) continue;

        const value = normalValue(command, property, raw);
        if (value === defaultOf(command, property)) continue;

        result[property] = value;
    }
    // The platform prints the network it derived from an address. Only a network it could not derive says something.
    if (command.menu === "/ip address" && result.network && result.address && network(result.address).split("/")[0] === result.network)
        delete result.network;
    return result;
}

/** Properties that tell two `add` entries of a menu apart. `name` where the menu is not listed. */
const IDENTITY: Record<string, string[]> = {
    "/interface wireguard peers": ["public-key"],
    "/interface list member": ["list", "interface"],
    "/ip firewall address-list": ["list", "address"],
    "/ipv6 firewall address-list": ["list", "address"],
    "/interface bridge port": ["interface"],
    "/interface bridge vlan": ["vlan-ids"],
    "/interface vxlan vteps": ["interface", "remote-ip"],
    "/routing bgp connection": ["remote.address"],
    "/routing rpki": ["address"],
    "/routing ospf interface-template": ["area", "interfaces"],
    "/routing bfd configuration": ["interfaces"],
    "/ip route": ["dst-address", "routing-table"],
    "/ipv6 route": ["dst-address", "routing-table"],
    "/ip address": ["address"],
    "/ipv6 address": ["address"],
    "/ip dhcp-server network": ["address"],
    "/ip dhcp-server lease": ["address"],
    "/ip traffic-flow target": ["dst-address", "port"],
    "/system ntp client servers": ["address"],
    "/system logging": ["action", "topics"],
    "/user ssh-keys": ["user", "key"],
};

/** What identifies an `add` entry, so that the same entry is found on both sides. */
export function identity(command: Command): Record<string, string> {
    // The switching bridge is the one that filters VLANs, whatever it is called, so a rename is a rename and not a rebuild of every port.
    if (command.menu === "/interface bridge" && command.attrs["vlan-filtering"] === "yes") return { "vlan-filtering": "yes" };

    const normalized = normal(command);
    const properties = IDENTITY[command.menu] ?? ["name"];
    const result: Record<string, string> = {};

    for (const property of properties) {
        const value = normalized[property] ?? command.attrs[property] ?? defaultOf(command, property) ?? "";
        result[property] = value;
    }

    return result;
}

/** Menus whose entries are an ordered list without names. They are rewritten whole, in the order the render gives. */
export const ORDERED = new Set([
    "/routing filter rule",
    "/ip firewall filter",
    "/ipv6 firewall filter",
    "/ip firewall nat",
    "/ipv6 firewall nat",
    "/ip firewall mangle",
    "/ipv6 firewall mangle",
    "/ip firewall raw",
    "/ipv6 firewall raw",
    "/interface bridge filter",
    "/interface ethernet switch rule",
]);

/** One command as a string that is equal for equal commands. */
export function canonical(command: Command): string {
    const properties = Object.entries(normal(command))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => `${name}=${value}`);
    const flags = [...command.flags].sort();
    return [command.verb, command.selector, ...flags, ...properties].filter(Boolean).join(" ");
}
