import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import { Utils } from "../../core/utils";
import type {
    AdvertisedPrefix,
    Device,
    Family,
    Gre,
    Helper,
    RadiusServer,
    RouterAdvertisement,
    Routed,
    StaticRoute,
    Vxlan,
} from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { FortiOsFirewall } from "./firewall";
import { FortiOsMonitoring } from "./monitoring";
import { FortiOsShaping } from "./shaping";
import { FortiOsNames } from "./names";
import { FortiOsRouting } from "./routing";
import { FortiOsNode, FortiOsTree } from "./tree";
import { FortiOsVdoms } from "./vdoms";

export type Section = (typeof FortiOsRender.SECTIONS)[number];

type RoutedSettings = {
    addresses?: readonly (string | { address: string; peer_address: string })[];
    vrrp?: readonly { id: number; address: string; priority?: number; preempt?: boolean; interval?: number }[];
    lldp?: boolean;
    vrf?: string;
    ipv6_ra?: Routed["ipv6_ra"];
};

export class FortiOsRender {
    private static readonly FAMILIES: readonly [Family, string][] = [
        ["ipv4", "IPv4"],
        ["ipv6", "IPv6"],
    ];

    /** Router advertisement settings at their defaults on FortiOS 6.2, which the device doesn't print. */
    private static readonly RA_DEFAULTS = {
        "ip6-max-interval": 600,
        "ip6-min-interval": 198,
        "ip6-default-life": 1800,
        "valid-life-time": 2_592_000,
        "preferred-life-time": 604_800,
    } as const;

    /** Where the pre-login banner's text is kept. */
    static readonly BANNER = 'system replacemsg admin "pre_admin-disclaimer-text"';

    /** Every section Circuit manages, in the order a change goes in: what others name comes first. */
    static readonly SECTIONS = [
        "vpn certificate local",
        "vpn certificate ca",
        "system global",
        FortiOsRender.BANNER,
        "system settings",
        "user radius",
        "user tacacs+",
        "user group",
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
        "system dhcp6 server",
        "router static",
        "router static6",
        "router prefix-list",
        "router prefix-list6",
        "router community-list",
        "router aspath-list",
        "router route-map",
        "router ospf",
        "router ospf6",
        "router key-chain",
        "router isis",
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
        "firewall shaper traffic-shaper",
        "firewall shaping-policy",
        "firewall local-in-policy",
        "firewall local-in-policy6",
        "firewall central-snat-map",
        "firewall acl",
        "firewall acl6",
    ] as const;

    /** Sections rendered only when the config uses them, after every other, and read always, so what the device holds there is planned away when the config has none. */
    static readonly OPTIONAL_SECTIONS = ["system proxy-arp"] as const;

    /** `show` prints a certificate without its text, and `show full-configuration` with it. */
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

    /** The names of what logs users in through servers: the servers, the group that holds them, and the administrator every user a server accepts logs in as. */
    static readonly AAA = { radius: "circuit-radius", tacacs: "circuit-tacacs", remote: "circuit-remote" } as const;

    /** How the settings of each server in an entry start, in the order the device asks them. */
    private static readonly AAA_ORDER = ["", "secondary-", "tertiary-"];

    static readonly AAA_SERVERS = FortiOsRender.AAA_ORDER.length;

    /** What each role may do: the factory profile for an admin, and a profile Circuit adds for the others. */
    static readonly PROFILE = { admin: "super_admin", operator: "circuit-operator", "read-only": "circuit-read-only" } as const;

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

    /** Seconds a lease lasts when a DHCP server of either family doesn't say: a week. */
    private static readonly LEASE_TIME = 604_800;

    /** The fewest and most seconds a DHCPv6 server's lease lasts. */
    static readonly DHCPV6_LEASE_TIME = { min: 300, max: 8_640_000 } as const;

    /** The most VRFs the device holds besides its default table. */
    static readonly VRFS = 31;

    /** The factory's helpers, by the name a config gives them: each as name, IP protocol, and port. */
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

    /** For a device in transparent mode without a management address: link-local, so only the console reaches it. */
    static readonly TRANSPARENT_MANAGEIP = "169.254.0.1/255.255.255.255";

    static zoneOf(timezone = "UTC"): string | undefined {
        return Object.entries(FortiOsRender.ZONES).find(([, places]) => places.includes(timezone))?.[0];
    }

