// Reading an export into commands, and normalising both sides so that only a real difference survives a comparison.

import { createHash } from "node:crypto";
import { Address } from "../../core/address";

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

export class RouterOsExport {
    /**
     * Values the platform holds when nothing was set, per menu, and under `*` for every menu.
     *
     * A property at its default is dropped from both sides of a comparison, and this is the value a property the config does not state is reset to. A property the device holds that is not here cannot be reset, which the plan reports as a problem.
     */
    private static readonly DEFAULTS: Record<string, Record<string, string>> = {
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
        "/interface macvlan": { mode: "bridge", mtu: "1500" },
        "/interface vrrp": { priority: "100", "preemption-mode": "yes", interval: "1s", version: "3", "v3-protocol": "ipv4" },
        "/interface vxlan": { port: "4789" },
        "/interface wireguard peers": {
            "client-allowed-address": "",
            "endpoint-address": "",
            "endpoint-port": "0",
            "persistent-keepalive": "0s",
        },
        "/ipv6 address": { advertise: "yes" },
        // A blackhole route prints its distance, a route through a gateway doesn't (TRAPS.md).
        "/ip route": { distance: "1", "pref-src": "" },
        "/ipv6 route": { distance: "1" },
        "/routing bgp connection": { "use-bfd": "no" },
        // A timer never set prints nothing, and a session then runs at these. Set to them, it prints them.
        "/routing bfd configuration": { "min-rx": "200ms", "min-tx": "200ms", multiplier: "5" },
        "/ip dhcp-server": { "lease-time": "30m" },
        // As an RB5009 on 7.24.6 printed a client made with nothing but its interface.
        "/ip dhcp-client": {
            "add-default-route": "yes",
            "default-route-distance": "1",
            "default-route-tables": "default",
            "use-peer-dns": "yes",
            "use-peer-ntp": "yes",
            "check-gateway": "none",
            "allow-reconfigure": "no",
            "use-broadcast": "both",
            "dhcp-options": "hostname,clientid",
            script: "",
        },
        "/ip dns": { servers: "", "allow-remote-requests": "no" },
        "/ip service": { address: "", certificate: "none" },
        "/ip upnp": { enabled: "no" },
        // `yes-if-no-key` refuses the password of a user that has a key (RB5009, 7.24.6).
        "/ip ssh": { "strong-crypto": "no", "password-authentication": "yes-if-no-key" },
        "/ip traffic-flow": { enabled: "no", interfaces: "all", "packet-sampling": "no" },
        "/tool mac-server": { "allowed-interface-list": "all" },
        "/tool mac-server mac-winbox": { "allowed-interface-list": "all" },
        "/tool mac-server ping": { enabled: "yes" },
        "/tool bandwidth-server": { enabled: "yes" },
        // What `/tool sniffer reset` set them to on an RB5009 on 7.24.6.
        "/tool sniffer": { "filter-direction": "any", "filter-interface": "", "memory-limit": "100KiB" },
        // The default configuration of an RB5009 shares a USB disk on its bridge.
        "/disk settings": { "auto-media-interface": "none", "auto-media-sharing": "no", "auto-smb-sharing": "no" },
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
        "/system logging action": {
            "disk-file-count": "2",
            "disk-lines-per-file": "1000",
            "disk-file-name": "log",
            "memory-lines": "1000",
        },
        "/system package update": { channel: "stable" },
        "/system routerboard settings": { "enter-setup-on": "any-key" },
        "/interface ethernet switch": { "l3-hw-offloading": "no" },
        "/interface ethernet switch l3hw-settings": { autorestart: "no", "ipv6-hw": "no" },
    };

