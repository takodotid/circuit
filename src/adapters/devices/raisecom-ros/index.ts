// Raisecom ROS, as on the RAX700 series.
//
// An interface or access-list opens a block, `!` closes it, and `no` removes a line. Commands apply as they arrive and persist only on `write`. There is no rollback, so management is proved reachable in a fresh session before anything is written: a reboot then restores what was there before.

import type { ClientChannel } from "ssh2";
import { familyOf, host, netmask, split } from "../../../core/addr";
import { marker, resolve, substitute } from "../../../core/secrets";
import { offset } from "../../../core/time";
import type { Device, Port } from "../../../schema";
import { connect, readUntil, send, shell } from "../../../transport/ssh";
import { portsOf, spell } from "../catalog";
import { compare, type Dialect, type Group, scrub, steps } from "../lines";
import type { DeviceAdapter, Plan } from "../types";

/** Lines the device prints whatever is configured, or that are part of moving around the CLI. */
const DEVICE_FACTS = [
    "Being processed",
    "System current configuration",
    "recv-mode",
    "mpls te periodic-flooding",
    "spanning-tree region-configuration",
    "interface NULL",
    "ip rarp",
    "quit",
    "config",
    "exit",
    // Implied by any layer 2 setting on a port; the plan sends it where needed.
    "portswitch",
];

/** Lines whose opposite is not `no` and the line. */
const OPPOSITES: [RegExp, string][] = [
    [/^lldp disable$/, "lldp enable"],
    [/^spanning-tree disable$/, "spanning-tree enable"],
    [/^switchport mode trunk$/, "switchport mode access"],
    [/^telnet-server disable$/, "telnet-server enable"],
    [/^shutdown$/, "no shutdown"],
];

/** Lines whose removal takes only their keyword, not their value. */
const UNDO_BY_KEYWORD =
    /^(description|switchport access vlan|switchport trunk native vlan|switchport trunk allowed vlan|storm-control broadcast|storm-control mode|ip address)\b/;

function undo(line: string): string {
    for (const [pattern, opposite] of OPPOSITES) if (pattern.test(line)) return opposite;
    if (/^rule \d+/.test(line)) return `no ${line.split(" ").slice(0, 2).join(" ")}`;

    const keyword = UNDO_BY_KEYWORD.exec(line);
    if (keyword) return `no ${keyword[1]}`;

    return `no ${line}`;
}

export const dialect: Dialect = {
    block: /^(interface |access-list )/,
    indented: false,
    terminator: "!",
    ignore: (line) => line.startsWith("!") || DEVICE_FACTS.some((fact) => line.startsWith(fact)),
    undo,
    leave: "exit",
    // A password prints as a cipher and renders as a marker; both are a secret.
    canon: (line) =>
        line.replace(/password (cipher )?(\S+)/, "password <secret>").replace(/community <secret:\w+>/, "community <redacted>"),
};

/** The access-list that guards every management service. */
export const MANAGEMENT_ACL = 1000;

/** `99,200-201,999`, the platform's compression of a VLAN list. */
export function vlanList(ids: number[]): string {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const ranges: string[] = [];

    for (let i = 0; i < sorted.length; i++) {
        let end = i;
        while (sorted[end + 1] === sorted[end]! + 1) end++;
        ranges.push(i === end ? `${sorted[i]}` : `${sorted[i]}-${sorted[end]}`);
        i = end;
    }

    return ranges.join(",");
}

type AnyPort = Port<string, string, string, string>;

