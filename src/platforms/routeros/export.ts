// Reads the export from the device and into commands, and normalizes both sides so that only a real difference survives a comparison.

import { createHash } from "node:crypto";
import { Address } from "../../core/address";
import type { Device } from "../../model";

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
    /** Address lists from a registry that the render did not fetch, as Studio renders them. The plan keeps the entries the device holds. */
    generated: Set<string>;
    /** The device's ports, `# port ether4`, which the read lists for a virtual router. */
    ports: string[];
};

/** Where the export is read: over SSH, which can also fetch a file, or on the console. */
type Reader = {
    run(command: string, timeout?: number): Promise<string>;
    download?(path: string): Promise<Buffer>;
};

export class RouterOsExport {
    private static readonly READ_TIMEOUT_MS = 300_000;

    /** Printed after the export, in the same command. RouterOS stops SSH output at 2 MiB with no error, and `Ssh.exec` stops at its timeout, so an export without it is cut (TRAPS.md). */
    static readonly END = "# circuit: end of export";

    static readonly READ = `/export; :put "${RouterOsExport.END}"`;

    /** An export too large for SSH output is written to `<name>-<time>.rsc`, fetched over SFTP, and removed. */
    private static readonly FILE = "circuit-read";

    /** How the device refuses `/export file=` to a group without `ftp` and `write`, and SFTP to one without `ftp` (CHR, 7.24.6). */
    private static readonly NO_FILE_RIGHTS = /not enough permissions|Unable to start subsystem: sftp/;

    /** How much of the device's answer an error quotes. */
    private static readonly QUOTE_CHARS = 200;

    /** An IS-IS template's metric at each level, by its link type. */
    private static readonly ISIS_METRICS = ["ptp.l1.metric", "ptp.l2.metric", "bcast.l1.metric", "bcast.l2.metric"];

    /** A PPP profile's properties that `export verbose` prints as `!name` while they are not set (CHR, 7.24.6). */
    private static readonly PPP_PROFILE_UNSET = [
        "bridge",
        "bridge-horizon",
        "bridge-path-cost",
        "bridge-port-priority",
        "bridge-port-trusted",
        "bridge-port-vid",
        "dhcpv6-lease-time",
        "dhcpv6-use-radius",
        "dns-server",
        "idle-timeout",
        "incoming-filter",
        "insert-queue-before",
        "interface-list",
        "local-address",
        "outgoing-filter",
        "parent-queue",
        "queue-type",
        "rate-limit",
        "remote-address",
        "remote-ipv6-prefix-reuse",
        "session-timeout",
        "wins-server",
    ];

    /** A DHCPv6 client's properties that `export verbose` prints as `!name` while they are not set (CHR, 7.24.6). */
    private static readonly DHCPV6_CLIENT_UNSET = ["custom-iana-id", "custom-iapd-id", "pool-prefix-length"];

    /** A PPP profile's IPv6 pools, which `export verbose` leaves out while they are not set. `unset` refuses them, and an empty value clears them (CHR, 7.24.6). */
    private static readonly PPP_PROFILE_POOLS = ["dhcpv6-pd-pool", "remote-ipv6-prefix-pool"];

    /** The bits of an IPv6 address after a /64, its interface ID (RFC 4291). */
    private static readonly INTERFACE_ID_BITS = 64n;

