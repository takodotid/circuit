// The neutral model as FortiOS configuration, in the form `show` prints, so the plan can compare the two section by section.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Helper, Severity } from "../../schema";
import { Catalog } from "../catalog";
import { FortiOsFirewall } from "./firewall";
import { FortiOsNames } from "./names";
import { FortiOsRouting } from "./routing";
import { FortiOsBlock, FortiOsTree } from "./tree";

export type Section = (typeof FortiOsRender.SECTIONS)[number];

type RoutedSettings = {
    addresses?: readonly (string | { address: string; peer: string })[];
    vrrp?: readonly { id: number; address: string; priority?: number; preempt?: boolean; interval?: number }[];
    lldp?: boolean;
    vrf?: string;
    ipv6_ra?: boolean;
};

export class FortiOsRender {
    /** Where the pre-login banner's text is kept. */
    static readonly BANNER = 'system replacemsg admin "pre_admin-disclaimer-text"';

    /** Every section Circuit manages, in the order a change goes in: what others name comes first. */
    static readonly SECTIONS = [
        "vpn certificate local",
        "vpn certificate ca",
        "system global",
        FortiOsRender.BANNER,
        "system settings",
        "system accprofile",
        "system admin",
        "system interface",
        "system gre-tunnel",
        "system vxlan",
        "system dns",
        "system dns-server",
        "system ntp",
        "system snmp sysinfo",
        "system snmp community",
        "system snmp user",
        "log memory setting",
        "log memory filter",
        "log disk setting",
        ...["", "2", "3", "4"].flatMap((number) => [`log syslogd${number} setting`, `log syslogd${number} filter`]),
        "system sflow",
        "system netflow",
        "system dhcp server",
        "router static",
        "router static6",
        "router prefix-list",
        "router prefix-list6",
        "router community-list",
        "router route-map",
        "router ospf",
        "router ospf6",
        "router bgp",
        "system session-helper",
        "firewall address",
        "firewall address6",
        "firewall addrgrp",
        "firewall addrgrp6",
        "firewall service custom",
        "firewall ippool",
        "firewall vip",
        "firewall policy",
        "firewall policy6",
        "firewall local-in-policy",
        "firewall local-in-policy6",
        "firewall central-snat-map",
        "firewall acl",
        "firewall acl6",
    ] as const;

    /** Sections `show` prints without what matters, which `show full-configuration` prints: a certificate's text. */
    static readonly FULL: readonly string[] = ["vpn certificate local", "vpn certificate ca"];

