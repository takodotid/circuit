// Huawei VRP, as on the CE series.
//
// Configuration reads as blocks indented under their header, `#` between blocks, and `undo` to remove a line. Changes stage in a candidate and take effect only at `commit`, so a refused line leaves nothing applied: the candidate is cleared. `commit` does not write to flash; `save` does, and without it a reboot brings the old configuration back. There is no scheduler to restore from, so access is proved by a fresh login before saving.

import type { Client, ClientChannel } from "ssh2";
import { familyOf, host, netmask, network, split, wildcard } from "../../../core/addr";
import { marker, resolve, substitute } from "../../../core/secrets";
import { offset } from "../../../core/time";
import type { Device, Interface, Port, Vrrp } from "../../../schema";
import { connect, readUntil, send, shell } from "../../../transport/ssh";
import { portsOf, spell } from "../catalog";
import { compare, type Dialect, scrub, steps } from "../lines";
import type { DeviceAdapter, Plan } from "../types";

/** Lines the device prints whatever is configured, or that describe the hardware rather than its configuration. */
const DEVICE_FACTS = [
    "!",
    "device ",
    "system resource",
    "drop-profile",
    "dcb ",
    "diffserv domain",
    "vlan reserved",
    "interface MEth",
    "interface NULL",
    "stack",
    "vm-manager",
    "return",
    "authentication-scheme default",
    "authorization-scheme default",
    "accounting-scheme default",
    "domain default",
    "Info:",
];

/** Lines whose removal takes only their keyword, not their value. */
const UNDO_BY_KEYWORD =
    /^(description|name|port default vlan|port link-type|port trunk pvid vlan|set authentication password|eth-trunk|ip binding vpn-instance)\b/;

function undo(line: string): string {
    // A negated line is undone by stating it.
    if (line.startsWith("undo ")) return line.slice("undo ".length);
    // An ACL rule is removed by its number.
    if (/^rule \d+/.test(line)) return `undo ${line.split(" ").slice(0, 2).join(" ")}`;

    const keyword = UNDO_BY_KEYWORD.exec(line);
    if (keyword) return `undo ${keyword[1]}`;
    // Storm control is removed per kind, without its rates.
    if (line.startsWith("storm control ")) return `undo ${line.replace(/ (min-rate|max-rate).*$/, "")}`;

    return `undo ${line}`;
}

/** Secrets the device prints as ciphers and the render writes as markers compare equal. */
function canon(line: string): string {
    return line.replace(/(irreversible-cipher|cipher) \S+/g, "cipher <secret>").replace(/<secret:\w+>/g, "<secret>");
}

/** Blocks other blocks refer to come first: VRFs, VLANs, the ACL and users, then device-wide lines, then LAGs, ports, VLAN interfaces, OSPF and logins. */
function order(path: string[]): number {
    const header = path[0] ?? "";
    if (!header) return 1;

    if (/^(ip vpn-instance|vlan |acl number|aaa|bfd)/.test(header)) return 0;

    if (header.startsWith("interface Eth-Trunk")) return 2;

    if (header.startsWith("interface Vlanif")) return 4;

    if (header.startsWith("interface ")) return 3;

    if (header.startsWith("ospf ")) return 5;

    return 6;
}

export const dialect: Dialect = {
    block: /^(interface |vlan \d+$|acl number |aaa$|user-interface |ospf |ip vpn-instance |bfd$)/,
    indented: true,
    terminator: "#",
    ignore: (line) => DEVICE_FACTS.some((fact) => line.startsWith(fact)),
    undo,
    leave: "quit",
    // The console refuses to drop its password while password login is still on.
    first: /^authentication-mode /,
    canon,
    order,
};

/** The ACL that guards every management service. */
export const MANAGEMENT_ACL = 2000;

/** The OSPF process number. One process per device. */
const OSPF_PROCESS = 1;

/** The sFlow collectors are numbered from here, in the order the config lists them. */
const FIRST_COLLECTOR = 1;

/** The SNMPv3 group every user joins, with read access to everything. */
const SNMP_GROUP = "framework";

const USER_LEVEL = { admin: 3, operator: 2, "read-only": 1 } as const;
const SNMP_AUTH = { sha1: "sha", sha256: "sha2-256" } as const;
const SNMP_PRIVACY = { aes128: "aes128", des: "des56" } as const;