    /**
     * Values the platform holds when nothing was set, per menu, and under `*` for every menu. A property at its default is dropped from both sides of a comparison. A property the config does not state is reset to it, and one without a default here is a problem in the plan.
     */
    private static readonly DEFAULTS: Record<string, Record<string, string>> = {
        "*": { disabled: "no", comment: "", instance: "default", "routing-table": "main", vrf: "main" },
        "/interface bridge": {
            "protocol-mode": "rstp",
            priority: "0x8000",
            "vlan-filtering": "no",
            pvid: "1",
            "dhcp-snooping": "no",
            "ra-guard": "no",
        },
        "/interface bridge port": {
            pvid: "1",
            "frame-types": "admit-all",
            edge: "auto",
            "path-cost": "10",
            priority: "0x80",
            "bpdu-guard": "no",
            "restricted-role": "no",
            trusted: "no",
            "trusted-ra": "no",
            horizon: "none",
            "tag-stacking": "no",
        },
        "/interface bonding": { mode: "balance-rr", "transmit-hash-policy": "layer-2", mtu: "1500" },
        // A VPLS interface is added disabled, and prints `disabled=no` once it runs (TRAPS.md). `pw-l2mtu` and `pw-control-word` set to these print them.
        "/interface vpls": { disabled: "yes", "pw-l2mtu": "1500", "pw-control-word": "default" },
        // A CHR prints `disable-running-check=no` on every port, as it ships. A RouterBOARD has no such property, so this changes nothing there (TRAPS.md).
        "/interface ethernet": { mtu: "1500", "auto-negotiation": "yes", "disable-running-check": "no" },
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
        "/interface wireguard": { mtu: "1420" },
        "/interface wireguard peers": {
            "client-allowed-address": "",
            "client-endpoint": "",
            "endpoint-address": "",
            "endpoint-port": "0",
            "persistent-keepalive": "0s",
        },
        "/ipv6 address": { advertise: "yes" },
        // As a CCR2216 on 7.24.6 printed an entry made with nothing but its interface.
        "/ipv6 nd": {
            "advertise-dns": "no",
            "advertise-mac-address": "yes",
            dns: "",
            "hop-limit": "unspecified",
            "managed-address-configuration": "no",
            mtu: "unspecified",
            "other-configuration": "no",
            "ra-delay": "3s",
            "ra-interval": "3m20s-10m",
            "ra-lifetime": "30m",
            "ra-preference": "medium",
            "reachable-time": "unspecified",
            "retransmit-interval": "unspecified",
        },
        "/ipv6 nd prefix": {
            "6to4-interface": "none",
            autonomous: "yes",
            "dhcp6-pd-preferred": "no",
            "on-link": "yes",
            "preferred-lifetime": "1w",
            "valid-lifetime": "4w2d",
        },
        // A blackhole route prints its distance, a route through a gateway doesn't (TRAPS.md).
        "/ip route": { distance: "1", "pref-src": "" },
        "/ipv6 route": { distance: "1" },
        "/routing bgp instance": { "cluster-id": "" },
        "/routing ospf instance": { version: "2" },
        "/routing ospf area": { "area-id": "0.0.0.0", type: "default", "default-cost": "" },
        // `unset` refuses a range's `advertise` and a template's `priority`, so the plan sets them back to these (TRAPS.md).
        "/routing ospf area range": { advertise: "yes" },
        "/routing ospf interface-template": {
            "hello-interval": "10s",
            "dead-interval": "40s",
            auth: "",
            "auth-id": "",
            priority: "128",
            type: "broadcast",
        },
        "/routing ospf static-neighbor": { "poll-interval": "2m", "instance-id": "0" },
        // A metric never set prints nothing, and the interface then runs at 20.
        "/routing isis interface-template": Object.fromEntries(RouterOsExport.ISIS_METRICS.map((property) => [property, ""])),
        // TTLs never set send 255 and accept any. They, `connect`, and `listen` cannot be unset (TRAPS.md).
        "/routing bgp connection": {
            "use-bfd": "no",
            "local.ttl": "255",
            "remote.ttl": "1",
            "output.default-originate": "never",
            connect: "yes",
            listen: "yes",
            "hold-time": "",
            "keepalive-time": "",
            "output.network": "",
            multihop: "",
            afi: "",
            "local.address": "",
            "input.limit-process-routes-ipv4": "",
            "input.limit-process-routes-ipv6": "",
        },
        // A VPN entry's lists print nothing until they are set.
        "/routing bgp vpn": {
            "export.redistribute": "",
            "export.route-targets": "",
            "import.route-targets": "",
            "export.filter-chain": "",
            "import.filter-chain": "",
        },
        // A timer never set prints nothing, and a session then runs at these. Set to them, it prints them.
        "/routing bfd configuration": { "min-rx": "200ms", "min-tx": "200ms", multiplier: "5" },
        "/ip dhcp-server": { "lease-time": "30m", "use-radius": "no" },
        // As a CHR on 7.24.6 printed them with `export verbose`.
        "/ip dhcp-server config": { accounting: "yes", "interim-update": "0s", "radius-password": "empty", "store-leases-disk": "5m" },
        // As a CHR on 7.24.6 printed them with `export verbose`. A PPPoE server is added disabled.
        "/interface pppoe-server server": {
            disabled: "yes",
            "accept-untagged": "yes",
            authentication: "pap,chap,mschap1,mschap2",
            "default-profile": "default",
            "keepalive-timeout": "10",
            "max-mru": "auto",
            "max-mtu": "auto",
            "max-sessions": "unlimited",
            mrru: "disabled",
            "one-session-per-host": "no",
            "pado-delay": "0",
            "pppoe-over-vlan-range": "",
            "service-name": "",
        },
        "/ppp profile": {
            "address-list": "",
            "bridge-learning": "default",
            "change-tcp-mss": "default",
            "on-down": "",
            "on-up": "",
            "only-one": "default",
            "use-compression": "default",
            "use-encryption": "default",
            "use-ipv6": "yes",
            "use-mpls": "default",
            "use-upnp": "default",
            ...Object.fromEntries(
                [...RouterOsExport.PPP_PROFILE_UNSET, ...RouterOsExport.PPP_PROFILE_POOLS].map((property) => [property, ""])
            ),
        },
        "/ppp aaa": {
            accounting: "yes",
            "enable-ipv6-accounting": "no",
            "interim-update": "0s",
            "use-circuit-id-in-nas-port-id": "no",
            "use-radius": "no",
        },
        // MikroTik's manual says 1700, but 7.24.6 listens on RFC 5176's 3799 (TRAPS.md).
        "/radius incoming": { accept: "no", port: "3799" },
        // As a CHR on 7.24.6 printed a queue with `export verbose`.
        "/queue simple": {
            "bucket-size": "0.1/0.1",
            "burst-limit": "0/0",
            "burst-threshold": "0/0",
            "burst-time": "0s/0s",
            "limit-at": "0/0",
            "max-limit": "0/0",
            "packet-marks": "",
            parent: "none",
            priority: "8/8",
            queue: "default-small/default-small",
        },
        // As a CHR on 7.24.6 printed a queue with `export verbose`.
        "/queue tree": {
            "bucket-size": "0.1",
            "burst-limit": "0",
            "burst-threshold": "0",
            "burst-time": "0s",
            "limit-at": "0",
            "max-limit": "0",
            "packet-mark": "",
            priority: "8",
            queue: "default-small",
        },
        // As a CCR2216 on 7.24.6 printed a server set back to them.
        "/ipv6 dhcp-server": { "address-pool": "static-only", "prefix-pool": "static-only", "lease-time": "3d", "dhcp-option": "" },
        // As a CHR on 7.24.6 printed a client made with its interface, `request=prefix`, and `pool-name`, with `export verbose`, and the distance `print detail` showed once it added a default route.
        "/ipv6 dhcp-client": {
            "accept-prefix-without-address": "yes",
            "add-default-route": "no",
            "allow-reconfigure": "no",
            "check-gateway": "none",
            "default-route-distance": "1",
            "default-route-tables": "default",
            "dhcp-options": "",
            disabled: "no",
            "prefix-address-lists": "",
            "prefix-hint": "::/0",
            "use-peer-dns": "yes",
            "validate-server-duid": "yes",
            ...Object.fromEntries(RouterOsExport.DHCPV6_CLIENT_UNSET.map((property) => [property, ""])),
        },
        // As a CHR on 7.24.6 printed a client made with its interface, name, user, and password, with `export verbose`, and a distance set back to 1. A client is added disabled.
        "/interface pppoe-client": {
            "ac-name": "",
            "add-default-route": "no",
            "default-route-distance": "1",
            allow: "pap,chap,mschap1,mschap2",
            "dial-on-demand": "no",
            disabled: "yes",
            "keepalive-timeout": "10",
            "max-mru": "auto",
            "max-mtu": "auto",
            mrru: "disabled",
            profile: "default",
            "service-name": "",
            "use-peer-dns": "no",
        },
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
        // A target prints neither its port nor its version while they are the defaults, which the plan matches targets by.
        "/ip traffic-flow target": { port: "2055", version: "9" },
        "/ip traffic-flow": {
            enabled: "no",
            interfaces: "all",
            "packet-sampling": "no",
            "active-flow-timeout": "30m",
            "inactive-flow-timeout": "15s",
        },
        // A probe added without a type is the older `simple` one (CHR, 7.24.6).
        "/tool netwatch": { type: "simple", interval: "10s", "src-address": "" },
        "/tool mac-server": { "allowed-interface-list": "all" },
        "/tool mac-server mac-winbox": { "allowed-interface-list": "all" },
        "/tool mac-server ping": { enabled: "yes" },
        "/tool bandwidth-server": { enabled: "yes", authenticate: "yes" },
        // What `/tool sniffer reset` set them to on an RB5009 on 7.24.6.
        "/tool sniffer": { "filter-direction": "any", "filter-interface": "", "memory-limit": "100KiB" },
        // The default configuration of an RB5009 shares a USB disk on its bridge.
        "/disk settings": { "auto-media-interface": "none", "auto-media-sharing": "no", "auto-smb-sharing": "no" },
        "/ip neighbor discovery-settings": { "discover-interface-list": "!dynamic", protocol: "cdp,lldp,mndp" },
        "/radius": { "authentication-port": "1812", "accounting-port": "1813", "src-address": "0.0.0.0" },
        "/user aaa": { "use-radius": "no", accounting: "yes", "default-group": "read", "exclude-groups": "", "interim-update": "0s" },
        // As a CCR2216 on 7.24.6 printed them with `export verbose`.
        "/snmp": {
            enabled: "no",
            contact: "",
            location: "",
            "trap-community": "public",
            "trap-generators": "temp-exception",
            "trap-interfaces": "",
            "trap-target": "",
            "trap-version": "1",
        },
        "/snmp community": {
            addresses: "::/0",
            name: "public",
            security: "none",
            "authentication-protocol": "MD5",
            "encryption-protocol": "DES",
            "read-access": "yes",
            "write-access": "no",
        },
        "/ip settings": { "rp-filter": "no", "send-redirects": "yes", "tcp-syncookies": "no" },
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

    /** Defaults of one entry addressed by a selector, where they differ from the menu's (TRAPS.md). */
    private static readonly SELECTOR_DEFAULTS: Record<string, Record<string, Record<string, string>>> = {
        "/ipv6 nd": { "[ find default=yes ]": { "advertise-dns": "yes" } },
        // The PPP profiles `default` and `default-encryption`, as the export addresses them.
        "/ppp profile": { "*0": { "change-tcp-mss": "yes" }, "*FFFFFFFE": { "change-tcp-mss": "yes", "use-encryption": "yes" } },
    };

    /** Properties RouterOS 7.24 prints under another name, read as the name the render writes (TRAPS.md). */
    private static readonly RENAMED: Record<string, Record<string, string>> = { "/ip service": { "available-from": "address" } };

    /** Helpers of `/ip firewall service-port` that ship disabled. The rest ship enabled. */
    private static readonly HELPER_DISABLED: Record<string, string> = { irc: "yes", rtsp: "yes" };

    /** A property the device stops printing once another returns to its default. Resetting that other one clears it, so it is never reset on its own. */
    static readonly CLEARED_WITH: Record<string, Record<string, string>> = {
        "/interface ethernet": { speed: "auto-negotiation" },
    };

    /** Properties the device makes up for itself when an entry is created, such as an EoIP tunnel's or a VPLS interface's random MAC. The plan leaves them as they are when the render doesn't state them. */
    static readonly GENERATED: Record<string, readonly string[]> = {
        "/interface eoip": ["mac-address"],
        "/interface vpls": ["mac-address"],
    };

    /** Properties the device clears only with `unset`: empty, it refuses them or takes them as another value (TRAPS.md). */
    static readonly UNSET: Record<string, readonly string[]> = {
        "/routing bgp instance": ["cluster-id"],
        "/routing bgp connection": [
            "hold-time",
            "keepalive-time",
            "output.network",
            "multihop",
            "afi",
            "local.address",
            "input.limit-process-routes-ipv4",
            "input.limit-process-routes-ipv6",
        ],
        // An empty `import.filter-chain` prints as `""` (CHR, 7.24.6).
        "/routing bgp vpn": [
            "export.redistribute",
            "export.route-targets",
            "import.route-targets",
            "export.filter-chain",
            "import.filter-chain",
        ],
        "/routing ospf area": ["default-cost"],
        "/routing ospf interface-template": ["auth", "auth-id"],
        "/routing isis interface-template": RouterOsExport.ISIS_METRICS,
        "/ppp profile": RouterOsExport.PPP_PROFILE_UNSET,
        "/ipv6 dhcp-client": RouterOsExport.DHCPV6_CLIENT_UNSET,
        // An empty one prints `src-address=""` (CHR, 7.24.6).
        "/tool netwatch": ["src-address"],
    };

    /** A secret the device takes only with another property: a template given `auth` without `auth-key` is refused (TRAPS.md). It is sent whenever that property changes. */
    static readonly SECRET_WITH: Record<string, Record<string, string>> = { "/routing ospf interface-template": { auth: "auth-key" } };

    /** Properties whose value cannot be read back from the device. They are compared only by the presence of what holds them. */
    static readonly SECRET_KEYS = new Set([
        "private-key",
        "password",
        "secret",
        "tcp-md5-key",
        "auth-key",
        "authentication-password",
        "encryption-password",
    ]);

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
        // Two VRFs may each have a neighbor at one address.
        "/routing bgp connection": ["remote.address", "vrf"],
        "/routing rpki": ["address"],
        "/routing ospf area range": ["area", "prefix"],
        "/routing ospf interface-template": ["area", "interfaces"],
        "/routing ospf static-neighbor": ["area", "address"],
        "/routing isis interface-template": ["instance", "interfaces"],
        "/routing bfd configuration": ["interfaces"],
        "/mpls interface": ["interface"],
        // One LDP instance per VRF.
        "/mpls ldp": ["vrf"],
        "/mpls ldp interface": ["interface"],
        // Several routes to one prefix in one table are told apart by their gateway (TRAPS.md). A blackhole route has none.
        "/ip route": ["dst-address", "routing-table", "gateway"],
        "/ipv6 route": ["dst-address", "routing-table", "gateway"],
        "/ip address": ["address"],
        "/ipv6 address": ["address"],
        "/ip dhcp-server network": ["address"],
        "/ip dhcp-server lease": ["address"],
        "/ip traffic-flow target": ["dst-address", "port"],
        // One interface may have several servers, each with its own service name.
        "/interface pppoe-server server": ["interface", "service-name"],
        "/system ntp client servers": ["address"],
        "/system logging": ["action", "topics"],
        // The device keeps a key's fingerprint, never the key: both sides compare by it.
        "/user ssh-keys": ["user", "fingerprint"],
        "/ip upnp interfaces": ["interface"],
        // One client per interface.
        "/ip dhcp-client": ["interface"],
        "/ipv6 dhcp-client": ["interface"],
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
        // RADIUS servers are asked in this order.
        "/radius",
        // The first label filter that holds a label's prefix decides.
        "/mpls ldp accept-filter",
        "/mpls ldp advertise-filter",
    ]);

    /** The whole export. A console reads until the prompt, so its export is whole. Over SSH, one that is cut is read again from a file. */
    static async read(reader: Reader, device: Device): Promise<string> {
        if (!reader.download) return reader.run("/export", RouterOsExport.READ_TIMEOUT_MS);

        const printed = await reader.run(RouterOsExport.READ, RouterOsExport.READ_TIMEOUT_MS);
        if (printed.endsWith(RouterOsExport.END)) return printed.slice(0, -RouterOsExport.END.length);

        try {
            return await RouterOsExport.readFile(reader, reader.download);
        } catch (error) {
            const reason = (error as Error).message;
            const role = RouterOsExport.NO_FILE_RIGHTS.test(reason)
                ? `. Writing the file and fetching it take the ftp and write policies: set system.users.${device.connection.user}.role to "admin"`
                : "";
            throw new Error(
                `${device.name}: the export over SSH stopped before its end, since RouterOS sends at most 2 MiB, and reading it from a file failed: ${reason}${role}`,
                { cause: error }
            );
        }
    }

    /** The export, written to a file on the device, fetched over SFTP, and removed. */
    private static async readFile(reader: Reader, download: (path: string) => Promise<Buffer>): Promise<string> {
        const name = `${RouterOsExport.FILE}-${Date.now()}`;
        const file = `${name}.rsc`;

        try {
            // The size prints once the file is written.
            const size = (await reader.run(`/export file=${name}; :put [/file get ${file} size]`, RouterOsExport.READ_TIMEOUT_MS)).trim();
            if (!/^\d+$/.test(size)) throw new Error(`/export file=${name} answered ${size.slice(0, RouterOsExport.QUOTE_CHARS)}`);

            const content = await download(file);
            if (content.length !== Number(size)) throw new Error(`SFTP gave ${content.length} of the file's ${size} bytes`);
            return content.toString("utf8");
        } finally {
            // A connection the device closed cannot remove it. The file holds no secret: an export leaves them out.
            await reader.run(`/file remove [find name="${file}"]`).catch(() => "");
        }
    }

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
            if (equals === -1) {
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
        const ports: string[] = [];
        let menu = "";

        for (const raw of RouterOsExport.unwrap(text).split("\n")) {
            const line = raw.trim();
            if (line.startsWith("/")) {
                menu = line;
                continue;
            }

            const marker = /^# generated (\S+)$/.exec(line);
            if (marker) generated.add(marker[1]!);
            const port = /^# port (\S+)$/.exec(line);
            if (port) ports.push(port[1]!);
            if (menu && /^(add|set)( |$)/.test(line)) commands.push(RouterOsExport.parseLine(menu, line));
        }

        return { commands, generated, ports };
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

    /** Whether a value is a secret, as the render writes one. */
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
    private static normalValue(command: Command, property: string, raw: string): string {
        if (property === "rule") return RouterOsExport.canonicalRule(raw);
        // A list whose order means nothing.
        if (property === "tagged" || property === "untagged" || property === "slaves") return raw.split(",").sort().join(",");

        // A route's gateway may name an interface, whose name stays as it is.
        const route = command.menu === "/ip route" || command.menu === "/ipv6 route";
        if (route && property === "gateway") return RouterOsExport.gateway(raw);

        // An IP address property, which a MAC address is not. A service's sources, an SNMP community's addresses, and a WireGuard peer's are a list, each item in one spelling.
        const isAddress = (/(^|-)address$/.test(property) && !property.endsWith("mac-address")) || property === "addresses";
        if (!isAddress) return raw;

        const onInterface = property === "address" && (command.menu === "/ip address" || command.menu === "/ipv6 address");
        if (onInterface && command.attrs["from-pool"]) return RouterOsExport.interfaceId(raw);
        return raw
            .split(",")
            .map((item) => RouterOsExport.address(item, onInterface))
            .join(",");
    }

    /** One address in one spelling, so one spelled otherwise is not another entry. The device prints `::ffff:0:0/96` as `::ffff:0.0.0.0/96` (TRAPS.md). */
    private static address(raw: string, onInterface: boolean): string {
        const value = Address.canonical(raw);
        // On an interface, a bare address is shorthand for /32 on IPv4 and /64 on IPv6.
        if (onInterface && !value.includes("/")) return `${value}/${value.includes(":") ? 64 : 32}`;
        if (onInterface) return value;
        // Elsewhere an IPv4 host compares bare and an IPv6 one with /128, however the menu prints it (TRAPS.md).
        if (/^[\d.]+\/32$/.test(value)) return value.slice(0, -3);
        if (value.includes(":") && !value.includes("/")) return `${value}/128`;

        return value;
    }

    /** An address from a pool by its interface ID, its last 64 bits. The device prints it as written while the pool is missing. Once the pool gives it a /64, it prints the part after the pool's prefix: `::1/64` is then `::1`, or `0:0:0:1::1` in the pool's second /64 (TRAPS.md). */
    private static interfaceId(raw: string): string {
        const [host = ""] = raw.split("/");
        const value = Address.toNumber(host);
        if (value === null || Address.family(host) !== "ipv6") return raw;
        return Address.fromNumber(value & ((1n << RouterOsExport.INTERFACE_ID_BITS) - 1n), "ipv6");
    }

    /** A route's gateway in one spelling: an address as `Address.canonical` writes it, and the interface after a `%`, as in `fe80::1%ether1`, as it is. An interface alone stays as it is. */
    private static gateway(value: string): string {
        const at = value.indexOf("%");
        if (at === -1) return Address.canonical(value);

        return `${Address.canonical(value.slice(0, at))}${value.slice(at)}`;
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

        // An address from a pool is known by its pool and its interface. Which /64 of the pool it holds can change, and with it what the device prints (TRAPS.md).
        const pool = command.attrs["from-pool"];
        if (command.menu === "/ipv6 address" && pool) return { "from-pool": pool, interface: command.attrs.interface ?? "" };

        const normalized = RouterOsExport.normal(command);
        const properties = RouterOsExport.IDENTITY[command.menu] ?? ["name"];
        const result: Record<string, string> = {};

        for (const property of properties) {
            const value = normalized[property] ?? command.attrs[property] ?? RouterOsExport.defaultOf(command, property) ?? "";
            result[property] = value;
        }

        return result;
    }

    /** What a selector finds an entry by: its identity, with an IPv4 route's host destination written as a prefix. `find` takes a prefix whole, so a bare host matches nothing, silently (TRAPS.md). */
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