    /** The FortiOS zone number of each IANA zone it has one for. A number names a list of places in one zone; `00` is the device's default. */
    private static readonly ZONES: Record<string, readonly string[]> = {
        "00": ["Pacific/Kwajalein"],
        "01": ["Pacific/Midway", "Pacific/Pago_Pago"],
        "02": ["Pacific/Honolulu"],
        "03": ["America/Anchorage"],
        "04": ["America/Los_Angeles", "America/Vancouver", "America/Tijuana"],
        "05": ["America/Phoenix"],
        "06": ["America/Denver", "America/Edmonton"],
        "07": ["America/Guatemala", "America/Costa_Rica", "America/El_Salvador", "America/Tegucigalpa", "America/Managua"],
        "08": ["America/Chicago", "America/Winnipeg"],
        "09": ["America/Mexico_City"],
        "10": ["America/Regina"],
        "11": ["America/Bogota", "America/Lima", "America/Guayaquil"],
        "12": ["America/New_York", "America/Toronto"],
        "13": ["America/Indiana/Indianapolis"],
        "14": ["America/Halifax"],
        "15": ["America/La_Paz"],
        "16": ["America/Santiago"],
        "17": ["America/St_Johns"],
        "18": ["America/Sao_Paulo"],
        "19": ["America/Argentina/Buenos_Aires"],
        "20": ["America/Nuuk", "America/Godthab"],
        "21": ["Atlantic/South_Georgia"],
        "22": ["Atlantic/Azores"],
        "23": ["Atlantic/Cape_Verde"],
        "24": ["Africa/Monrovia"],
        "25": ["Europe/London", "Europe/Dublin", "Europe/Lisbon", "Atlantic/Canary"],
        "26": ["Europe/Amsterdam", "Europe/Berlin", "Europe/Zurich", "Europe/Rome", "Europe/Stockholm", "Europe/Vienna"],
        "27": ["Europe/Belgrade", "Europe/Bratislava", "Europe/Budapest", "Europe/Ljubljana", "Europe/Prague"],
        "28": ["Europe/Brussels", "Europe/Copenhagen", "Europe/Madrid", "Europe/Paris"],
        "29": ["Europe/Sarajevo", "Europe/Skopje", "Europe/Warsaw", "Europe/Zagreb"],
        "30": ["Africa/Lagos"],
        "31": ["Europe/Athens", "Europe/Sofia", "Europe/Vilnius"],
        "32": ["Europe/Bucharest"],
        "33": ["Africa/Cairo"],
        "34": ["Africa/Harare", "Africa/Johannesburg"],
        "35": ["Europe/Helsinki", "Europe/Riga", "Europe/Tallinn"],
        "36": ["Asia/Jerusalem"],
        "37": ["Asia/Baghdad"],
        "38": ["Asia/Kuwait", "Asia/Riyadh"],
        "39": ["Europe/Volgograd"],
        "40": ["Africa/Nairobi"],
        "41": ["Asia/Tehran"],
        "42": ["Asia/Dubai", "Asia/Muscat"],
        "43": ["Asia/Baku"],
        "44": ["Asia/Kabul"],
        "45": ["Asia/Yekaterinburg"],
        "46": ["Asia/Karachi", "Asia/Tashkent"],
        "47": ["Asia/Kolkata", "Asia/Calcutta"],
        "48": ["Asia/Kathmandu"],
        "49": ["Asia/Almaty", "Asia/Novosibirsk"],
        "50": ["Asia/Dhaka"],
        "51": ["Asia/Colombo"],
        "52": ["Asia/Yangon", "Asia/Rangoon"],
        "53": ["Asia/Jakarta", "Asia/Bangkok", "Asia/Ho_Chi_Minh"],
        "54": ["Asia/Krasnoyarsk"],
        "55": ["Asia/Shanghai", "Asia/Chongqing", "Asia/Hong_Kong", "Asia/Urumqi", "Asia/Irkutsk"],
        "56": ["Asia/Ulaanbaatar"],
        "57": ["Asia/Kuala_Lumpur", "Asia/Singapore"],
        "58": ["Australia/Perth"],
        "59": ["Asia/Taipei"],
        "60": ["Asia/Tokyo", "Asia/Seoul"],
        "61": ["Asia/Yakutsk"],
        "62": ["Australia/Adelaide"],
        "63": ["Australia/Darwin"],
        "64": ["Australia/Brisbane"],
        "65": ["Australia/Sydney", "Australia/Melbourne", "Australia/Canberra"],
        "66": ["Pacific/Guam", "Pacific/Port_Moresby"],
        "67": ["Australia/Hobart"],
        "68": ["Asia/Vladivostok"],
        "69": ["Asia/Magadan"],
        "70": ["Pacific/Guadalcanal", "Pacific/Noumea"],
        "71": ["Pacific/Auckland"],
        "72": ["Pacific/Fiji", "Asia/Kamchatka", "Pacific/Majuro"],
        "73": ["Pacific/Tongatapu"],
        "74": ["America/Caracas"],
        "75": ["America/Montevideo"],
        "76": ["Pacific/Kiritimati"],
        "77": ["America/Guyana"],
        "78": ["Africa/Windhoek"],
        "79": ["Africa/Casablanca"],
        "80": ["UTC", "Etc/UTC", "Etc/GMT", "GMT"],
        "81": ["America/Mazatlan", "America/Chihuahua"],
        "82": ["Pacific/Chatham"],
        "83": ["Europe/Moscow"],
        "84": ["Europe/Minsk"],
        "85": ["Europe/Istanbul"],
        "86": ["Pacific/Apia"],
        "87": ["America/Asuncion"],
    };

    /** What each role may do: the factory profile for an admin, and a profile Circuit adds for the others. */
    static readonly PROFILE = { admin: "super_admin", operator: "circuit-operator", "read-only": "circuit-read-only" } as const;

    /** The permission groups of an access profile. */
    private static readonly PERMISSION_GROUPS = [
        "secfabgrp",
        "ftviewgrp",
        "authgrp",
        "sysgrp",
        "netgrp",
        "loggrp",
        "fwgrp",
        "vpngrp",
        "utmgrp",
        "wanoptgrp",
        "wifi",
    ];

    /** The most public keys a user holds. */
    static readonly SSH_KEYS = 3;

    /** The most resolvers the device and a DHCP server hold, per family. */
    static readonly RESOLVERS = { device: 2, dhcp: 4 } as const;

    /** The most syslog collectors the device sends to. */
    static readonly COLLECTORS = 4;

    /** The most VRFs the device holds besides its default table. */
    static readonly VRFS = 31;