type AnyPort = Port<string, string, string, string>;
type AnyInterface = Interface<string, string>;
type LagInterface = Extract<AnyInterface, { type: "lag" }>;

/** `99 999 to 1000 2000`, the platform's compression of a VLAN list. */
export function vlanBatch(ids: number[]): string {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const ranges: string[] = [];

    for (let i = 0; i < sorted.length; i++) {
        let end = i;
        while (sorted[end + 1] === sorted[end]! + 1) end++;
        ranges.push(i === end ? `${sorted[i]}` : `${sorted[i]} to ${sorted[end]}`);
        i = end;
    }

    return ranges.join(" ");
}

/** Builds the configuration as blocks: a header line, its indented lines, then `#`. */
class Config {
    private readonly lines: string[] = [];

    line(text: string): void {
        this.lines.push(text);
    }

    /** A header and its lines. A block with nothing in it is still written, so that its header exists. */
    block(header: string, body: string[]): void {
        this.lines.push(header, ...body.map((text) => ` ${text}`), "#");
    }

    separator(): void {
        this.lines.push("#");
    }

    text(): string {
        return this.lines.join("\n") + "\n";
    }
}

export function render(device: Device): string {
    const config = new Config();
    const vlans = device.vlans ?? {};
    const vlanId = (name: string) => vlans[name]!.id;
    const interfaces = device.interfaces ?? {};
    const lagNumbers = lagIds(device);

    /** What the platform calls a port, a LAG or a VLAN interface. */
    const nameOf = (portOrInterface: string): string => {
        const iface = interfaces[portOrInterface];
        if (iface?.type === "lag") return `Eth-Trunk${lagNumbers.get(portOrInterface)}`;

        if (iface?.type === "vlan") return `Vlanif${vlanId(iface.vlan)}`;

        return spell(device.platform, device.model, portOrInterface);
    };

    system(config, device);
    vlanBlocks(config, device);
    managementAcl(config, device);
    users(config, device);
    vrfs(config, device);

    for (const [name, lag] of Object.entries(interfaces)) {
        if (lag.type === "lag") config.block(`interface ${nameOf(name)}`, [...lagMode(lag), ...switching(lag, vlanId)]);
    }

    for (const [name, iface] of Object.entries(interfaces)) {
        if (iface.type === "vlan") config.block(`interface ${nameOf(name)}`, vlanInterface(device, name, iface));
    }

    for (const port of portsOf(device.platform, device.model)) {
        const settings = device.ports?.[port as keyof typeof device.ports];
        config.block(`interface ${nameOf(port)}`, physicalPort(device, port, settings, vlanId, lagNumbers));
    }

    staticRoutes(config, device, nameOf);
    ospf(config, device, nameOf);
    if (wantsBfd(device)) config.block("bfd", []);
    if (device.dhcp_relay && Object.keys(device.dhcp_relay).length) {
        config.line("dhcp enable");
        config.separator();
    }

    flowExport(config, device);
    snmp(config, device);
    ssh(config, device);
    userInterfaces(config, device);
    return config.text();
}

/** The number of each LAG: the one it states, or its position among the device's LAGs. */
function lagIds(device: Device): Map<string, number> {
    const numbers = new Map<string, number>();
    let position = 0;

    for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
        if (iface.type !== "lag") continue;

        position++;
        numbers.set(name, iface.id ?? position);
    }

    return numbers;
}

function system(config: Config, device: Device): void {
    config.line(`sysname ${device.name}`);
    config.separator();

    const timezone = device.system?.timezone;
    if (timezone) {
        const minutes = offset(timezone);
        const absolute = Math.abs(minutes);
        const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
        const remainder = String(absolute % 60).padStart(2, "0");
        // The platform names the zone with one word; the last part of the IANA name serves.
        config.line(`clock timezone ${timezone.split("/").at(-1)} ${minutes < 0 ? "minus" : "add"} ${hours}:${remainder}:00`);
        config.separator();
    }

    const stp = device.stp;
    if (!stp) config.line("stp disable");
    else {
        // MSTP is the platform's default and is not written.
        if (stp.mode && stp.mode !== "mstp") config.line(`stp mode ${stp.mode}`);
        if (stp.priority !== undefined) config.line(`stp priority ${stp.priority}`);
    }
    // LLDP is off by default and turned on by the config.
    if (device.lldp) config.line("lldp enable");
    config.separator();

    const ntp = device.system?.ntp;
    if (!ntp?.serve) {
        config.line("ntp server disable");
        config.line("ntp ipv6 server disable");
    }

    for (const server of ntp?.servers ?? []) config.line(`ntp unicast-server ${server}`);
    config.separator();

    const ids = Object.values(device.vlans ?? {}).map((vlan) => vlan.id);
    if (ids.length) {
        config.line(`vlan batch ${vlanBatch(ids)}`);
        config.separator();
    }

    if (!device.management?.telnet) {
        config.line("telnet server disable");
        config.line("telnet ipv6 server disable");
        config.separator();
    }
}