    /** Whether each `/ip service` ships disabled. */
    private static readonly SERVICE_DISABLED: Record<string, string> = {
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

    /**
     * Defaults of one entry addressed by a selector, where they differ from the menu's. RouterOS 7.24 prints the default neighbor discovery entry as `set [ find default=yes ] advertise-dns=yes`, under `# automatic dns option advertising is not started`, on a device nobody changed it on.
     */
    private static readonly SELECTOR_DEFAULTS: Record<string, Record<string, Record<string, string>>> = {
        "/ipv6 nd": { "[ find default=yes ]": { "advertise-dns": "yes" } },
    };

    /** Properties a newer RouterOS prints under another name, read as the name the render writes. RouterOS 7.24 prints a service's `address` as `available-from` and still takes `address`. */
    private static readonly RENAMED: Record<string, Record<string, string>> = { "/ip service": { "available-from": "address" } };

    /** Helpers of `/ip firewall service-port` that ship disabled. The rest ship enabled. */
    private static readonly HELPER_DISABLED: Record<string, string> = { irc: "yes", rtsp: "yes" };

    /** A property the device stops printing once another returns to its default. Resetting that other one clears it, so it is never reset on its own. */
    static readonly CLEARED_WITH: Record<string, Record<string, string>> = {
        "/interface ethernet": { speed: "auto-negotiation" },
    };

    /** Properties the device makes up for itself when an entry is created, such as an EoIP tunnel's random MAC. The plan leaves them as they are when the render doesn't state them. */
    static readonly GENERATED: Record<string, readonly string[]> = { "/interface eoip": ["mac-address"] };

    /** Properties whose value cannot be read back from the device. They are compared only by the presence of what holds them. */
    static readonly SECRET_KEYS = new Set(["private-key", "password", "tcp-md5-key", "authentication-password", "encryption-password"]);

    /** Properties that tell two `add` entries of a menu apart. `name` where the menu is not listed. */
    private static readonly IDENTITY: Record<string, string[]> = {
        "/interface list member": ["list", "interface"],
        "/ip firewall address-list": ["list", "address"],
        "/ipv6 firewall address-list": ["list", "address"],
        "/interface bridge port": ["interface"],
        "/interface bridge vlan": ["vlan-ids"],
        // One VLAN ID per interface: the device refuses a second, so a rename, such as one a MAC of its own brings, is a rename.
        "/interface vlan": ["interface", "vlan-id"],
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
        // The device keeps a key's fingerprint, never the key: both sides compare by it.
        "/user ssh-keys": ["user", "fingerprint"],
        "/ip upnp interfaces": ["interface"],
        // One client per interface.
        "/ip dhcp-client": ["interface"],
        "/ipv6 nd": ["interface"],
        "/ipv6 nd prefix": ["prefix", "interface"],
    };

    /** Menus whose entries are an ordered list without names. They are rewritten whole, in the order the render gives. */
    static readonly ORDERED = new Set([
        "/routing filter rule",
        "/routing rule",
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

    /** Undo the line wrapping an export applies: a backslash at the end of a line continues it. */
    private static unwrap(text: string): string {
        return text.replace(/\r/g, "").replace(/\\\n\s*/g, "");
    }

    /** A quoted value without its quotes and escapes. `\_` is an escaped space. */
    private static unquote(value: string): string {
        if (!value.startsWith('"')) return value;

        return value.slice(1, -1).replace(/\\(.)/g, (_, escaped: string) => (escaped === "_" ? " " : escaped));
    }

    /** Split a command into words, keeping quoted values and bracketed selectors whole. */
    private static words(line: string): string[] {
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
    private static parseLine(menu: string, line: string): Command {
        const [verb, ...rest] = RouterOsExport.words(line) as ["add" | "set", ...string[]];

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
            name = RouterOsExport.RENAMED[menu]?.[name] ?? name;
            if (name.startsWith(".")) name = group + name;
            else if (name.includes(".")) group = name.split(".")[0]!;
            attrs[name] = RouterOsExport.unquote(word.slice(equals + 1));
        }

        return { menu, verb, selector, flags, attrs };
    }

    static parse(text: string): Parsed {
        const commands: Command[] = [];
        const generated = new Set<string>();
        let menu = "";

        for (const raw of RouterOsExport.unwrap(text).split("\n")) {
            const line = raw.trim();
            if (line.startsWith("/")) {
                menu = line;
                continue;
            }

            const marker = /^# generated (\S+)$/.exec(line);
            if (marker) generated.add(marker[1]!);
            if (menu && /^(add|set)( |$)/.test(line)) commands.push(RouterOsExport.parseLine(menu, line));
        }

        return { commands, generated };
    }

    /** The default of one property of a command, or undefined when it is not known. */
    static defaultOf(command: Command, property: string): string | undefined {
        if (command.menu === "/ip service" && property === "disabled") return RouterOsExport.SERVICE_DISABLED[command.selector];

        if (command.menu === "/ip firewall service-port" && property === "disabled") {
            return RouterOsExport.HELPER_DISABLED[command.selector] ?? "no";
        }

        const ofSelector = RouterOsExport.SELECTOR_DEFAULTS[command.menu]?.[command.selector]?.[property];
        if (ofSelector !== undefined) return ofSelector;

        return RouterOsExport.DEFAULTS[command.menu]?.[property] ?? RouterOsExport.DEFAULTS["*"]![property];
    }

    /** How the renderer writes a secret. */
    static isSecretMarker(value: string): boolean {
        return value.startsWith("<secret:");
    }

    /** A filter rule as the platform prints it, with its own spacing, squeezed so that only a real change survives. */
    private static canonicalRule(rule: string): string {
        return rule
            .replace(/\s*([=&|;{}(),<>!]+)\s*/g, "$1")
            .replace(/\s+/g, " ")
            .trim();
    }

    /** One property value in the form both sides compare in. */
    private static normalValue(command: Command, property: string, value: string): string {
        if (property === "rule") return RouterOsExport.canonicalRule(value);
        // A list whose order means nothing.
        if (property === "tagged" || property === "untagged" || property === "slaves") return value.split(",").sort().join(",");

        const onInterface = property === "address" && (command.menu === "/ip address" || command.menu === "/ipv6 address");
        // An IP address property, which a MAC address is not.
        const isAddress = /(^|-)address$/.test(property) && !property.endsWith("mac-address");
        // On an interface, a bare address is shorthand for /32 on IPv4 and /64 on IPv6.
        if (onInterface && !value.includes("/")) return `${value}/${value.includes(":") ? 64 : 32}`;
        // Elsewhere a host is printed bare on IPv4 and with /128 on IPv6.
        if (!onInterface && isAddress && /^[\d.]+\/32$/.test(value)) return value.slice(0, -3);

        if (!onInterface && isAddress && value.includes(":") && !value.includes("/") && !value.includes(",")) return `${value}/128`;

        return value;
    }

    /** An OpenSSH public key's fingerprint as RouterOS prints it: SHA-256 of the key, base64 with its padding (RB5009, 7.24.6). */
    static fingerprint(key: string): string {
        const blob = key.trim().split(/\s+/)[1] ?? "";
        return `SHA256:${createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64")}`;
    }

    /** A command's properties without defaults or secrets, in the form both sides compare in. */
    static normal(command: Command): Record<string, string> {
        const result: Record<string, string> = {};

        for (const [property, raw] of Object.entries(command.attrs)) {
            if (command.menu === "/user ssh-keys" && property === "key") {
                result.fingerprint = RouterOsExport.fingerprint(raw);
                continue;
            }

            if (RouterOsExport.SECRET_KEYS.has(property) || RouterOsExport.isSecretMarker(raw)) continue;

            const value = RouterOsExport.normalValue(command, property, raw);
            if (value === RouterOsExport.defaultOf(command, property)) continue;

            result[property] = value;
        }
        // The platform prints the network it derived from an address. Only a network it could not derive says something.
        if (
            command.menu === "/ip address" &&
            result.network &&
            result.address &&
            Address.prefixOf(result.address).split("/")[0] === result.network
        )
            delete result.network;
        return result;
    }

    /** What identifies an `add` entry, so that the same entry is found on both sides. */
    static identity(command: Command): Record<string, string> {
        // The switching bridge is the one that filters VLANs, whatever it is called, so a rename is a rename and not a rebuild of every port.
        if (command.menu === "/interface bridge" && command.attrs["vlan-filtering"] === "yes") return { "vlan-filtering": "yes" };

        // A BFD configuration covers interfaces, or the addresses of multihop sessions, never both. A selector on a property that is not set matches nothing, so only the one that is set identifies it.
        const addresses = command.attrs.addresses;
        if (command.menu === "/routing bfd configuration" && addresses !== undefined) return { addresses };

        const normalized = RouterOsExport.normal(command);
        const properties = RouterOsExport.IDENTITY[command.menu] ?? ["name"];
        const result: Record<string, string> = {};

        for (const property of properties) {
            const value = normalized[property] ?? command.attrs[property] ?? RouterOsExport.defaultOf(command, property) ?? "";
            result[property] = value;
        }

        return result;
    }

    /**
     * What a selector finds an entry by: its identity, with an IPv4 route's host destination written as a prefix. `find` takes a prefix whole: `dst-address="192.0.2.82/32" and !dynamic` matches the route, `dst-address=192.0.2.82 and !dynamic` nothing, and so does a bare address on an interface (RB5009, 7.24.6). A selector nothing matches removes nothing, silently.
     */
    static selector(command: Command): Record<string, string> {
        const identity = RouterOsExport.identity(command);
        const destination = identity["dst-address"];
        if (command.menu === "/ip route" && destination && !destination.includes("/")) identity["dst-address"] = `${destination}/32`;
        return identity;
    }

    /** One command as a string that is equal for equal commands. */
    static canonical(command: Command): string {
        const properties = Object.entries(RouterOsExport.normal(command))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => `${name}=${value}`);
        const flags = [...command.flags].sort();
        return [command.verb, command.selector, ...flags, ...properties].filter(Boolean).join(" ");
    }
}