    private static allowAccess(device: Device): string {
        const management = device.management ?? {};
        const services = ["ping"];

        if (management.https) services.push("https");
        if (management.ssh) services.push("ssh");
        if (device.monitoring?.snmp) services.push("snmp");
        if (management.http) services.push("http");
        if (management.telnet) services.push("telnet");
        if (management.native_protocol) services.push("fgfm");

        return services.join(" ");
    }

    static of(device: Device): string {
        const root = new FortiOsNode();
        for (const section of FortiOsRender.SECTIONS) root.block(section);

        const section = (name: Section) => root.block(name);

        FortiOsRender.certificates(section("vpn certificate local"), section("vpn certificate ca"), device);
        FortiOsRender.global(section("system global"), device);
        if (device.system?.banner) section(FortiOsRender.BANNER).set("buffer", FortiOsTree.quote(device.system.banner));
        // A bridge needs transparent mode, and transparent mode needs a management address.
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
        if (FortiOsRender.sourceCheck(device).strict) section("system settings").set("strict-src-check", "enable");
        FortiOsRender.users(section("system accprofile"), section("system admin"), device);
        FortiOsRender.aaa(root, device);
        FortiOsRender.interfaces(root, device);
        FortiOsRender.dns(section("system dns"), section("system dns-server"), device);
        FortiOsRender.ntp(section("system ntp"), device);
        FortiOsMonitoring.snmp(root, device);
        FortiOsMonitoring.logging(root, device);
        FortiOsMonitoring.flowExport(root, device);
        FortiOsRender.dhcpServers(section("system dhcp server"), device);
        FortiOsRender.dhcpv6Servers(section("system dhcp6 server"), device);
        FortiOsRender.staticRoutes(section("router static"), section("router static6"), device, device.routing?.static_routes ?? []);
        FortiOsRouting.render(root, device);
        FortiOsRender.helpers(section("system session-helper"), device);
        FortiOsFirewall.render(root, device);
        FortiOsShaping.render(root, device);
        FortiOsRender.managementVdom(root, device);
        if (Object.values(device.interfaces?.vlan_interface ?? {}).some((iface) => iface?.proxy_arp?.length))
            FortiOsRender.proxyArp(root.block("system proxy-arp"), device);

        return FortiOsTree.print(root);
    }

    /** A management VDOM's routes, and who reaches the device's own services through it, as sections of their own after everything else. */
    private static managementVdom(root: FortiOsNode, device: Device): void {
        const management = device.system?.vdoms?.management;
        if (!management) return;

        const vdom = new FortiOsNode();
        for (const section of FortiOsVdoms.MANAGEMENT_SECTIONS) vdom.block(section);

        FortiOsRender.staticRoutes(vdom.block("router static"), vdom.block("router static6"), device, management.static_routes ?? []);
        FortiOsFirewall.managementOnly(vdom, device);

        for (const [section, block] of vdom.blocks) root.blocks.set(FortiOsVdoms.key(management.name, section), block);
    }

    /** A certificate with its key is the device's own; one without is only trusted. */
    private static certificates(local: FortiOsNode, trusted: FortiOsNode, device: Device): void {
        for (const [name, certificate] of Object.entries(device.system?.certificates ?? {})) {
            if (!certificate) continue;

            const text = FortiOsTree.quote(Utils.projectFile(certificate.certificate_file).trim());

            if (certificate.private_key)
                local
                    .entry(name)
                    .set("private-key", FortiOsTree.quote(Secrets.marker(certificate.private_key)))
                    .set("certificate", text);
            else trusted.entry(name).set("ca", text);
        }
    }

    private static global(block: FortiOsNode, device: Device): void {
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

        if (device.switching?.lldp === true) block.set("lldp-transmission", "enable").set("lldp-reception", "enable");

        const vdom = FortiOsVdoms.managementOf(device);
        if (vdom) block.set("vdom-mode", "multi-vdom").set("management-vdom", FortiOsTree.quote(vdom));
    }