function vlanBlocks(config: Config, device: Device): void {
    for (const [name, vlan] of Object.entries(device.vlans ?? {})) {
        config.block(`vlan ${vlan.id}`, [`name ${name}`, ...(vlan.description ? [`description ${vlan.description}`] : [])]);
    }
}

/** One ACL guards every management service: a permit per source, then an explicit deny. */
function managementAcl(config: Config, device: Device): void {
    const allow = device.management?.allow ?? [];
    if (!allow.length) return;

    const rules = allow.map((cidr, index) => `rule ${(index + 1) * 5} permit source ${host(cidr)} ${wildcard(split(cidr).len)}`);
    config.block(`acl number ${MANAGEMENT_ACL}`, ["description Management access", ...rules, `rule ${(allow.length + 1) * 5} deny`]);
}

function users(config: Config, device: Device): void {
    const lines: string[] = [];

    for (const [name, user] of Object.entries(device.users ?? {})) {
        lines.push(`local-user ${name} password irreversible-cipher ${marker(user.password)}`);
        lines.push(`local-user ${name} service-type ssh`);
        lines.push(`local-user ${name} level ${USER_LEVEL[user.role]}`);
    }

    config.block("aaa", lines);
}

function vrfs(config: Config, device: Device): void {
    for (const name of Object.keys(device.vrfs ?? {})) config.block(`ip vpn-instance ${name}`, ["ipv4-family"]);
}

function lagMode(lag: LagInterface): string[] {
    const lines = [lag.mode === "static" ? "mode manual load-balance" : "mode lacp-static"];
    if (lag.description) lines.unshift(`description ${lag.description}`);
    return lines;
}

/** Layer 2 membership of a port or LAG. */
function switching(settings: AnyPort | LagInterface, vlanId: (name: string) => number): string[] {
    const lines: string[] = [];
    if (settings.access_vlan) lines.push(`port default vlan ${vlanId(settings.access_vlan)}`);
    if (settings.trunk_vlans) {
        lines.push("port link-type trunk");
        if (settings.native_vlan) lines.push(`port trunk pvid vlan ${vlanId(settings.native_vlan)}`);
        // VLAN 1 is allowed by default and never wanted. The native VLAN has to be allowed too, or its untagged frames are dropped.
        const allowed = [...settings.trunk_vlans, ...(settings.native_vlan ? [settings.native_vlan] : [])].map(vlanId);
        lines.push("undo port trunk allow-pass vlan 1");
        lines.push(`port trunk allow-pass vlan ${vlanBatch(allowed)}`);
    }

    if (settings.stp === false) lines.push("stp disable");
    else if (typeof settings.stp === "object") {
        if (settings.stp.edge) lines.push("stp edged-port enable");
        if (settings.stp.cost !== undefined) lines.push(`stp cost ${settings.stp.cost}`);
        if (settings.stp.priority !== undefined) lines.push(`stp port priority ${settings.stp.priority}`);
    }

    const storm = settings.storm_control;
    if (storm) {
        const kinds = [
            ["broadcast", storm.broadcast],
            ["multicast", storm.multicast],
            ["unknown-unicast", storm.unknown_unicast],
        ] as const;

        for (const [kind, threshold] of kinds) {
            if (!threshold || !("percent" in threshold)) continue;

            const percent = threshold.percent;
            lines.push(`storm control ${kind} min-rate percent ${percent} max-rate percent ${percent}`);
        }

        lines.push("storm control action suppress", "storm control enable trap", "storm control enable log");
    }

    return lines;
}