    /** A severity as the platform names it. */
    static readonly LEVEL: Record<Severity, string> = {
        emergency: "emergency",
        alert: "alert",
        critical: "critical",
        error: "error",
        warning: "warning",
        notice: "notification",
        info: "information",
        debug: "debug",
    };

    /** The helpers the factory runs, by the name a config gives them: protocol and port of each. */
    static readonly HELPERS: Partial<Record<Helper, readonly [string, number, number][]>> = {
        ftp: [["ftp", 6, 21]],
        tftp: [["tftp", 17, 69]],
        sip: [["sip", 17, 5060]],
        h323: [
            ["h323", 6, 1720],
            ["ras", 17, 1719],
        ],
        pptp: [["pptp", 6, 1723]],
        rtsp: [
            ["rtsp", 6, 554],
            ["rtsp", 6, 7070],
            ["rtsp", 6, 8554],
        ],
    };

    /** Speed by the platform's spelling, for each class a port's cage takes. */
    static readonly SPEEDS: Record<string, Partial<Record<string, string>>> = {
        "40g": { "40g": "40000full" },
        "10g": { "10g": "10000full", "1g": "1000full" },
        "1g": { "1g": "1000full", "100m": "100full" },
    };

    /** The management address of a device in transparent mode, which is reached only through its console: link-local, on no network it can reach. */
    static readonly TRANSPARENT_MANAGEIP = "169.254.0.1/255.255.255.255";

    /** The zone number for an IANA zone. UTC when the config names none. */
    static zoneOf(timezone = "UTC"): string | undefined {
        return Object.entries(FortiOsRender.ZONES).find(([, places]) => places.includes(timezone))?.[0];
    }

    /** The services a port or an interface answers on its addresses: ping always, and every management service the config turns on. */
    private static allowAccess(device: Device): string {
        const management = device.management ?? {};
        const services = ["ping"];

        if (management.https) services.push("https");
        if (management.ssh) services.push("ssh");
        if (management.snmp) services.push("snmp");
        if (management.http) services.push("http");
        if (management.telnet) services.push("telnet");
        if (management.native) services.push("fgfm");

        return services.join(" ");
    }

    /** The whole configuration the device should run, in the form `show` prints. */
    static of(device: Device): string {
        const root = new FortiOsBlock();
        for (const section of FortiOsRender.SECTIONS) root.block(section);

        const section = (name: Section) => root.block(name);

        FortiOsRender.certificates(section("vpn certificate local"), section("vpn certificate ca"), device);
        FortiOsRender.global(section("system global"), device);
        if (device.system?.banner) section(FortiOsRender.BANNER).set("buffer", FortiOsTree.quote(device.system.banner));
        // A bridge needs transparent mode, and transparent mode a management address: the config's, or one on no network the device can reach, which keeps it reached only through its console.
        if (FortiOsNames.isTransparent(device)) {
            const management = FortiOsNames.transparentManagement(device);
            const manageip = management
                ? `${Address.host(management.address)}/${Address.netmask(Address.split(management.address).len)}`
                : FortiOsRender.TRANSPARENT_MANAGEIP;
            section("system settings").set("opmode", "transparent").set("manageip", manageip);
        }
        if (FortiOsFirewall.natRules(device).length) section("system settings").set("central-nat", "enable");
        // SIP is otherwise rewritten by its proxy whatever the helpers say; this way only the `sip` helper does.
        section("system settings").set("default-voip-alg-mode", "kernel-helper-based");
        FortiOsRender.bfd(section("system settings"), device);
        FortiOsRender.users(section("system accprofile"), section("system admin"), device);
        FortiOsRender.interfaces(root, device);
        FortiOsRender.dns(section("system dns"), section("system dns-server"), device);
        FortiOsRender.ntp(section("system ntp"), device);
        FortiOsRender.snmp(root, device);
        FortiOsRender.logging(root, device);
        FortiOsRender.flowExport(root, device);
        FortiOsRender.dhcpServers(section("system dhcp server"), device);
        FortiOsRender.staticRoutes(section("router static"), section("router static6"), device);
        FortiOsRouting.render(root, device);
        FortiOsRender.helpers(section("system session-helper"), device);
        FortiOsFirewall.render(root, device);

        return FortiOsTree.print(root);
    }

    /** A certificate with its key is the device's own; one without is only trusted. */
    private static certificates(local: FortiOsBlock, trusted: FortiOsBlock, device: Device): void {
        for (const [name, certificate] of Object.entries(device.certificates ?? {})) {
            const text = FortiOsTree.quote(certificate.certificate.trim());

            if (certificate.private_key)
                local
                    .entry(name)
                    .set("private-key", FortiOsTree.quote(Secrets.marker(certificate.private_key)))
                    .set("certificate", text);
            else trusted.entry(name).set("ca", text);
        }
    }