    private static users(profiles: FortiOsNode, admins: FortiOsNode, device: Device): void {
        const users = Object.entries(device.system?.users ?? {}).flatMap(([name, user]) => (user ? [[name, user] as const] : []));
        const roles = new Set(users.map(([, user]) => user.role));
        if (device.system?.aaa) roles.add(device.system.aaa.remote_role);

        // An operator changes everything but the system's own settings, which hold the users; read-only changes nothing.
        for (const role of ["operator", "read-only"] as const) {
            if (!roles.has(role)) continue;

            const profile = profiles.entry(FortiOsRender.PROFILE[role]);
            for (const group of FortiOsRender.PERMISSION_GROUPS)
                profile.set(group, role === "operator" && group !== "sysgrp" ? "read-write" : "read");
        }

        for (const [name, user] of users) {
            const admin = admins.entry(name);

            admin.set("accprofile", FortiOsTree.quote(FortiOsRender.PROFILE[user.role]));
            if (user.description) admin.set("comments", FortiOsTree.quote(user.description));
            admin.set("vdom", FortiOsTree.quote("root"));
            (user.ssh_keys ?? []).forEach((key, index) => admin.set(`ssh-public-key${index + 1}`, FortiOsTree.quote(key)));
            admin.set("password", FortiOsTree.quote(Secrets.marker(user.password)));
        }
    }

    /** The servers as one entry, asked in order, in a group a wildcard administrator logs in through. A name in `system.users` matches its own administrator first. */
    private static aaa(root: FortiOsNode, device: Device): void {
        const aaa = device.system?.aaa;
        const servers: readonly RadiusServer[] | undefined = aaa?.tacacs ?? aaa?.radius;
        if (!aaa || !servers) return;

        const kind = aaa.tacacs ? "tacacs" : "radius";
        const names = FortiOsRender.AAA;
        const entry = root.block(kind === "tacacs" ? "user tacacs+" : "user radius").entry(names[kind]);
        const secretKey = kind === "tacacs" ? "key" : "secret";

        FortiOsRender.AAA_ORDER.forEach((prefix, index) => {
            const server = servers[index];
            if (!server) return;

            entry.set(`${prefix}server`, FortiOsTree.quote(server.address));
            entry.set(`${prefix}${secretKey}`, FortiOsTree.quote(Secrets.marker(server.secret_key)));
        });

        // The entry holds one of each for every server. The others are refused when they differ.
        const [first] = servers;
        if (first?.auth_port !== undefined) entry.set("radius-port", first.auth_port);
        if (first?.source_address) entry.set("source-ip", FortiOsTree.quote(first.source_address));

        root.block("user group").entry(names.remote).set("member", FortiOsTree.quote(names[kind]));

        root.block("system admin")
            .entry(names.remote)
            .set("remote-auth", "enable")
            .set("accprofile", FortiOsTree.quote(FortiOsRender.PROFILE[aaa.remote_role]))
            .set("vdom", FortiOsTree.quote(FortiOsVdoms.ROOT))
            .set("wildcard", "enable")
            .set("remote-group", FortiOsTree.quote(names.remote));
    }