function vrrpLines(group: Vrrp): string[] {
    const lines = [`vrrp vrid ${group.id} virtual-ip ${group.address}`];
    if (group.priority !== undefined) lines.push(`vrrp vrid ${group.id} priority ${group.priority}`);
    // The platform preempts by default; the config only does when asked.
    if (!group.preempt) lines.push(`vrrp vrid ${group.id} preempt disable`);
    if (group.interval !== undefined && group.interval !== 1) lines.push(`vrrp vrid ${group.id} timer advertise ${group.interval}`);
    return lines;
}

function vlanInterface(device: Device, name: string, iface: Extract<AnyInterface, { type: "vlan" }>): string[] {
    const lines: string[] = [];
    if (iface.description) lines.push(`description ${iface.description}`);
    // Binding to a VRF clears the addresses, so it comes first.
    if (iface.vrf) lines.push(`ip binding vpn-instance ${iface.vrf}`);

    for (const entry of iface.addresses ?? []) {
        const address = typeof entry === "string" ? entry : entry.address;
        if (familyOf(address) === "ipv4") lines.push(`ip address ${host(address)} ${netmask(split(address).len)}`);
        else lines.push(`ipv6 address ${address}`);
    }

    for (const group of iface.vrrp ?? []) lines.push(...vrrpLines(group));

    const relays = Object.values(device.dhcp_relay ?? {}).filter((relay) => relay.interface === name);
    if (relays.length) {
        lines.push("dhcp select relay");
        for (const server of relays.flatMap((relay) => relay.servers)) lines.push(`dhcp relay binding server ip ${server}`);
    }

    for (const area of Object.values(device.routing?.ospf?.areas ?? {})) {
        const settings = area.interfaces[name as keyof typeof area.interfaces];
        if (!settings) continue;

        if (settings.cost !== undefined) lines.push(`ospf cost ${settings.cost}`);
        if (settings.network === "point-to-point") lines.push("ospf network-type p2p");
        if (settings.bfd) lines.push("ospf bfd enable");
    }

    return lines;
}

/** A port the config does not declare is shut down. A LAG member holds only its membership. */
function physicalPort(
    device: Device,
    port: string,
    settings: AnyPort | undefined,
    vlanId: (name: string) => number,
    lagNumbers: Map<string, number>
): string[] {
    if (!settings) return ["shutdown"];

    // A port joins a LAG only while it holds no other setting, so membership comes before its description.
    if (settings.lag) {
        const membership = `eth-trunk ${lagNumbers.get(settings.lag)}`;
        return settings.description ? [membership, `description ${settings.description}`] : [membership];
    }

    const lines: string[] = [];
    if (settings.description) lines.push(`description ${settings.description}`);
    lines.push(...switching(settings, vlanId));
    if (settings.lldp === false) lines.push("lldp disable");

    const flow = device.flow_export;
    const observed = flow?.protocol === "sflow" && (!flow.interfaces || flow.interfaces.includes(port));
    if (observed) {
        for (let index = 0; index < flow!.collectors.length; index++) lines.push(`sflow sampling collector ${FIRST_COLLECTOR + index}`);
        lines.push("sflow sampling inbound");
    }

    return lines;
}

function staticRoutes(config: Config, device: Device, nameOf: (name: string) => string): void {
    for (const route of device.routing?.static ?? []) {
        const { addr, len } = split(route.prefix);
        const nextHop = route.blackhole ? "NULL0" : (route.via ?? nameOf(route.interface!));
        const vrf = route.vrf ? ` vpn-instance ${route.vrf}` : "";
        const preference = route.distance ? ` preference ${route.distance}` : "";
        const description = route.description ? ` description ${route.description}` : "";
        if (familyOf(addr) === "ipv4") config.line(`ip route-static${vrf} ${addr} ${netmask(len)} ${nextHop}${preference}${description}`);
        else config.line(`ipv6 route-static${vrf} ${addr} ${len} ${nextHop}${preference}`);
    }

    config.separator();
}

/**
 * OSPF for IPv4. An area announces the networks of its interfaces; a passive interface is silent. `unsupported()` refuses IPv6.
 */