    private static global(block: FortiOsBlock, device: Device): void {
        const management = device.management ?? {};

        block.set("hostname", FortiOsTree.quote(device.name));

        const zone = FortiOsRender.zoneOf(device.system?.timezone);
        if (zone && zone !== "00") block.set("timezone", zone);

        if (management.ssh?.port) block.set("admin-ssh-port", management.ssh.port);
        if (management.ssh?.auth_timeout) block.set("admin-ssh-grace-time", management.ssh.auth_timeout);
        if (management.ssh?.weak_crypto) block.set("strong-crypto", "disable");
        if (management.https?.port) block.set("admin-sport", management.https.port);
        if (management.https?.certificate) block.set("admin-server-cert", FortiOsTree.quote(management.https.certificate));
        if (management.http?.port) block.set("admin-port", management.http.port);
        if (management.telnet?.port) block.set("admin-telnet-port", management.telnet.port);
        // The web interface over HTTP otherwise only redirects to HTTPS.
        if (management.http) block.set("admin-https-redirect", "disable");
        if (device.system?.banner) block.set("pre-login-banner", "enable");

        if (device.lldp === true) block.set("lldp-transmission", "enable").set("lldp-reception", "enable");
    }

    /** Each user, with the profile its role takes. */
    private static users(profiles: FortiOsBlock, admins: FortiOsBlock, device: Device): void {
        const roles = new Set(Object.values(device.users ?? {}).map((user) => user.role));

        // An operator changes everything but the system's own settings, which hold the users; read-only changes nothing.
        for (const role of ["operator", "read-only"] as const) {
            if (!roles.has(role)) continue;

            const profile = profiles.entry(FortiOsRender.PROFILE[role]);
            for (const group of FortiOsRender.PERMISSION_GROUPS)
                profile.set(group, role === "operator" && group !== "sysgrp" ? "read-write" : "read");
        }

        for (const [name, user] of Object.entries(device.users ?? {})) {
            const admin = admins.entry(name);

            admin.set("accprofile", FortiOsTree.quote(FortiOsRender.PROFILE[user.role]));
            if (user.description) admin.set("comments", FortiOsTree.quote(user.description));
            admin.set("vdom", FortiOsTree.quote("root"));
            (user.ssh_keys ?? []).forEach((key, index) => admin.set(`ssh-public-key${index + 1}`, FortiOsTree.quote(key)));
            admin.set("password", FortiOsTree.quote(Secrets.marker(user.password)));
        }
    }

    /** Ports, then the LAGs they join, VLAN interfaces on them, loopbacks, and the tunnels with their own tables. */
    private static interfaces(root: FortiOsBlock, device: Device): void {
        const block = root.block("system interface");
        const access = FortiOsRender.allowAccess(device);

        for (const port of Catalog.ports(device.platform, device.model)) {
            const settings = device.ports?.[port as keyof typeof device.ports];
            const entry = block.entry(Catalog.spell(device.platform, device.model, port));

            entry.set("vdom", FortiOsTree.quote("root"));
            entry.set("type", "physical");

            if (!settings) {
                FortiOsRender.redirects(entry, device);
                entry.set("status", "down");
                continue;
            }

            if (settings.description) entry.set("description", FortiOsTree.quote(settings.description));

            const speed = settings.speed && FortiOsRender.SPEEDS[port.split("-")[0]!]?.[settings.speed];
            if (speed) entry.set("speed", speed);

            // A port in a LAG has no redirects of its own: `command parse error`.
            if (settings.lag) continue;

            FortiOsRender.redirects(entry, device);
            if (settings.mtu) entry.set("mtu-override", "enable").set("mtu", settings.mtu);
            FortiOsRender.routed(entry, device, port, settings, access);
        }

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "lag") continue;

            const members = Object.entries(device.ports ?? {})
                .filter(([, port]) => port?.lag === name)
                .map(([port]) => Catalog.spell(device.platform, device.model, port));