export function render(device: Device): string {
    const lines: string[] = [];
    const vlans = device.vlans ?? {};
    const vlanId = (name: string) => vlans[name]!.id;
    const management = device.management ?? {};
    const allow = management.allow ?? [];

    const ids = Object.values(vlans).map((vlan) => vlan.id);
    if (ids.length) lines.push(`create vlan ${vlanList(ids)} active`, "!");

    if (allow.length) {
        // An access-list description takes one word.
        lines.push(`access-list ${MANAGEMENT_ACL}`, "  description management");
        allow.forEach((cidr, index) => lines.push(`  rule ${(index + 1) * 10} permit ${host(cidr)} ${netmask(split(cidr).len)}`));
        // Stated, so the list reads the same without knowing the firmware's implicit end.
        lines.push("  rule 100 deny any", "!");
    }

    for (const [name, user] of Object.entries(device.users ?? {})) lines.push(`user name ${name} password ${marker(user.password)}`);
    if (management.privilege_password) lines.push(`enable password ${marker(management.privilege_password)}`);

    const timezone = device.system?.timezone;
    if (timezone) {
        const minutes = offset(timezone);
        const absolute = Math.abs(minutes);
        lines.push(`clock timezone ${minutes < 0 ? "-" : "+"} ${Math.floor(absolute / 60)} ${absolute % 60} 0`);
    }

    lines.push("!");

    for (const port of portsOf(device.platform, device.model)) {
        const settings = device.ports?.[port as keyof typeof device.ports];
        lines.push(`interface ${spell(device.platform, device.model, port)}`, ...physicalPort(settings, vlanId), "!");
    }

    for (const iface of Object.values(device.interfaces ?? {})) {
        if (iface.type !== "vlan") continue;

        lines.push(`interface vlan ${vlanId(iface.vlan)}`);

        for (const entry of iface.addresses ?? []) {
            const address = typeof entry === "string" ? entry : entry.address;
            if (familyOf(address) === "ipv4") lines.push(`ip address ${host(address)} ${netmask(split(address).len)}`);
        }

        lines.push("!");
    }

    // Storm control acts only once detection is on.
    if (Object.values(device.ports ?? {}).some((port) => port?.storm_control)) lines.push("storm-control detection enable");
    if (device.system?.transceiver_monitoring) lines.push("transceiver ddm enable");
    // LLDP and spanning tree are off by default and turned on by the config.
    if (device.lldp) lines.push("lldp enable");
    if (device.stp) {
        lines.push("spanning-tree enable");
        if (device.stp.priority !== undefined) lines.push(`spanning-tree priority ${device.stp.priority}`);
    }

    // The factory communities survive a reset, and one of them can write, so they are always removed.
    lines.push("no snmp-server community public", "no snmp-server community private");
    if (management.snmp?.community) {
        lines.push(`snmp-server community ${marker(management.snmp.community)} ro`);
        if (allow.length) lines.push(`snmp-server access-list ${MANAGEMENT_ACL}`);
    }

    for (const route of device.routing?.static ?? []) {
        const { addr, len } = split(route.prefix);
        if (familyOf(addr) === "ipv4" && route.via) lines.push(`ip route ${addr} ${netmask(len)} ${route.via}`);
    }

    if (management.telnet) {
        lines.push("telnet-server enable");
        if (allow.length) lines.push(`telnet-server access-list ${MANAGEMENT_ACL}`);
    } else lines.push("telnet-server disable");

    const ssh = management.ssh;
    if (ssh?.auth_timeout) lines.push(`ssh2 server authentication-timeout ${ssh.auth_timeout}`);
    if (ssh?.auth_retries) lines.push(`ssh2 server authentication-retries ${ssh.auth_retries}`);
    if (ssh && allow.length) lines.push(`ssh2 access-list ${MANAGEMENT_ACL}`);

    const ntp = device.system?.ntp;
    if (ntp?.servers.length) lines.push("ntp enable", ...ntp.servers.map((server) => `ntp server ${server}`));

    return lines.join("\n") + "\n";
}

/** A port the config does not declare is shut down. */
function physicalPort(settings: AnyPort | undefined, vlanId: (name: string) => number): string[] {
    if (!settings) return ["shutdown"];

    const lines: string[] = [];
    if (settings.description) lines.push(`description ${settings.description}`);
    if (settings.access_vlan) lines.push(`switchport access vlan ${vlanId(settings.access_vlan)}`);
    if (settings.trunk_vlans) {
        if (settings.native_vlan) lines.push(`switchport trunk native vlan ${vlanId(settings.native_vlan)}`);
        lines.push(`switchport trunk allowed vlan ${vlanList(settings.trunk_vlans.map(vlanId))}`, "switchport mode trunk");
    }

    if (settings.lldp === false) lines.push("lldp disable");
    if (settings.stp === false) lines.push("spanning-tree disable");
    const broadcast = settings.storm_control?.broadcast;
    if (broadcast && "pps" in broadcast) lines.push("storm-control mode pps", `storm-control broadcast pps ${broadcast.pps}`);
    return lines;
}