function ospf(config: Config, device: Device, nameOf: (name: string) => string): void {
    const ospf = device.routing?.ospf;
    if (!ospf) return;

    const routerId = device.routing?.router_id;
    const lines: string[] = [];
    for (const source of ospf.redistribute ?? []) lines.push(`import-route ${source === "connected" ? "direct" : "static"}`);

    const areaLines: string[] = [];

    for (const [areaId, area] of Object.entries(ospf.areas)) {
        areaLines.push(`area ${areaId}`);

        for (const [iface, settings] of Object.entries(area.interfaces)) {
            if (settings?.passive) lines.push(`silent-interface ${nameOf(iface)}`);
            for (const prefix of ipv4Networks(device, iface)) areaLines.push(` network ${host(prefix)} ${wildcard(split(prefix).len)}`);
        }
    }

    config.block(`ospf ${OSPF_PROCESS}${routerId ? ` router-id ${routerId}` : ""}`, [...lines, ...areaLines]);
}

/** The IPv4 networks an interface or port has addresses in. */
function ipv4Networks(device: Device, iface: string): string[] {
    const settings = device.interfaces?.[iface] ?? device.ports?.[iface as keyof typeof device.ports];
    const addresses = (settings?.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
    return addresses.filter((address) => familyOf(address) === "ipv4").map((address) => network(address));
}

function wantsBfd(device: Device): boolean {
    const areas = Object.values(device.routing?.ospf?.areas ?? {});
    return areas.some((area) => Object.values(area.interfaces).some((settings) => settings?.bfd));
}

/** sFlow from the management address, to each collector in order. */
function flowExport(config: Config, device: Device): void {
    const flow = device.flow_export;
    if (flow?.protocol !== "sflow") return;

    config.line(`sflow agent ip ${device.connection.host}`);

    flow.collectors.forEach((collector, index) => {
        const number = FIRST_COLLECTOR + index;
        config.line(`sflow collector ${number} ip ${collector.address} udp-port ${collector.port ?? 6343}`);
    });

    config.separator();
}

/** SNMP version 2c with one read community, version 3 with users in one read-only group, or both. */
function snmp(config: Config, device: Device): void {
    const snmp = device.management?.snmp;
    if (!snmp) return;

    const versions = [snmp.community ? "v2c" : "", snmp.users ? "v3" : ""].filter(Boolean).join(" ");
    const guarded = (device.management?.allow?.length ?? 0) > 0;

    config.line("snmp-agent");
    config.line(`snmp-agent sys-info version ${versions}`);
    if (snmp.contact) config.line(`snmp-agent sys-info contact ${snmp.contact}`);
    if (snmp.location) config.line(`snmp-agent sys-info location ${snmp.location}`);
    if (snmp.community) config.line(`snmp-agent community read cipher ${marker(snmp.community)}${guarded ? ` acl ${MANAGEMENT_ACL}` : ""}`);
    if (snmp.users) {
        config.line("snmp-agent mib-view included all iso");
        config.line(`snmp-agent group v3 ${SNMP_GROUP} privacy read-view all${guarded ? ` acl ${MANAGEMENT_ACL}` : ""}`);

        for (const [name, user] of Object.entries(snmp.users)) {
            config.line(`snmp-agent usm-user v3 ${name} group ${SNMP_GROUP}`);
            config.line(`snmp-agent usm-user v3 ${name} authentication-mode ${SNMP_AUTH[user.auth]} cipher ${marker(user.auth_password)}`);
            config.line(
                `snmp-agent usm-user v3 ${name} privacy-mode ${SNMP_PRIVACY[user.privacy]} cipher ${marker(user.privacy_password)}`
            );
        }
    }

    config.separator();
}

function ssh(config: Config, device: Device): void {
    const ssh = device.management?.ssh;
    if (!ssh) return;

    const guarded = (device.management?.allow?.length ?? 0) > 0;

    config.line("stelnet server enable");

    for (const user of Object.keys(device.users ?? {})) {
        config.line(`ssh user ${user}`);
        config.line(`ssh user ${user} authentication-type password`);
        config.line(`ssh user ${user} service-type stelnet`);
    }

    if (guarded) config.line(`ssh server acl ${MANAGEMENT_ACL}`);
    // Who decides whether a login is allowed: AAA, the same place for every service.
    config.line("ssh authorization-type default aaa");
    config.separator();

    if (!ssh.weak_crypto) {
        config.line("ssh server cipher aes256_ctr aes128_ctr");
        config.line("ssh server hmac sha2_256_96 sha2_256");
        config.line("ssh server key-exchange dh_group_exchange_sha256 ecdh_sha2_nistp256 ecdh_sha2_nistp384 ecdh_sha2_nistp521");
        config.separator();
    }
}

/** The console logs in with the device's users unless the config gives it a password of its own. Remote logins always use the users. */
function userInterfaces(config: Config, device: Device): void {
    const console = device.management?.console;

    const consoleLogin = console
        ? ["authentication-mode password", `set authentication password cipher ${marker(console.password)}`]
        : ["authentication-mode aaa"];

    config.block("user-interface con 0", consoleLogin);
    config.block("user-interface vty 0 4", ["authentication-mode aaa", `protocol inbound ${device.management?.telnet ? "all" : "ssh"}`]);
}

/** The platform offers an ECDSA host key it then signs wrongly, so RSA is asked for. */
const HOST_KEYS = ["ssh-rsa"];

export async function login(device: Device): Promise<Client> {
    const user = device.users?.[device.connection.user];
    if (!user) throw new Error(`${device.name}: connection user ${device.connection.user} is not one of its users`);
    return connect({
        host: device.connection.host,
        port: device.connection.port,
        user: device.connection.user,
        password: resolve(user.password),
        hostKeys: HOST_KEYS,
    });
}

/**
 * An interactive shell at the user prompt, paging off.
 *
 * Every login asks whether to change the password. Answering yes replaces it at once and every stored credential with it, so the answer is always no. Anything sent before the question is answered is taken as the answer.
 */
export async function openShell(client: Client): Promise<ClientChannel> {
    const channel = await shell(client);
    const banner = await readUntil(channel, (text) => /Change now\? ?\[Y\/N\]/i.test(text) || /<[^>]+>\s*$/.test(text), 15_000, 1500);
    if (/Change now\?/i.test(banner)) await send(channel, "N", 10_000, 1500);
    await send(channel, "screen-length 0 temporary", 10_000, 1500);
    return channel;
}

/** What the device runs, credentials scrubbed. */
export async function read(device: Device): Promise<string> {
    const client = await login(device);

    try {
        const channel = await openShell(client);
        const dump = await send(channel, "display current-configuration", 120_000, 3000);
        channel.end();

        const lines = dump.replace(/\r/g, "").split("\n");
        const start = lines.findIndex((line) => line.startsWith("!Software Version"));
        if (start < 0) throw new Error(`${device.name} returned no configuration`);
        // The prompt, and the stamp of the last change, are not configuration.
        const body = lines.slice(start).filter((line) => !/^<.*>$/.test(line.trim()) && !line.startsWith("!Last configuration"));
        return scrub(body.join("\n").trim() + "\n");
    } finally {
        client.end();
    }
}

export function unsupported(device: Device): string[] {
    const found: string[] = [];

    for (const [name, port] of Object.entries(device.ports ?? {})) {
        if (!port) continue;

        for (const field of ["speed", "acl", "mtu", "addresses", "vrrp", "vrf"] as const) {
            if (port[field] !== undefined) found.push(`ports.${name}.${field}, ports are switched; use a VLAN interface`);
        }

        if (port.lldp === true && !device.lldp) found.push(`ports.${name}.lldp true while LLDP is off on the device`);
        const storm = Object.values(port.storm_control ?? {});
        if (storm.some((threshold) => "pps" in threshold)) found.push(`ports.${name}.storm_control in pps, the platform takes percent`);
    }

    for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
        if (iface.type !== "vlan" && iface.type !== "lag") found.push(`interfaces.${name}, a ${iface.type}`);
        if (iface.type === "lag" && iface.addresses?.length) found.push(`interfaces.${name}.addresses, LAGs are switched`);
        for (const group of iface.vrrp ?? []) if (familyOf(group.address) === "ipv6") found.push(`interfaces.${name}.vrrp for IPv6`);
    }

    const routing = device.routing;
    if (routing?.bgp) found.push("routing.bgp");
    if (routing?.rpki) found.push("routing.rpki");
    if (routing?.ospf?.families?.includes("ipv6")) found.push("routing.ospf for IPv6");

    for (const field of ["firewall", "dhcp", "acls", "policies", "prefix_sets", "hardware_offload", "certificates"] as const) {
        if (device[field] !== undefined) found.push(field);
    }

    for (const [name, relay] of Object.entries(device.dhcp_relay ?? {})) {
        if (device.interfaces?.[relay.interface]?.type !== "vlan")
            found.push(`dhcp_relay.${name}.interface, relays run on VLAN interfaces`);
    }

    // The platform reserves this name.
    if (device.users && "admin" in device.users) found.push("users.admin, the platform reserves the name");

    const management = device.management ?? {};

    for (const field of ["http", "https", "api", "api_tls", "ftp", "native", "privilege_password"] as const) {
        if (management[field]) found.push(`management.${field}`);
    }

    if (management.ssh?.auth_timeout || management.ssh?.auth_retries) found.push("management.ssh.auth_timeout and auth_retries");

    if (device.lldp && device.lldp !== true) found.push("lldp.interfaces, use lldp on the ports instead");

    const system = device.system ?? {};

    if (system.dns || system.logging || system.release_channel || system.banner) {
        found.push("system.dns, logging, release_channel and banner");
    }

    const flow = device.flow_export;
    if (flow && flow.protocol !== "sflow") found.push(`flow_export.protocol ${flow.protocol}, the platform exports sFlow`);
    if (flow?.sampling !== undefined) found.push("flow_export.sampling, not verified on the platform yet");

    return found;
}