            const entry = block.entry(name);
            entry.set("vdom", FortiOsTree.quote("root"));
            entry.set("type", "aggregate");
            if (members.length) entry.set("member", FortiOsTree.quoteAll(members));
            if (iface.mode === "static") entry.set("lacp-mode", "static");
            if (iface.description) entry.set("description", FortiOsTree.quote(iface.description));
            if (iface.mtu) entry.set("mtu-override", "enable").set("mtu", iface.mtu);
            FortiOsRender.redirects(entry, device);
            FortiOsRender.routed(entry, device, name, iface, access);
        }

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "vlan") continue;

            const parent = FortiOsRender.vlanParent(device, iface.vlan);
            const entry = block.entry(name);
            entry.set("vdom", FortiOsTree.quote("root"));
            if (parent) entry.set("interface", FortiOsTree.quote(FortiOsNames.nameOf(device, parent)));
            entry.set("vlanid", device.vlans?.[iface.vlan]?.id ?? 0);
            const domain = FortiOsNames.forwardDomainOf(device, name);
            if (domain) entry.set("forward-domain", domain);
            if (iface.description) entry.set("description", FortiOsTree.quote(iface.description));
            if (iface.mtu) entry.set("mtu-override", "enable").set("mtu", iface.mtu);
            FortiOsRender.redirects(entry, device);
            FortiOsRender.routed(entry, device, name, iface, access);
        }

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "loopback") continue;

            const entry = block.entry(name);
            entry.set("vdom", FortiOsTree.quote("root"));
            entry.set("type", "loopback");
            if (iface.description) entry.set("description", FortiOsTree.quote(iface.description));
            FortiOsRender.redirects(entry, device);
            FortiOsRender.routed(entry, device, name, iface, access);
        }

        // A tunnel's interface is created by its own table, which names the interface it leaves through.
        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "gre" && iface.type !== "vxlan") continue;

            const outgoing = FortiOsNames.holderOf(device, iface.local);
            const via = outgoing ? FortiOsTree.quote(FortiOsNames.nameOf(device, outgoing)) : '""';

            // Between IPv6 endpoints the family is stated first: the addresses of the other family are not settings until it is.
            const ipv6 = Address.family(iface.remote) === "ipv6";

            if (iface.type === "gre") {
                const tunnel = root.block("system gre-tunnel").entry(name).set("interface", via);
                if (ipv6) tunnel.set("ip-version", 6).set("remote-gw6", iface.remote).set("local-gw6", iface.local);
                else tunnel.set("remote-gw", iface.remote).set("local-gw", iface.local);
            } else {
                const tunnel = root.block("system vxlan").entry(name).set("interface", via).set("vni", iface.vni);
                if (ipv6) tunnel.set("ip-version", "ipv6-unicast").set("remote-ip6", FortiOsTree.quote(iface.remote));
                else tunnel.set("remote-ip", FortiOsTree.quote(iface.remote));
                if (iface.port !== undefined && iface.port !== 4789) tunnel.set("dstport", iface.port);
            }

            const entry = block.entry(name);
            entry.set("vdom", FortiOsTree.quote("root"));
            entry.set("type", iface.type === "gre" ? "tunnel" : "vxlan");
            entry.set("interface", via);
            if (iface.type === "vxlan" && iface.mac) entry.set("macaddr", iface.mac.toLowerCase());
            if (iface.description) entry.set("description", FortiOsTree.quote(iface.description));
            if (iface.mtu) entry.set("mtu-override", "enable").set("mtu", iface.mtu);
            FortiOsRender.redirects(entry, device);
            FortiOsRender.routed(entry, device, name, iface, access);
        }
    }

    /** The platform sends ICMP redirects unless an interface says otherwise; the config sends them only when asked. */
    private static redirects(entry: FortiOsBlock, device: Device): void {
        if (!device.system?.ip?.icmp_redirects) entry.set("icmp-send-redirect", "disable");
    }

    /** The one port or LAG that carries a VLAN tagged, which its VLAN interface sits on. `unsupported()` refuses any other case. */
    static vlanParent(device: Device, vlan: string): string | undefined {
        const carriers = [
            ...Object.entries(device.ports ?? {}).filter(([, port]) => !port?.lag && port?.trunk_vlans?.includes(vlan)),
            ...Object.entries(device.interfaces ?? {}).filter(([, iface]) => iface.type === "lag" && iface.trunk_vlans?.includes(vlan)),
        ];

        return carriers.length === 1 ? carriers[0]![0] : undefined;
    }

    /** Addresses and their routing table, the services answered on them, VRRP, DHCP relay, router advertisements, LLDP and flow sampling of a port or an interface. */
    private static routed(entry: FortiOsBlock, device: Device, name: string, settings: RoutedSettings, access: string): void {
        // In transparent mode no interface holds an address: the management address is the device's, and answers on its interface alone.
        if (FortiOsNames.isTransparent(device)) {
            if (FortiOsNames.transparentManagement(device)?.name === name) entry.set("allowaccess", access);
            return;
        }

        // Services answer only where the config says, when it says; ping everywhere.
        const answering = device.management?.interfaces;
        if (answering && !answering.includes(name)) access = "ping";

        const addresses = FortiOsNames.addressesOf(settings);
        const ipv4 = addresses.filter((address) => Address.family(Address.host(address)) === "ipv4");
        const ipv6 = addresses.filter((address) => Address.family(Address.host(address)) === "ipv6");

        const vrf = FortiOsNames.vrfNumber(device, settings.vrf);
        if (vrf) entry.set("vrf", vrf);

        // A tunnel holds an IPv4 address as a host and its peer with the link's mask.
        const peer = settings.addresses?.find((item): item is { address: string; peer: string } => typeof item !== "string");

        if (peer) {
            entry.set("ip", `${Address.host(peer.address)} 255.255.255.255`);
            entry.set("remote-ip", `${peer.peer} ${Address.netmask(Address.split(peer.address).len)}`);
            entry.set("allowaccess", access);
        } else if (ipv4.length) {
            entry.set("ip", FortiOsNames.subnet(ipv4[0]!));
            entry.set("allowaccess", access);
        }

        if (!peer && ipv4.length > 1) {
            entry.set("secondary-IP", "enable");
            const secondaries = entry.block("secondaryip");
            ipv4.slice(1).forEach((address, index) =>
                secondaries
                    .entry(index + 1)
                    .set("ip", FortiOsNames.subnet(address))
                    .set("allowaccess", access)
            );
        }

        const relays = Object.values(device.dhcp_relay ?? {}).filter((relay) => relay.interface === name);
        const relayed = relays.flatMap((relay) => relay.servers);
        const relayed4 = relayed.filter((server) => Address.family(server) === "ipv4");
        const relayed6 = relayed.filter((server) => Address.family(server) === "ipv6");

        if (ipv6.length || relayed6.length) {
            const block = entry.block("ipv6");

            if (ipv6.length) {
                block.set("ip6-address", ipv6[0]!);
                block.set("ip6-allowaccess", access);
            }

            if (settings.ipv6_ra) {
                block.set("ip6-send-adv", "enable");
                const prefixes = block.block("ip6-prefix-list");
                for (const address of ipv6) prefixes.entry(FortiOsNames.network(address), true);
            }

            if (relayed6.length) block.set("dhcp6-relay-service", "enable").set("dhcp6-relay-ip", relayed6.join(" "));

            if (ipv6.length > 1) {
                const extra = block.block("ip6-extra-addr");
                for (const address of ipv6.slice(1)) extra.entry(address, true);
            }
        }

        if (settings.vrrp?.length) {
            const groups = entry.block("vrrp");

            for (const group of settings.vrrp) {
                const vrrp = groups.entry(group.id).set("vrip", group.address);
                if (group.priority !== undefined && group.priority !== 100) vrrp.set("priority", group.priority);
                if (group.interval !== undefined && group.interval !== 1) vrrp.set("adv-interval", group.interval);
                // The platform preempts unless told not to; the config preempts only when asked.
                if (!group.preempt) vrrp.set("preempt", "disable");
            }
        }

        if (relayed4.length) {
            entry.set("dhcp-relay-service", "enable");
            entry.set("dhcp-relay-ip", FortiOsTree.quoteAll(relayed4));
        }

        // LLDP follows the device unless a port says otherwise, or the device lists where it runs.
        const listed = typeof device.lldp === "object" && device.lldp.interfaces.includes(name as never);
        if (settings.lldp === false) entry.set("lldp-transmission", "disable").set("lldp-reception", "disable");
        else if (listed || (settings.lldp === true && device.lldp !== true))
            entry.set("lldp-transmission", "enable").set("lldp-reception", "enable");

        // A tunnel is not sampled: its traffic is, on the interface it leaves through.
        const flow = device.flow_export;
        const tunnel = ["gre", "vxlan"].includes(device.interfaces?.[name]?.type ?? "");
        const sampled = flow && !tunnel && (!flow.interfaces || flow.interfaces.includes(name as never));

        if (sampled && flow.protocol === "sflow") {
            entry.set("sflow-sampler", "enable");
            if (flow.sampling !== undefined && flow.sampling !== 2000) entry.set("sample-rate", flow.sampling);
        }

        if (sampled && flow.protocol === "netflow-v9") entry.set("netflow-sampler", "both");
    }

    /** The device's resolvers, and the interfaces it answers DNS queries on when it serves them. */
    private static dns(block: FortiOsBlock, servers: FortiOsBlock, device: Device): void {
        const resolvers = device.system?.dns?.servers ?? [];
        const ipv4 = resolvers.filter((server) => Address.family(server) === "ipv4");
        const ipv6 = resolvers.filter((server) => Address.family(server) === "ipv6");

        if (ipv4[0]) block.set("primary", ipv4[0]);
        if (ipv4[1]) block.set("secondary", ipv4[1]);
        if (ipv6[0]) block.set("ip6-primary", ipv6[0]);
        if (ipv6[1]) block.set("ip6-secondary", ipv6[1]);

        // Recursive, the default mode, answers from what the device has resolved itself.
        if (device.system?.dns?.serve) for (const name of FortiOsNames.addressed(device)) servers.entry(FortiOsNames.nameOf(device, name));
    }

    /** The servers the device keeps time from, and the interfaces it answers time queries on when it serves them. */
    private static ntp(block: FortiOsBlock, device: Device): void {
        const ntp = device.system?.ntp;
        const servers = ntp?.servers ?? [];

        if (servers.length) {
            block.set("ntpsync", "enable");
            block.set("type", "custom");

            const list = block.block("ntpserver");
            servers.forEach((server, index) => list.entry(index + 1).set("server", FortiOsTree.quote(server)));
        }

        if (ntp?.serve) {
            block.set("server-mode", "enable");
            block.set("interface", FortiOsTree.quoteAll(FortiOsNames.addressed(device).map((name) => FortiOsNames.nameOf(device, name))));
        }
    }

    /** SNMP version 2c with one community, guarded by its hosts, and version 3 users. */
    private static snmp(root: FortiOsBlock, device: Device): void {
        const snmp = device.management?.snmp;
        if (!snmp) return;

        const sysinfo = root.block("system snmp sysinfo");
        sysinfo.set("status", "enable");
        if (snmp.contact) sysinfo.set("contact-info", FortiOsTree.quote(snmp.contact));
        if (snmp.location) sysinfo.set("location", FortiOsTree.quote(snmp.location));

        if (snmp.community) {
            const community = root.block("system snmp community").entry(1);
            community.set("name", FortiOsTree.quote(Secrets.marker(snmp.community)));

            const allow = snmp.allow ?? device.management?.allow ?? [];
            const ipv4 = allow.filter((prefix) => Address.family(Address.host(prefix)) === "ipv4");
            const ipv6 = allow.filter((prefix) => Address.family(Address.host(prefix)) === "ipv6");
            ipv4.forEach((prefix, index) =>
                community
                    .block("hosts")
                    .entry(index + 1)
                    .set("ip", FortiOsNames.subnet(FortiOsNames.network(prefix)))
            );
            ipv6.forEach((prefix, index) =>
                community
                    .block("hosts6")
                    .entry(index + 1)
                    .set("ipv6", FortiOsNames.network(prefix))
            );

            // Version 2c only, and no traps: the config has nowhere to send them.
            community.set("query-v1-status", "disable");
            if (snmp.port) community.set("query-v2c-port", snmp.port);
            community.set("trap-v1-status", "disable");
            community.set("trap-v2c-status", "disable");
        }

        for (const [name, user] of Object.entries(snmp.users ?? {})) {
            const entry = root.block("system snmp user").entry(name);
            entry.set("security-level", "auth-priv");
            if (snmp.port) entry.set("query-port", snmp.port);
            // SHA1 and AES128 are the platform's defaults and are not printed.
            entry.set("auth-pwd", FortiOsTree.quote(Secrets.marker(user.auth_password)));
            if (user.privacy === "des") entry.set("priv-proto", "des");
            entry.set("priv-pwd", FortiOsTree.quote(Secrets.marker(user.privacy_password)));
        }
    }

    /** Logs kept in memory from a level up, none on disk, and up to four syslog collectors, each with the least severe message it takes. */
    private static logging(root: FortiOsBlock, device: Device): void {
        const logging = device.system?.logging;

        // The device prints whether it keeps logs in memory either way, and keeps them unless told not to.
        root.block("log memory setting").set("status", logging?.local ? "enable" : "disable");
        if (logging?.local && logging.local.level !== "info")
            root.block("log memory filter").set("severity", FortiOsRender.LEVEL[logging.local.level]);

        // The disk keeps logs unless told not to; the config keeps them only in memory.
        root.block("log disk setting").set("status", "disable");

        (logging?.remote ?? []).slice(0, FortiOsRender.COLLECTORS).forEach((collector, index) => {
            const number = index === 0 ? "" : String(index + 1);
            const setting = root.block(`log syslogd${number} setting`);
            setting.set("status", "enable");
            setting.set("server", FortiOsTree.quote(collector.address));
            if (collector.port && collector.port !== 514) setting.set("port", collector.port);

            if (collector.level !== "info") root.block(`log syslogd${number} filter`).set("severity", FortiOsRender.LEVEL[collector.level]);
        });
    }

    /** One collector, and sampling on each interface it observes. */
    private static flowExport(root: FortiOsBlock, device: Device): void {
        const flow = device.flow_export;
        const collector = flow?.collectors[0];
        if (!flow || !collector) return;

        if (flow.protocol === "sflow") {
            const block = root.block("system sflow").set("collector-ip", collector.address);
            if (collector.port && collector.port !== 6343) block.set("collector-port", collector.port);
        }

        if (flow.protocol === "netflow-v9") {
            const block = root.block("system netflow").set("collector-ip", collector.address);
            if (collector.port && collector.port !== 2055) block.set("collector-port", collector.port);
        }
    }

    private static dhcpServers(block: FortiOsBlock, device: Device): void {
        Object.values(device.dhcp ?? {}).forEach((server, index) => {
            const entry = block.entry(index + 1);
            if (server.lease_time !== undefined && server.lease_time !== 604800) entry.set("lease-time", server.lease_time);
            entry.set("default-gateway", server.gateway);
            entry.set("netmask", Address.netmask(Address.split(server.network).len));
            entry.set("interface", FortiOsTree.quote(FortiOsNames.nameOf(device, server.interface)));
            entry.set("dns-service", "specify");
            entry.block("ip-range").entry(1).set("start-ip", server.pool[0]).set("end-ip", server.pool[1]);

            (server.reservations ?? []).forEach((reservation, number) => {
                const reserved = entry.block("reserved-address").entry(number + 1);
                reserved.set("ip", reservation.address).set("mac", reservation.mac.toLowerCase());
                if (reservation.description) reserved.set("description", FortiOsTree.quote(reservation.description));
            });

            (server.dns ?? []).forEach((resolver, number) => entry.set(`dns-server${number + 1}`, resolver));
        });
    }

    /** Each route by its position. A route goes in the routing table of the interface it leaves through. A default route is the platform's default destination and is not printed. */
    private static staticRoutes(ipv4: FortiOsBlock, ipv6: FortiOsBlock, device: Device): void {
        const counters = { ipv4: 0, ipv6: 0 };

        for (const route of device.routing?.static ?? []) {
            const family = Address.family(Address.split(route.prefix).addr);
            const entry = (family === "ipv4" ? ipv4 : ipv6).entry(++counters[family]);
            const prefix = FortiOsNames.network(route.prefix);

            if (family === "ipv6" && prefix !== "::/0") entry.set("dst", prefix);
            if (family === "ipv4" && prefix !== "0.0.0.0/0") entry.set("dst", FortiOsNames.subnet(prefix));

            if (route.via) entry.set("gateway", route.via);

            // In transparent mode a route names no interface: it carries only the management address's own traffic.
            const outgoing = route.interface ?? (route.via ? FortiOsNames.interfaceFor(device, route.via, route.vrf) : undefined);
            if (outgoing && !route.blackhole && !FortiOsNames.isTransparent(device))
                entry.set("device", FortiOsTree.quote(FortiOsNames.nameOf(device, outgoing)));

            if (route.distance !== undefined && route.distance !== 10) entry.set("distance", route.distance);
            if (route.description) entry.set("comment", FortiOsTree.quote(route.description));
            if (route.blackhole) entry.set("blackhole", "enable");
            if (route.bfd) entry.set("bfd", "enable");
        }
    }

    /** BFD runs once a route or a session uses it, or the config sets its timers, which the device shows only while it runs. */
    private static bfd(settings: FortiOsBlock, device: Device): void {
        const timers = device.routing?.bfd;
        if (!FortiOsRouting.usesBfd(device) && !timers) return;

        settings.set("bfd", "enable");
        if (!timers) return;

        settings
            .set("bfd-desired-min-tx", timers.interval)
            .set("bfd-required-min-rx", timers.interval)
            .set("bfd-detect-mult", timers.multiplier);
    }

    /** The helpers the config lists, each on the protocols and ports the factory gives it. None run otherwise. */
    private static helpers(block: FortiOsBlock, device: Device): void {
        let number = 0;

        for (const helper of device.firewall?.helpers ?? []) {
            for (const [name, protocol, port] of FortiOsRender.HELPERS[helper] ?? [])
                block.entry(++number).set("name", name).set("protocol", protocol).set("port", port);
        }
    }
}