/** The firmware offers only an `ssh-rsa` host key, so that one is allowed for this platform alone. Key exchange, cipher and MAC still negotiate modern ones. */
const HOST_KEYS = ["ssh-rsa"];

export type Session = { channel: ClientChannel; close: () => void };

/** An interactive shell, paging off. A session that does not answer as ROS is refused, so nothing meant for it can reach another shell. */
export async function open(device: Device): Promise<Session> {
    const user = device.users?.[device.connection.user];
    if (!user) throw new Error(`${device.name}: connection user ${device.connection.user} is not one of its users`);

    const client = await connect({
        host: device.connection.host,
        port: device.connection.port,
        user: device.connection.user,
        password: resolve(user.password),
        hostKeys: HOST_KEYS,
    });
    const channel = await shell(client);
    const close = () => {
        channel.end();
        client.end();
    };

    const banner = await readUntil(channel, (text) => /[#>]\s*$/.test(text.trimEnd()), 30_000);
    const version = await send(channel, "show version", 15_000, 1500);
    if (!/[#>]\s*$/.test(banner.trimEnd()) || !version.includes("ROS")) {
        close();
        throw new Error(`${device.name} did not answer as ROS`);
    }

    await send(channel, "terminal page-break disable", 15_000, 1000);
    return { channel, close };
}

/** What the device runs, credentials scrubbed. */
export async function read(device: Device): Promise<string> {
    const { channel, close } = await open(device);

    try {
        // Without paging off and a long wait for silence, the dump stops halfway with no error.
        const dump = await send(channel, "show running-config", 150_000, 6000);
        const lines = dump.replace(/\r/g, "").split("\n");
        const start = lines.findIndex((line) => line.trim().startsWith("!ROS version"));
        if (start < 0) throw new Error(`${device.name} returned no configuration`);

        // The prompt is not configuration; uptime, clock and boot count change on an untouched device.
        const body = lines.slice(start).filter((line) => line.startsWith("!") || !/[#>]\s*$/.test(line.trim()));
        const text = body
            .join("\n")
            .replace(/^!(System (up )?time|Boot times):.*\n/gm, "")
            .trim();
        return scrub(text + "\n");
    } finally {
        close();
    }
}

export function unsupported(device: Device): string[] {
    const found: string[] = [];

    for (const [name, port] of Object.entries(device.ports ?? {})) {
        if (!port) continue;

        for (const field of ["speed", "acl", "lag", "mtu", "addresses", "vrrp", "vrf"] as const) {
            if (port[field] !== undefined) found.push(`ports.${name}.${field}`);
        }

        if (port.lldp === true) found.push(`ports.${name}.lldp true, LLDP is turned on per device`);
        if (typeof port.stp === "object" || port.stp === true) found.push(`ports.${name}.stp other than false`);
        const storm = port.storm_control;
        if (storm && (storm.multicast || storm.unknown_unicast || (storm.broadcast && "percent" in storm.broadcast))) {
            found.push(`ports.${name}.storm_control other than broadcast in pps`);
        }
    }

    for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
        if (iface.type !== "vlan") found.push(`interfaces.${name}, a ${iface.type}`);
        else if (iface.vrrp || iface.vrf) found.push(`interfaces.${name}.vrrp and vrf`);
    }

    const routing = device.routing;

    for (const field of ["bgp", "rpki", "ospf"] as const) {
        if (routing?.[field]) found.push(`routing.${field}`);
    }

    for (const route of routing?.static ?? []) {
        if (!route.via || route.vrf) found.push(`routing.static ${route.prefix}, only an IPv4 next hop in the default table`);
    }

    const UNSUPPORTED_SECTIONS = [
        "firewall",
        "dhcp",
        "dhcp_relay",
        "acls",
        "policies",
        "prefix_sets",
        "hardware_offload",
        "certificates",
        "vrfs",
        "flow_export",
    ] as const;

    for (const field of UNSUPPORTED_SECTIONS) {
        if (device[field] !== undefined) found.push(field);
    }

    const management = device.management ?? {};

    for (const field of ["http", "https", "api", "api_tls", "ftp", "native", "console"] as const) {
        if (management[field]) found.push(`management.${field}`);
    }

    if (management.snmp?.users) found.push("management.snmp.users, version 3");

    if (device.lldp && device.lldp !== true) found.push("lldp.interfaces, LLDP is per device");
    if (device.stp?.mode && device.stp.mode !== "mstp") found.push("stp.mode other than mstp");

    for (const [name, user] of Object.entries(device.users ?? {})) {
        if (user.role !== "admin") found.push(`users.${name}.role other than admin`);
    }

    const system = device.system ?? {};

    if (system.dns || system.logging || system.release_channel || system.banner || system.ntp?.serve) {
        found.push("system.dns, logging, release_channel, banner and ntp.serve");
    }

    return found;
}

/** What the device prints when it refuses a line. */
const REFUSED = /^(%|Error|Incomplete|Unrecognized)|can not|cannot |is in use|Wrong parameter|invalid/im;

/** Lines that ask for `y` and do nothing without it. */
const CONFIRM = /^(portswitch|switchport trunk allowed vlan|switchport mode)/;

/** A service letting go of an access-list, so the list can change. */
const RELEASE = /^no (\S+ access-list \d+)$/;

export async function apply(device: Device, _network: readonly Device[], plan: Plan): Promise<void> {
    const { channel, close } = await open(device);
    // Bindings released for an access-list edit. A failure binds them again before anything else, so the list keeps guarding management.
    const released: string[] = [];

    try {
        await send(channel, "config", 10_000);

        for (const step of plan.steps) {
            for (const line of step.send) {
                let answer = await send(channel, substitute(line), 20_000, 1000);
                if (/[[(]y\/n[\])]|input 'y'/i.test(answer) || CONFIRM.test(line)) answer += await send(channel, "y", 10_000, 1000);
                if (REFUSED.test(answer)) throw new Error(`${step.title}: ${line}\n    device said: ${answer.trim().slice(0, 300)}`);

                const release = RELEASE.exec(line);
                if (release) released.push(release[1]!);
                else if (released.includes(line)) released.splice(released.indexOf(line), 1);
            }
        }

        await send(channel, "exit", 10_000);
    } catch (error) {
        await send(channel, "end", 10_000).catch(() => undefined);
        await send(channel, "config", 10_000).catch(() => undefined);
        for (const binding of released) await send(channel, binding, 10_000).catch(() => undefined);
        if (released.length) console.log(`  bound again: ${released.join(", ")}`);
        throw error;
    } finally {
        close();
    }

    const proof = await open(device).catch(() => undefined);
    if (!proof)
        throw new Error(
            "applied, but a fresh login failed. Not written: a reboot restores the previous configuration. Recover from the console."
        );
    await send(proof.channel, "write", 60_000, 3000);
    proof.close();
    console.log("  applied, login proved, written");
}

/** Services holding the management access-list. It cannot change while any of them does. */
const holders = (config: string) =>
    [...config.matchAll(new RegExp(`^([a-z0-9-]+) access-list ${MANAGEMENT_ACL}$`, "gm"))].map((match) => match[1]!);

function plan(desired: string, current: string): ReturnType<DeviceAdapter["plan"]> {
    const groups = compare(desired, current, dialect);

    // A port takes layer 2 settings only once it is switched.
    for (const group of groups) {
        const isPort = group.path[0]?.startsWith("interface ") ?? false;
        if (isPort && group.add.some((line) => line.startsWith("switchport"))) group.add.unshift("portswitch");
    }

    // Editing the access-list means releasing every service holding it first, and binding the wanted ones after.
    const releaseAndBind = (group: Group) => {
        if (group.path[0] !== `access-list ${MANAGEMENT_ACL}`) return { before: [], after: [] };

        return {
            before: holders(current).map((service) => `no ${service} access-list ${MANAGEMENT_ACL}`),
            after: holders(desired).map((service) => `${service} access-list ${MANAGEMENT_ACL}`),
        };
    };

    return { steps: steps(groups, dialect, releaseAndBind), problems: [] };
}

export const raisecom: DeviceAdapter = { extension: ".txt", unsupported, render, read, plan, apply };