    private static interfaces(root: FortiOsNode, device: Device): void {
        const block = root.block("system interface");
        const access = FortiOsRender.allowAccess(device);

        for (const port of Catalog.ports(device.platform, device.model)) {
            const settings = device.interfaces?.ethernet?.[port];
            const entry = block.entry(Catalog.spell(device.platform, device.model, port));

            entry.set("vdom", FortiOsTree.quote(FortiOsVdoms.of(device, port)));
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
            if (settings.in_lag) continue;

            FortiOsRender.redirects(entry, device);
            if (settings.mtu) entry.set("mtu-override", "enable").set("mtu", settings.mtu);
            FortiOsRender.routed(entry, device, port, settings, access);
        }

        for (const [name, iface] of Object.entries(device.interfaces?.lag ?? {})) {
            if (!iface) continue;

            const members = Derive.ports(device)
                .filter(([, port]) => port.in_lag === name)
                .map(([port]) => Catalog.spell(device.platform, device.model, port));

            const entry = block.entry(name);
            entry.set("vdom", FortiOsTree.quote(FortiOsVdoms.of(device, name)));
            entry.set("type", "aggregate");
            if (members.length) entry.set("member", FortiOsTree.quoteAll(members));
            if (iface.mode === "static") entry.set("lacp-mode", "static");
            if (iface.description) entry.set("description", FortiOsTree.quote(iface.description));
            if (iface.mtu) entry.set("mtu-override", "enable").set("mtu", iface.mtu);
            FortiOsRender.redirects(entry, device);
            FortiOsRender.routed(entry, device, name, iface, access);
        }

        for (const [name, iface] of Object.entries(device.interfaces?.vlan_interface ?? {})) {
            if (!iface) continue;

            const parent = FortiOsRender.vlanParent(device, iface.vlan);
            const entry = block.entry(name);
            entry.set("vdom", FortiOsTree.quote(FortiOsVdoms.of(device, name)));
            if (parent) entry.set("interface", FortiOsTree.quote(FortiOsNames.of(device, parent)));
            entry.set("vlanid", device.switching?.vlans?.[iface.vlan]?.id ?? 0);
            const domain = FortiOsNames.forwardDomainOf(device, name);
            if (domain) entry.set("forward-domain", domain);
            if (iface.description) entry.set("description", FortiOsTree.quote(iface.description));
            if (iface.mtu) entry.set("mtu-override", "enable").set("mtu", iface.mtu);
            FortiOsRender.redirects(entry, device);
            FortiOsRender.routed(entry, device, name, iface, access);
        }

        for (const [name, iface] of Object.entries(device.interfaces?.loopback ?? {})) {
            if (!iface) continue;

            const entry = block.entry(name);
            entry.set("vdom", FortiOsTree.quote(FortiOsVdoms.of(device, name)));
            entry.set("type", "loopback");
            if (iface.description) entry.set("description", FortiOsTree.quote(iface.description));
            FortiOsRender.redirects(entry, device);
            FortiOsRender.routed(entry, device, name, iface, access);
        }

        // A tunnel's interface is created by its own table, which uses the interface it leaves through.
        for (const { name, kind, settings } of FortiOsNames.interfacesOf(device)) {
            if (kind !== "gre" && kind !== "vxlan") continue;

            const iface = settings as Gre | Vxlan;
            const vxlan = kind === "vxlan" ? (settings as Vxlan) : undefined;

            const outgoing = FortiOsNames.holderOf(device, iface.local_address);
            const via = outgoing ? FortiOsTree.quote(FortiOsNames.of(device, outgoing)) : '""';

            // Between IPv6 endpoints the family is stated first: the addresses of the other family are not settings until it is.
            const ipv6 = Address.family(iface.remote_address) === "ipv6";

            if (!vxlan) {
                const tunnel = root.block("system gre-tunnel").entry(name).set("interface", via);
                if (ipv6) tunnel.set("ip-version", 6).set("remote-gw6", iface.remote_address).set("local-gw6", iface.local_address);
                else tunnel.set("remote-gw", iface.remote_address).set("local-gw", iface.local_address);
            } else {
                const tunnel = root.block("system vxlan").entry(name).set("interface", via).set("vni", vxlan.vni);
                if (ipv6) tunnel.set("ip-version", "ipv6-unicast").set("remote-ip6", FortiOsTree.quote(vxlan.remote_address));
                else tunnel.set("remote-ip", FortiOsTree.quote(vxlan.remote_address));
                if (vxlan.port !== undefined && vxlan.port !== 4789) tunnel.set("dstport", vxlan.port);
            }

            const entry = block.entry(name);
            entry.set("vdom", FortiOsTree.quote(FortiOsVdoms.of(device, name)));
            entry.set("type", vxlan ? "vxlan" : "tunnel");
            entry.set("interface", via);
            if (vxlan?.mac) entry.set("macaddr", vxlan.mac.toLowerCase());
            if (iface.description) entry.set("description", FortiOsTree.quote(iface.description));
            if (iface.mtu) entry.set("mtu-override", "enable").set("mtu", iface.mtu);
            FortiOsRender.redirects(entry, device);
            FortiOsRender.routed(entry, device, name, iface, access);
        }
    }