/** What the device prints when it refuses a line. */
const REFUSED = /^\s*Error|Unrecognized command|Incomplete command|Wrong parameter|Too many parameters/m;

/** A setting whose password the platform asks for interactively: the command, then the password, then the password again. */
const INTERACTIVE = /^(snmp-agent usm-user v3 \S+ (?:authentication|privacy)-mode \S+) cipher <secret:(\w+)>$/;

/** Send one line, answering a confirmation, and return what the device said. */
async function sendLine(channel: ClientChannel, line: string): Promise<string> {
    const interactive = INTERACTIVE.exec(line.trim());
    if (interactive) {
        const [, command, secretName] = interactive;
        const password = resolve(secretName!);
        let answer = await send(channel, command!, 15_000, 900);
        answer += await send(channel, password, 15_000, 900);
        answer += await send(channel, password, 15_000, 900);
        return answer;
    }

    let answer = await send(channel, substitute(line), 20_000, 800);
    if (/\[Y\/N\]/i.test(answer)) answer += await send(channel, "Y", 20_000, 800);
    return answer;
}

export async function apply(device: Device, _network: readonly Device[], plan: Plan): Promise<void> {
    const client = await login(device);
    const channel = await openShell(client);

    try {
        await send(channel, "system-view", 10_000, 1500);

        for (const step of plan.steps) {
            for (const line of step.send) {
                const answer = await sendLine(channel, line);
                if (REFUSED.test(answer)) throw new Error(`${step.title}: ${line}\n    device said: ${answer.trim().slice(0, 300)}`);
            }
        }

        const committed = await send(channel, "commit", 60_000, 3000);
        if (REFUSED.test(committed)) throw new Error(`commit refused: ${committed.trim().slice(0, 300)}`);
        await send(channel, "quit", 10_000);
    } catch (error) {
        // Nothing is committed yet. Clearing the candidate leaves the device as it was.
        await send(channel, "clear configuration candidate", 10_000).catch(() => undefined);
        channel.end();
        client.end();
        throw error;
    }

    const proof = await login(device).catch(() => undefined);
    if (!proof) {
        channel.end();
        client.end();
        throw new Error(
            "committed, but a fresh login failed. Not saved: a reboot restores the previous configuration. Recover over the open session or the console."
        );
    }

    proof.end();

    const saving = await send(channel, "save", 20_000, 2000);
    if (/\[Y\/N\]/i.test(saving)) await send(channel, "Y", 60_000, 5000);
    channel.end();
    client.end();
    console.log("  committed, login proved, saved");
}

export const vrp: DeviceAdapter = {
    extension: ".cfg",
    unsupported,
    render,
    read,
    plan: (desired, current) => ({ steps: steps(compare(desired, current, dialect), dialect), problems: [] }),
    apply,
};