    /** Router advertisements, each prefix with its own flags and lifetimes. The DNS servers and domains go on every prefix: the platform has no other place for them. A value at the platform's default is left out, as the device prints it. */
    private static routerAdvertisement(block: FortiOsNode, ra: RouterAdvertisement, prefixes: readonly AdvertisedPrefix[]): void {
        const defaults = FortiOsRender.RA_DEFAULTS;
        const unlessDefault = (node: FortiOsNode, key: keyof typeof defaults, value: number | undefined) => {
            if (value !== undefined && value !== defaults[key]) node.set(key, value);
        };

        block.set("ip6-send-adv", "enable");
        if (ra.managed) block.set("ip6-manage-flag", "enable");
        if (ra.other_config) block.set("ip6-other-flag", "enable");
        if (ra.interval !== undefined) {
            unlessDefault(block, "ip6-max-interval", ra.interval);
            unlessDefault(block, "ip6-min-interval", Derive.minAdvertisementInterval(ra.interval));
        }
        unlessDefault(block, "ip6-default-life", ra.lifetime);

        const list = block.block("ip6-prefix-list");
        for (const advertised of prefixes) {
            const entry = list.entry(FortiOsNames.network(advertised.prefix), true);
            if (advertised.disable_autoconfiguration) entry.set("autonomous-flag", "disable");
            unlessDefault(entry, "valid-life-time", advertised.valid_lifetime);
            unlessDefault(entry, "preferred-life-time", advertised.preferred_lifetime);
            if (ra.dns_servers?.length) entry.set("rdnss", ra.dns_servers.join(" "));
            if (ra.dns_search_list?.length) entry.set("dnssl", FortiOsTree.quoteAll(ra.dns_search_list));
        }
    }

    /** The platform sends ICMP redirects unless an interface says otherwise; the config sends them only when asked. */
    private static redirects(entry: FortiOsNode, device: Device): void {
        if (!device.system?.ip_stack?.icmp_redirects) entry.set("icmp-send-redirect", "disable");
    }

    /** The one port or LAG that carries a VLAN tagged, which its VLAN interface sits on. `unsupported()` refuses any other case. */
    static vlanParent(device: Device, vlan: string): string | undefined {
        const carriers = [
            ...Derive.ports(device).filter(([, port]) => !port.in_lag && port.trunk_vlans?.includes(vlan)),
            ...Object.entries(device.interfaces?.lag ?? {}).filter(([, lag]) => lag?.trunk_vlans?.includes(vlan)),
        ];

        return carriers.length === 1 ? carriers[0]![0] : undefined;
    }

    private static routed(entry: FortiOsNode, device: Device, name: string, settings: RoutedSettings, access: string): void {
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
        const peer = settings.addresses?.find((item): item is { address: string; peer_address: string } => typeof item !== "string");

        if (peer) {
            entry.set("ip", `${Address.host(peer.address)} 255.255.255.255`);
            entry.set("remote-ip", `${peer.peer_address} ${Address.netmask(Address.split(peer.address).len)}`);
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

        const relays = Object.values(device.services?.dhcp_relay ?? {}).filter((relay) => relay.interface === name);
        const relayed = relays.flatMap((relay) => relay.servers);
        const relayed4 = relayed.filter((server) => Address.family(server) === "ipv4");
        const relayed6 = relayed.filter((server) => Address.family(server) === "ipv6");

        if (ipv6.length || relayed6.length) {
            const block = entry.block("ipv6");

            if (ipv6.length) {
                block.set("ip6-address", ipv6[0]!);
                block.set("ip6-allowaccess", access);
            }

            const ra = Derive.routerAdvertisement(settings);
            if (ra) FortiOsRender.routerAdvertisement(block, ra, Derive.advertisedPrefixes(settings));

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
        const lldp = device.switching?.lldp;
        const listed = typeof lldp === "object" && lldp.interfaces.includes(name);
        if (settings.lldp === false) entry.set("lldp-transmission", "disable").set("lldp-reception", "disable");
        else if (listed || (settings.lldp === true && lldp !== true))
            entry.set("lldp-transmission", "enable").set("lldp-reception", "enable");

        // A tunnel is not sampled: its traffic is, on the interface it leaves through.
        const flow = device.monitoring?.flow_export;
        const tunnel = FortiOsNames.isTunnel(device, name);
        const sampled = flow && !tunnel && (!flow.interfaces || flow.interfaces.includes(name));

        if (sampled && flow.protocol === "sflow") {
            entry.set("sflow-sampler", "enable");
            if (flow.sampling !== undefined && flow.sampling !== 2000) entry.set("sample-rate", flow.sampling);
        }

        if (sampled && flow.protocol === "netflow-v9") entry.set("netflow-sampler", "both");
    }

    private static dns(block: FortiOsNode, servers: FortiOsNode, device: Device): void {
        const resolvers = device.system?.dns?.servers ?? [];
        const ipv4 = resolvers.filter((server) => Address.family(server) === "ipv4");
        const ipv6 = resolvers.filter((server) => Address.family(server) === "ipv6");

        if (ipv4[0]) block.set("primary", ipv4[0]);
        if (ipv4[1]) block.set("secondary", ipv4[1]);
        if (ipv6[0]) block.set("ip6-primary", ipv6[0]);
        if (ipv6[1]) block.set("ip6-secondary", ipv6[1]);

        // Recursive, the default mode, answers from what the device has resolved itself.
        if (device.services?.dns_server) for (const name of FortiOsNames.addressed(device)) servers.entry(FortiOsNames.of(device, name));
    }

    private static ntp(block: FortiOsNode, device: Device): void {
        const ntp = device.system?.ntp;
        const servers = ntp?.servers ?? [];

        if (servers.length) {
            block.set("ntpsync", "enable");
            block.set("type", "custom");

            const list = block.block("ntpserver");
            servers.forEach((server, index) => list.entry(index + 1).set("server", FortiOsTree.quote(server)));
        }

        if (device.services?.ntp_server) {
            block.set("server-mode", "enable");
            block.set("interface", FortiOsTree.quoteAll(FortiOsNames.addressed(device).map((name) => FortiOsNames.of(device, name))));
        }
    }

    private static dhcpServers(block: FortiOsNode, device: Device): void {
        Object.values(device.services?.dhcp_server ?? {}).forEach((server, index) => {
            const entry = block.entry(index + 1);
            if (server.lease_time !== undefined && server.lease_time !== FortiOsRender.LEASE_TIME)
                entry.set("lease-time", server.lease_time);
            entry.set("default-gateway", server.gateway);
            entry.set("netmask", Address.netmask(Address.split(server.network).len));
            entry.set("interface", FortiOsTree.quote(FortiOsNames.of(device, server.interface)));
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

    /**
     * A server's subnet is the network of its interface that holds its pool. FortiOS 6.2 delegates only prefixes inside the subnet, so with delegated prefixes it is the smallest prefix that holds both. A server without a pool is refused.
     */
    private static dhcpv6Servers(block: FortiOsNode, device: Device): void {
        Object.values(device.services?.dhcpv6_server ?? {}).forEach((server, index) => {
            const network = Derive.dhcpv6Network(device, server);
            if (!server.pool || !network) return;

            const delegation = server.prefix_delegation;
            const entry = block.entry(index + 1);
            if (server.lease_time !== undefined && server.lease_time !== FortiOsRender.LEASE_TIME)
                entry.set("lease-time", server.lease_time);
            entry.set("subnet", delegation ? FortiOsRender.covering(network, delegation.pool) : network);
            entry.set("interface", FortiOsTree.quote(FortiOsNames.of(device, server.interface)));

            if (delegation) {
                const { first, last } = Address.range(delegation.pool);
                const lastPrefix = Address.prefixOf(`${Address.fromNumber(last, "ipv6")}/${delegation.prefix_length}`);
                entry
                    .block("prefix-range")
                    .entry(1)
                    .set("start-prefix", Address.fromNumber(first, "ipv6"))
                    .set("end-prefix", Address.host(lastPrefix))
                    .set("prefix-length", delegation.prefix_length);
            }

            entry.block("ip-range").entry(1).set("start-ip", server.pool[0]).set("end-ip", server.pool[1]);
            (server.dns ?? []).forEach((resolver, number) => entry.set(`dns-server${number + 1}`, resolver));
        });
    }

    /** The smallest prefix that holds both `a` and `b`. */
    private static covering(a: string, b: string): string {
        let length = Math.min(Address.split(a).len, Address.split(b).len);
        while (length > 0 && !Address.contains(Address.prefixOf(`${Address.host(a)}/${length}`), b)) length--;
        return Address.prefixOf(`${Address.host(a)}/${length}`);
    }

    /** One entry for each address a VLAN interface answers ARP for, numbered in the config's order. */
    private static proxyArp(block: FortiOsNode, device: Device): void {
        let number = 0;

        for (const [name, iface] of Object.entries(device.interfaces?.vlan_interface ?? {})) {
            for (const address of iface?.proxy_arp ?? []) {
                block
                    .entry(++number)
                    .set("interface", FortiOsTree.quote(FortiOsNames.of(device, name)))
                    .set("ip", address);
            }
        }
    }

    /** A route lands in the routing table of the interface it leaves through. The default route's destination is the platform's default, and is not printed. */
    private static staticRoutes(ipv4: FortiOsNode, ipv6: FortiOsNode, device: Device, routes: readonly StaticRoute[]): void {
        const counters = { ipv4: 0, ipv6: 0 };

        for (const route of routes) {
            const family = Address.family(Address.split(route.prefix).addr);
            const entry = (family === "ipv4" ? ipv4 : ipv6).entry(++counters[family]);
            const prefix = FortiOsNames.network(route.prefix);

            if (family === "ipv6" && prefix !== "::/0") entry.set("dst", prefix);
            if (family === "ipv4" && prefix !== "0.0.0.0/0") entry.set("dst", FortiOsNames.subnet(prefix));

            if (route.next_hop) entry.set("gateway", route.next_hop);

            // In transparent mode a route names no interface: it carries only the management address's own traffic.
            const outgoing = route.interface ?? (route.next_hop ? FortiOsNames.interfaceFor(device, route.next_hop, route.vrf) : undefined);
            if (outgoing && !route.blackhole && !FortiOsNames.isTransparent(device))
                entry.set("device", FortiOsTree.quote(FortiOsNames.of(device, outgoing)));

            if (route.distance !== undefined && route.distance !== 10) entry.set("distance", route.distance);
            if (route.description) entry.set("comment", FortiOsTree.quote(route.description));
            if (route.blackhole) entry.set("blackhole", "enable");
            if (route.bfd) entry.set("bfd", "enable");
        }
    }

    /** Strict source checks, `strict-src-check`, cover every interface of a VDOM and both families (TRAPS.md). So they are set only when every interface of the root VDOM with an address checks strict in each family it has. `gaps` says why not. */
    static sourceCheck(device: Device): { strict: boolean; setting: string[]; gaps: string[] } {
        const inRoot = (name: string) => FortiOsVdoms.of(device, name) === FortiOsVdoms.ROOT;
        const holders = Derive.holders(device).filter(({ kind }) => kind !== "bridge" && kind !== "loopback");
        const setting = holders.filter(({ settings }) => settings.urpf);
        const root = setting.filter(({ name }) => inRoot(name));
        const gaps = setting
            .filter(({ name }) => !inRoot(name))
            .map(({ where }) => `${where}.urpf in the management VDOM, whose settings Circuit leaves as they are`);

        const loose = root.flatMap(({ where, settings }) =>
            FortiOsRender.FAMILIES.filter(([family]) => settings.urpf?.[family] === "loose").map(
                ([family]) => `${where}.urpf.${family} loose, FortiOS has no loose mode: it checks feasible paths unless strict`
            )
        );
        const missing = FortiOsRender.FAMILIES.flatMap(([family, label]) => {
            const names = holders
                .filter(({ name, settings }) => inRoot(name) && Derive.hasFamily(settings, family) && settings.urpf?.[family] !== "strict")
                .map(({ name }) => name);
            return names.length ? [`${label} on ${names.join(", ")}`] : [];
        });

        gaps.push(...loose);
        if (!loose.length && missing.length)
            for (const { where } of root)
                gaps.push(
                    `${where}.urpf, FortiOS checks strict for the whole VDOM and both families: write strict for each family on every interface in it with an address of that family (missing: ${missing.join("; ")})`
                );

        return { strict: root.length > 0 && !gaps.length, setting: root.map(({ where }) => `${where}.urpf`), gaps };
    }

    /** BFD runs once a route or a session uses it, or the config sets its timers, which the device shows only while it runs. */
    private static bfd(settings: FortiOsNode, device: Device): void {
        const timers = device.routing?.bfd;
        if (!FortiOsRouting.usesBfd(device) && !timers) return;

        settings.set("bfd", "enable");
        if (!timers) return;

        settings
            .set("bfd-desired-min-tx", timers.interval)
            .set("bfd-required-min-rx", timers.interval)
            .set("bfd-detect-mult", timers.multiplier);
    }

    /** Only the helpers the config lists run, each on the factory's protocols and ports. */
    private static helpers(block: FortiOsNode, device: Device): void {
        let number = 0;

        for (const helper of device.firewall?.conntrack_helpers ?? []) {
            for (const [name, protocol, port] of FortiOsRender.HELPERS[helper] ?? [])
                block.entry(++number).set("name", name).set("protocol", protocol).set("port", port);
        }
    }
}
