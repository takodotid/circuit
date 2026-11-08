// What Circuit does with a project: import its `circuit.ts`, then every device file under `sites/`, check what the types cannot, run the project's own
// checks on the network resolved, and turn what the language adds (lists in a match, interface sets, `bgpNeighbors`, `{ communities }` rules, an
// address with its length where the model keeps it alone, `management.allow` as an address set's name) into the model's plain values, which the
// platforms read (`src/model.ts`). It fills in nothing but the network's AS on BGP, which the model needs.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogue, schemeProblems, writeCommunities } from "../config/communities";
import { BGP_NEIGHBORS, type Registered, registry } from "../config/define";
import type { AnyDevice } from "../config/device";
import type { Community, Finding, ResolvedNetwork } from "../config/network";
import * as globals from "../config/index";
import { ACTIONS, CHECKS, DEVICE, NETWORK, POLICY_RULE, closest, unknownKeyHelp, unknownKeys } from "../config/keys";
import { isOrdered, lineOf, source, userFrames, writtenAt } from "../config/merge";
import { NUMBERED_VLANS, portsOf, spell } from "../config/models";
import { policyRuleProblem } from "../config/routing";
import { Address } from "../core/address";
import { Secrets } from "../core/secrets";
import { SecretsFile } from "../core/secrets-file";
import { Utils } from "../core/utils";
import type { Device } from "../model";

// The model's JSON, walked without its types.
type Json = any;

/** One network of a project, as its devices run it. */
export type ProjectNetwork = {
    /** Its name in `circuit.ts`, such as `as64500`. */
    name: string;
    asn?: number;
    /** What each community of the network's scheme means, for a looking glass or bgp.tools. */
    communities: Community[];
    /** Each device, in the model the platforms read, by hostname. */
    devices: Record<string, Device>;
    /** The file that writes each device, from the project's folder. */
    files: Record<string, string>;
    /** The rest of `circuit()`: sites, checks, integrations. */
    settings: Json;
};

/** The secrets file of a network, relative to the project: the one `secrets.file` names, or `.circuit/secrets`. */
export function secretsFileOf(network: Pick<ProjectNetwork, "settings">): string {
    return ((network.settings.secrets as Json | undefined)?.file as string | undefined) ?? SecretsFile.DEFAULT;
}

/** What reading a project found: each network, and what Circuit tells but doesn't stop on. What stops it is thrown as `ProjectError`. */
export type ProjectRead = { networks: ProjectNetwork[]; warnings: string[] };

/** A project that can't be read, with each reason. */
export class ProjectError extends Error {
    constructor(readonly lines: string[]) {
        super(lines.join("\n"));
    }
}

let project = "";

/** Paths from the project root, with forward slashes. */
const short = (text: string) => text.replaceAll(project + sep, "").replaceAll("\\", "/");

const stop = (lines: string[]): never => {
    throw new ProjectError(lines.map(short));
};

const many = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const keys = (map: unknown) => Object.keys((map as object | undefined) ?? {});
/** Text as a regular expression that matches it as written. */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let findings: string[] = [];
/** What Circuit tells but doesn't stop on. */
let warnings: string[] = [];

/**
 * Imports one file of the project. Its `merge` calls and devices run: a value written twice, or an ordered list from two places, stops it
 * there, naming both files. Anything else that stops it, such as a misspelt global, is said with the user's line it stopped at.
 */
async function load(file: string): Promise<Record<string, unknown>> {
    registry.reading = file;
    try {
        return await import(pathToFileURL(file).href);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const at = error instanceof Error && !/^\S+\.ts:\d+: /.test(message) ? (userFrames(error)[0] ?? file) : undefined;
        return stop([at ? `${at}: ${message}` : message]);
    }
}

/**
 * Reads the project in `folder`: imports `circuit.ts` and each device file, checks the whole network, runs the project's own checks,
 * and gives each network's devices in the model. Throws `ProjectError` with every reason when the project can't be read.
 */
export async function readProject(folder: string): Promise<ProjectRead> {
    project = resolve(folder);
    findings = [];
    warnings = [];
    registry.networks.length = 0;
    registry.sources.length = 0;
    registry.rules.length = 0;
    Utils.root = project;
    Secrets.useRoot(project);
    // Circuit's functions and `presets` are globals (circuit.d.ts): the project's files use them with no import.
    Object.assign(globalThis, globals);
    // Where a key is written is found by reading the file that writes it.
    source.read = (file) => readFileSync(file, "utf8");

    if (!existsSync(resolve(project, "circuit.ts")))
        stop([`${project} has no circuit.ts. Start one by running circuit, or give the project's folder.`]);

    // circuit.ts first: the networks it exports.
    const root = await load(resolve(project, "circuit.ts"));

    /**
     * Then every device file: each `.ts` under `sites/`, at any depth, but `site.ts`, which holds what a site's devices share. `lib/` and
     * `tenants/` are imported only by the files that use them. A device file's `<network>.device(...)` registers it with that network.
     */
    const sites = resolve(project, "sites");
    const files = existsSync(sites)
        ? (readdirSync(sites, { recursive: true }) as string[])
              .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && basename(f) !== "site.ts")
              .map((f) => resolve(sites, f))
              .sort()
        : [];
    for (const file of files) await load(file);

    /** Each network, by its name in circuit.ts, or by its AS when it is the default export. */
    const networks: { name: string; registered: Registered; network: Json; devices: Record<string, AnyDevice> }[] = [];
    for (const registered of registry.networks) {
        const name = Object.keys(root).find((k) => root[k] === registered.network);
        const network = registered.network as Json;
        if (name === undefined)
            findings.push(
                `${registered.at}: this network is not exported from circuit.ts. Export each network under its own name, after its AS: export const as64500 = circuit({ ... }).`
            );
        else networks.push({ name: name === "default" ? `as${network.asn}` : name, registered, network, devices: {} });
    }
    for (const { registered, network } of networks) {
        const file = (network.secrets as Json | undefined)?.file;
        if (
            network.secrets !== undefined &&
            (typeof file !== "string" || !file.trim() || isAbsolute(file) || file.split(/[\\/]/).includes(".."))
        )
            findings.push(
                `${registered.at}: secrets.file is a path inside the project, such as ".circuit/lab-secrets". Leave secrets out for .circuit/secrets.`
            );
    }
    if (!registry.networks.length)
        stop([
            "circuit.ts makes no network. Write it as export const as64500 = circuit({ asn, sites, checks, integrations }), named after its AS.",
        ]);

    /** Each device file registers one device. */
    const registeredBy = new Map<string, string[]>();
    for (const { devices } of registry.networks)
        for (const { device, file } of devices) registeredBy.set(file, [...(registeredBy.get(file) ?? []), device.name]);
    for (const file of files) {
        const names = registeredBy.get(file) ?? [];
        if (!names.length)
            findings.push(
                `${file}: registers no device. Each .ts under sites/, but site.ts, is one device: export default as64500.device({ ... }), with your network's name. What a site's devices share goes in its site.ts.`
            );
        else if (names.length > 1)
            findings.push(`${file}: registers ${names.length} devices, ${names.join(", ")}. Write one file per device.`);
    }

    /** Each network's devices by name. A name twice is an error naming both files. */
    for (const n of networks)
        for (const { device, at } of n.registered.devices) {
            const first = n.registered.devices.find((d) => d.device.name === device.name)!;
            if (first.device !== device)
                findings.push(
                    `${at}: ${device.name} is registered twice with network ${n.name}, here and in ${first.at}. A hostname is one device.`
                );
            else n.devices[device.name] = device;
        }
    const everyDevice = networks.flatMap((n) => Object.values(n.devices));

    /**
     * Where a finding of the project's own check is, as `file:line: `: the line that writes the deepest key of `path` its device has, such
     * as a port a tenant's file gives; with no path, or none of it found, the line that made the device.
     */
    function foundAt(device: AnyDevice, path: string | undefined, registeredAt: string): string {
        const names: string[] = [];
        let value: Json = device;
        let last: [Json, string] | undefined;
        for (const step of path?.match(/[^.[\]]+/g) ?? []) {
            if (!value || typeof value !== "object" || !Object.hasOwn(value, step)) break;
            if (!Array.isArray(value)) {
                names.push(step);
                last = [value, step];
            }
            value = value[step];
        }
        return (last && writtenAt(last[0], last[1], names)) || `${registeredAt}: `;
    }

    /** Each address set written `bgpNeighbors()` gets every BGP neighbor address of its device. */
    for (const d of everyDevice as Json[]) {
        const sets = d.firewall?.address_sets ?? {};
        for (const [name, set] of Object.entries<Json>(sets))
            if (Object.hasOwn(set, BGP_NEIGHBORS)) sets[name] = Object.values<Json>(d.routing?.bgp?.neighbors ?? {}).map((n) => n.address);
    }

    // ---------- what only Circuit can check: the whole network ----------

    /** Each hostname a source gives a part to is a device of the network of the device it is given to: a misspelt one would give its part to no one. */
    const reported = new Set<string>();
    for (const { source, device, file, network } of registry.sources) {
        const devices = networks.find((n) => n.registered.network === network)?.devices ?? {};
        for (const host of keys(source)) {
            const written = writtenAt(source, host);
            const where = written ? `${written}the source made here` : `${file}: a source given to ${device}`;
            if (devices[host] || reported.has(`${where} ${host}`)) continue;
            reported.add(`${where} ${host}`);
            findings.push(`${where} has a part for ${host}, which is no device of the network. The devices: ${keys(devices).join(", ")}.`);
        }
    }

    /** Every ordered list of a device: a chain's rules, NAT, an ACL, a route policy, policy routing. */
    function* orderedLists(value: unknown, path = ""): Generator<readonly object[]> {
        if (Array.isArray(value)) {
            if (isOrdered(path)) yield value;
        } else if (value && typeof value === "object")
            for (const [k, v] of Object.entries(value)) yield* orderedLists(v, path ? `${path}.${k}` : k);
    }

    /** Every rule a rule-list `part` made is in some device's ordered list: the file that writes the list has to place it, and may forget. */
    const placed = new Set<object>(everyDevice.flatMap((d) => [...orderedLists(d)].flat()));
    for (const { rules, file } of registry.rules) {
        const lost = rules.filter((rule) => !placed.has(rule)) as Json[];
        if (lost.length)
            findings.push(
                `${file}: ${lost.length} of the rules made here with part ${lost.length === 1 ? "is" : "are"} in no device: ${lost.map((r) => JSON.stringify(r.description ?? r.if ?? r.match ?? r)).join(", ")}. Place them in the ordered list where they go, with merge.`
            );
    }

    // ---------- each network ----------

    /** Each device's `site` is one of the network's sites, each site has a device, and each device a check names is one. */
    function places(network: Json, devices: Record<string, AnyDevice>, at: (name: string) => string) {
        const sites = keys(network.sites);
        for (const [name, d] of Object.entries(devices))
            if (!sites.includes(d.site)) {
                const hint = closest(d.site, sites);
                findings.push(
                    `${at(name)}${name}: site ${d.site} is no site of the network${hint ? `. Did you mean ${hint}?` : `. The sites: ${sites.join(", ")}.`}`
                );
            }
        for (const site of sites)
            if (!Object.values(devices).some((d) => d.site === site))
                findings.push(`sites.${site}: no device is at this site. Remove it, or add a device.`);
        const trust = network.checks?.untrusted_vlans;
        for (const [field, named] of [
            ["filtering_devices", trust?.filtering_devices],
            ["mixed_links", trust?.mixed_links?.flat()],
        ] as const)
            for (const name of many(named) as string[])
                if (!devices[name])
                    findings.push(`checks.untrusted_vlans.${field}: no device ${name}. The devices: ${keys(devices).join(", ")}.`);
    }

    /**
     * `untrusted: true` on a VLAN is only for the check `untrusted_vlans`, so it needs the check on. A VLAN written so on one device is
     * written so on every device that declares it.
     */
    function untrusted(network: Json, devices: Record<string, AnyDevice>) {
        const flags = new Map<string, { on: string[]; off: string[] }>();
        // Without the check, each place that writes the flag, once, with the devices that take the VLAN from there.
        const unread = new Map<string, string[]>();
        for (const d of Object.values(devices)) {
            for (const [name, vlan] of Object.entries<Json>(d.switching?.vlans ?? {})) {
                const flag = flags.get(name) ?? { on: [], off: [] };
                if (vlan.untrusted) flag.on.push(d.name);
                else flag.off.push(`${d.name} (${writtenAt(vlan, "id", ["vlans", name]).slice(0, -2) || "?"})`);
                flags.set(name, flag);
                if (!vlan.untrusted || network.checks?.untrusted_vlans) continue;
                const where = `${writtenAt(vlan, "untrusted", ["vlans", name])}VLAN ${name}`;
                unread.set(where, [...(unread.get(where) ?? []), d.name]);
            }
        }
        for (const [where, names] of [...unread].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })))
            findings.push(
                `${where} has untrusted: true (${names.join(", ")}), but circuit.ts doesn't turn on the check untrusted_vlans, the only thing that reads it. Turn it on, or remove untrusted.`
            );
        for (const [name, { on, off }] of flags)
            if (on.length && off.length)
                findings.push(
                    `VLAN ${name} is untrusted on ${on.join(", ")} but not on ${off.join(", ")}: write untrusted: true on every device that declares it.`
                );
    }

    /** One VLAN name has one ID on every device: a VLAN with two or more is named once, with each ID, its devices, and where each is written. */
    function sameVlanIds(network: Json, devices: Record<string, AnyDevice>) {
        if (!network.checks?.same_vlan_ids) return;
        const ids = new Map<string, Map<number, string[]>>();
        for (const d of Object.values(devices))
            for (const [name, vlan] of Object.entries<Json>(d.switching?.vlans ?? {})) {
                const byId = ids.get(name) ?? new Map<number, string[]>();
                byId.set(vlan.id, [
                    ...(byId.get(vlan.id) ?? []),
                    `${d.name} (${writtenAt(vlan, "id", ["vlans", name]).slice(0, -2) || "?"})`,
                ]);
                ids.set(name, byId);
            }
        for (const [name, byId] of ids)
            if (byId.size > 1)
                findings.push(
                    `VLAN ${name} has ${byId.size} IDs: ${[...byId].map(([id, on]) => `${id} on ${on.join(", ")}`).join("; ")}. One VLAN name has one ID in the network (check same_vlan_ids).`
                );
    }

    // ---------- each device ----------

    /** The steps of a path that are keys, not list positions: `firewall.nat.source[0].if` is firewall, nat, source, if. */
    const steps = (path: string) => path.match(/[^.[\]]+/g)?.filter((s) => !/^\d+$/.test(s)) ?? [];

    /**
     * Every key a device writes, its parts' included, is one Circuit takes there (`DEVICE`, from the types), and each filter, NAT and ACL
     * rule's `then` is one its kind takes. A route policy rule is checked whole by `names`, as its kind decides what it may hold.
     */
    function known(name: string, device: AnyDevice, registeredAt: string) {
        for (const u of unknownKeys(device, DEVICE)) {
            const path = u.path ? `${u.path}.${u.key}` : u.key;
            findings.push(`${foundAt(device, path, registeredAt)}${name}: ${path}: no such field. ${unknownKeyHelp(u)}`);
        }
        const d = device as Json;
        const lists: [keyof typeof ACTIONS, string, unknown][] = [
            ...Object.entries<Json>(d.firewall?.filter ?? {}).map(([chain, c]): [keyof typeof ACTIONS, string, unknown] => [
                "filter",
                `firewall.filter.${chain}.rules`,
                c?.rules,
            ]),
            ["nat", "firewall.nat.source", d.firewall?.nat?.source],
            ["nat", "firewall.nat.destination", d.firewall?.nat?.destination],
            ...Object.entries<Json>(d.switching?.acls ?? {}).map(([acl, rules]): [keyof typeof ACTIONS, string, unknown] => [
                "acl",
                `switching.acls.${acl}`,
                rules,
            ]),
        ];
        for (const [kind, at, rules] of lists)
            many(rules).forEach((rule: Json, i) => {
                const takes: readonly string[] = ACTIONS[kind];
                if (!rule || typeof rule !== "object" || takes.includes(rule.then)) return;
                const path = `${at}[${i}].then`;
                const hint = typeof rule.then === "string" ? closest(rule.then, takes) : undefined;
                const what =
                    rule.then === undefined ? `a ${kind} rule needs then` : `${JSON.stringify(rule.then)} is no then of a ${kind} rule`;
                findings.push(
                    `${foundAt(device, rule.then === undefined ? `${at}[${i}]` : path, registeredAt)}${name}: ${path}: ${what}. ${hint ? `Did you mean ${hint}?` : `It takes: ${takes.join(", ")}.`}`
                );
            });
    }

    /**
     * Every key `circuit()` is given is one it takes (`NETWORK`), and so is every setting of a built-in check. A check of the project's own
     * has a name of its own. Returns whether `communities` has a key it doesn't take: the scheme is then not read further.
     */
    function knownSettings(network: Json, at: string): boolean {
        const { device: _, checks, ...settings } = network;
        const found = [
            ...unknownKeys(settings, NETWORK),
            ...Object.entries<Json>(checks ?? {}).flatMap(([check, value]) =>
                Object.hasOwn(CHECKS, check) ? unknownKeys(value, CHECKS[check as keyof typeof CHECKS], `checks.${check}`) : []
            ),
        ];
        for (const u of found) {
            const path = u.path ? `${u.path}.${u.key}` : u.key;
            findings.push(`${lineOf(at, steps(path))}${path}: no such field. ${unknownKeyHelp(u)}`);
        }
        return found.some((u) => u.path.startsWith("communities"));
    }

    /** Every name a device refers to is one it declares. The editor checks the same; this catches what reaches the device as a plain `string`. */
    function names(name: string, d: Json) {
        const kinds = ["ethernet", "lag", "vlan_interface", "bridge", "loopback", "gre", "vxlan", "wireguard", "eoip"];

        // An interface's name is one interface: a rule or a route that names it would otherwise not say which.
        const groupsOf = new Map<string, string[]>();
        for (const kind of kinds) for (const i of keys(d.interfaces?.[kind])) groupsOf.set(i, [...(groupsOf.get(i) ?? []), kind]);
        for (const [i, groups] of groupsOf)
            if (groups.length > 1)
                findings.push(
                    `${name}: interface ${i} is in ${groups.map((g) => `interfaces.${g}`).join(" and ")}. Give each interface its own name.`
                );

        const has: Record<string, Set<string>> = {
            VLAN: new Set(keys(d.switching?.vlans)),
            interface: new Set(kinds.flatMap((k) => keys(d.interfaces?.[k]))),
            LAG: new Set(keys(d.interfaces?.lag)),
            "VLAN interface": new Set(keys(d.interfaces?.vlan_interface)),
            ACL: new Set(keys(d.switching?.acls)),
            policy: new Set(keys(d.routing?.policies)),
            "prefix set": new Set(keys(d.routing?.prefix_sets)),
            "neighbor group": new Set(keys(d.routing?.bgp?.neighbor_groups)),
            table: new Set(["main", ...keys(d.routing?.tables)]),
            VRF: new Set(keys(d.routing?.vrfs)),
            "address set": new Set(keys(d.firewall?.address_sets)),
            "interface set": new Set(keys(d.firewall?.interface_sets)),
            user: new Set(keys(d.system?.users)),
            certificate: new Set(keys(d.system?.certificates)),
        };
        const need = (kind: string, value: unknown, where: string, written = "") => {
            for (const v of many(value)) {
                if (typeof v !== "string" || has[kind]!.has(v)) continue;
                const hint = closest(v, has[kind]!);
                findings.push(`${written}${name}: ${where}: no ${kind} ${v}${hint ? `. Did you mean ${hint}?` : ""}`);
            }
        };

        need("user", d.connection?.user, "connection.user");
        if (typeof d.management?.allow === "string") need("address set", d.management.allow, "management.allow");
        for (const [k, s] of Object.entries<Json>(d.management ?? {})) {
            if (k === "interfaces") need("interface", s, "management.interfaces");
            else if (s && typeof s === "object") {
                need("interface", s.interfaces, `management.${k}.interfaces`, writtenAt(d.management, k, ["management", k]));
                need("certificate", s.certificate, `management.${k}.certificate`, writtenAt(d.management, k, ["management", k]));
            }
        }
        need("interface", d.monitoring?.flow_export?.interfaces, "monitoring.flow_export.interfaces");
        for (const [v, vdom] of Object.entries<Json>(d.system?.vdoms ?? {}))
            need("interface", vdom.interfaces, `system.vdoms.${v}.interfaces`);

        for (const kind of kinds)
            for (const [i, x] of Object.entries<Json>(d.interfaces?.[kind] ?? {})) {
                const at = `interfaces.${kind}.${i}`;
                const written = writtenAt(d.interfaces[kind], i, [kind, i]);
                for (const f of ["access_vlan", "trunk_vlans", "native_vlan", "vlan"]) need("VLAN", x[f], `${at}.${f}`, written);
                need("ACL", x.ingress_acl, `${at}.ingress_acl`, written);
                need("LAG", x.in_lag, `${at}.in_lag`, written);
                need("VRF", x.vrf, `${at}.vrf`, written);
                need("VLAN interface", x.member_interfaces, `${at}.member_interfaces`, written);
                need("table", x.routing_table, `${at}.routing_table`, written);
                (x.dhcp_client?.default_routes ?? []).forEach((r: Json, n: number) =>
                    need("table", r.routing_table, `${at}.dhcp_client.default_routes[${n}].routing_table`, written)
                );
            }
        if (typeof d.switching?.lldp === "object") need("interface", d.switching.lldp.interfaces, "switching.lldp.interfaces");
        for (const [a, rules] of Object.entries<Json>(d.switching?.acls ?? {}))
            rules.forEach((r: Json, i: number) =>
                need("VLAN", r.if?.vlan, `switching.acls.${a}[${i}].if.vlan`, writtenAt(d.switching.acls, a, ["acls", a]))
            );

        for (const group of ["dhcp_server", "dhcp_relay"])
            for (const [s, x] of Object.entries<Json>(d.services?.[group] ?? {}))
                need("interface", x.interface, `services.${group}.${s}.interface`, writtenAt(d.services[group], s, [group, s]));
        need("interface", d.services?.upnp?.internal, "services.upnp.internal");
        need("interface", d.services?.upnp?.external, "services.upnp.external");

        (d.routing?.static_routes ?? []).forEach((r: Json, i: number) => {
            need("interface", r.interface, `routing.static_routes[${i}].interface`);
            need("table", r.routing_table, `routing.static_routes[${i}].routing_table`);
            need("VRF", r.vrf, `routing.static_routes[${i}].vrf`);
        });
        (d.routing?.policy_routing ?? []).forEach((r: Json, i: number) => {
            need("interface", r.match?.in_interface, `routing.policy_routing[${i}].match.in_interface`);
            need("table", r.routing_table, `routing.policy_routing[${i}].routing_table`);
        });
        for (const [kind, map] of [
            ["neighbor_groups", d.routing?.bgp?.neighbor_groups],
            ["neighbors", d.routing?.bgp?.neighbors],
        ] as const)
            for (const [n, x] of Object.entries<Json>(map ?? {})) {
                const written = writtenAt(map, n, [kind, n]);
                need("neighbor group", x.neighbor_group, `routing.bgp.${kind}.${n}.neighbor_group`, written);
                need("policy", x.import_policy, `routing.bgp.${kind}.${n}.import_policy`, written);
                need("policy", x.export_policy, `routing.bgp.${kind}.${n}.export_policy`, written);
                need("table", x.routing_table, `routing.bgp.${kind}.${n}.routing_table`, written);
            }
        for (const [p, rules] of Object.entries<Json>(d.routing?.policies ?? {}))
            rules.forEach((rule: Json, i: number) => {
                const written = writtenAt(d.routing.policies, p, ["policies", p]);
                // A key no policy rule has is said once, by `known`.
                const problem = unknownKeys(rule, POLICY_RULE).length ? undefined : policyRuleProblem(rule);
                if (problem) return findings.push(`${written}${name}: routing.policies.${p}[${i}]: ${problem}`);
                need("policy", rule.call, `routing.policies.${p}[${i}].call`, written);
                need("prefix set", rule.if?.prefix_set, `routing.policies.${p}[${i}].if.prefix_set`, written);
            });
        for (const [a, area] of Object.entries<Json>(d.routing?.ospf?.areas ?? {}))
            need("interface", keys(area.interfaces), `routing.ospf.areas.${a}.interfaces`);

        for (const [s, members] of Object.entries<Json>(d.firewall?.interface_sets ?? {}))
            need("interface", members, `firewall.interface_sets.${s}`, writtenAt(d.firewall.interface_sets, s, ["interface_sets", s]));
        const lists = [
            ...Object.entries<Json>(d.firewall?.filter ?? {}).map(([chain, c]) => [`firewall.filter.${chain}.rules`, c.rules] as const),
            ["firewall.nat.source", d.firewall?.nat?.source] as const,
            ["firewall.nat.destination", d.firewall?.nat?.destination] as const,
            ["firewall.tcp_mss", d.firewall?.tcp_mss] as const,
        ];
        for (const [at, rules] of lists)
            (rules ?? []).forEach((r: Json, i: number) => {
                const m = r.if ?? {};
                for (const way of ["in", "out"]) {
                    need("interface", m[`${way}_interface`], `${at}[${i}].if.${way}_interface`);
                    need("interface set", m[`${way}_interface_set`], `${at}[${i}].if.${way}_interface_set`);
                    if (m[`${way}_interface`] !== undefined && m[`${way}_interface_set`] !== undefined)
                        findings.push(`${name}: ${at}[${i}].if: ${way}_interface and ${way}_interface_set together. Use one.`);
                }
                need("address set", m.src_address_set, `${at}[${i}].if.src_address_set`);
                need("address set", m.dst_address_set, `${at}[${i}].if.dst_address_set`);
            });
    }

    /**
     * Each port is one the model has, and each link names a device and port that link back. A linked port's description names the far end,
     * `<far device> <far port as printed there>`: Circuit warns when it doesn't, and writes nothing. `devices` is the device's network.
     */
    function links(name: string, device: AnyDevice, devices: Record<string, AnyDevice>) {
        const ports = portsOf(device.platform, device.model);
        for (const [port, settings] of Object.entries(device.interfaces?.ethernet ?? {})) {
            const at = `${writtenAt(device.interfaces?.ethernet, port, ["ethernet", port])}${name}: interfaces.ethernet.${port}`;
            if (!ports.includes(port)) findings.push(`${at}: ${device.model} has no port ${port}`);
            const link = settings.link;
            if (!link) continue;
            const far = devices[link.device]?.interfaces?.ethernet?.[link.port];
            if (!devices[link.device]) findings.push(`${at}.link: no device ${link.device}`);
            else if (!far) findings.push(`${at}.link: ${link.device} has no port ${link.port}`);
            else if (far.link?.device !== name || far.link.port !== port)
                findings.push(`${at}.link: ${link.device} ${link.port} does not link back to ${name} ${port}`);
            else if (far.link.through !== link.through) findings.push(`${at}.link: the two ends name another \`through\``);
            else {
                const farPort = spell(devices[link.device]!.platform, devices[link.device]!.model, link.port);
                // A name counts as a word of its own: `port6` is not named by `port60`.
                const names = (text: string) => new RegExp(`(^|\\s)${escape(text)}($|[\\s,.;:)])`).test(settings.description ?? "");
                if (!names(link.device) || !names(farPort))
                    warnings.push(
                        `${at}.description: ${settings.description === undefined ? "none" : JSON.stringify(settings.description)}, which doesn't name the far end of its link as printed there: ${link.device} ${farPort}.`
                    );
            }
        }
    }

    /**
     * The network as the project's own checks read it: as its devices will run it, still in the language's shape (`ResolvedDevice`). A
     * copy of each device: each neighbor with what it takes from its group; each policy with each `call` replaced by the called policy's
     * rules (its `{ communities }` rules are written out already); `management.allow` written as an address set's name as that set's
     * addresses; a rule's interface set as its interfaces.
     */
    function resolvedForChecks(network: Json, devices: Record<string, AnyDevice>): ResolvedNetwork {
        const resolved = Object.values(devices).map((device) => {
            const d = JSON.parse(JSON.stringify(device));
            const bgp = d.routing?.bgp;
            for (const [name, n] of Object.entries<Json>(bgp?.neighbors ?? {}))
                bgp.neighbors[name] = { ...(n.neighbor_group ? bgp.neighbor_groups?.[n.neighbor_group] : {}), ...n };

            const policies = d.routing?.policies ?? {};
            // A policy that calls itself, at any depth, is not followed again.
            const inline = (rules: Json[], seen: string[]): Json[] =>
                rules.flatMap((r) =>
                    r.call === undefined ? [r] : seen.includes(r.call) ? [] : inline(policies[r.call] ?? [], [...seen, r.call])
                );
            if (d.routing?.policies)
                d.routing.policies = Object.fromEntries(Object.entries<Json>(policies).map(([p, rules]) => [p, inline(rules, [p])]));

            if (typeof d.management?.allow === "string") d.management.allow = d.firewall?.address_sets?.[d.management.allow] ?? [];
            const sets = d.firewall?.interface_sets ?? {};
            const rules = [
                ...Object.values<Json>(d.firewall?.filter ?? {}).flatMap((c) => c.rules ?? []),
                ...(d.firewall?.nat?.source ?? []),
                ...(d.firewall?.nat?.destination ?? []),
                ...(d.firewall?.tcp_mss ?? []),
            ];
            for (const rule of rules)
                for (const way of ["in", "out"])
                    if (rule.if?.[`${way}_interface_set`] !== undefined) {
                        rule.if[`${way}_interface`] = sets[rule.if[`${way}_interface_set`]] ?? [];
                        delete rule.if[`${way}_interface_set`];
                    }
            if (d.firewall) delete d.firewall.interface_sets;
            return d;
        });
        return { asn: network.asn, prefixes: network.prefixes ?? {}, devices: resolved };
    }

    // The project's own checks: every name in `checks` that holds a function. Any other name is one of Circuit's.
    const BUILT_IN = Object.keys(CHECKS);

    // Each network on its own. With several, each finding starts with the network's name.
    for (const { name: networkName, registered, network, devices } of networks) {
        const start = findings.length;
        places(network, devices, (name) => registered.devices.find((d) => d.device.name === name)!.at + ": ");
        const schemeKnown = !knownSettings(network, registered.at);
        untrusted(network, devices);
        sameVlanIds(network, devices);
        if (schemeKnown) for (const finding of schemeProblems(network)) findings.push(`${registered.at}: ${finding}`);
        for (const [name, device] of Object.entries(devices)) {
            known(name, device, registered.devices.find((d) => d.device === device)!.at);
            names(name, device);
            links(name, device, devices);
            if (device.routing?.bgp && device.routing.bgp.asn === undefined && network.asn === undefined)
                findings.push(
                    `${registered.devices.find((d) => d.device === device)!.at}: ${name}: routing.bgp has no asn, and circuit.ts writes none. Write asn in circuit.ts, or in routing.bgp.`
                );
            // Each `{ communities }` rule written out for the neighbors that use its policy, before our own checks read the policies.
            findings.push(
                ...writeCommunities(network, device, (map, kind, key) => `${map ? writtenAt(map, key, [kind, key]) : ""}${name}: `)
            );
        }
        for (const [check, value] of Object.entries<Json>(network.checks ?? {}))
            if (typeof value !== "function" && !BUILT_IN.includes(check)) {
                const hint = closest(check, BUILT_IN);
                findings.push(
                    `checks.${check}: Circuit has no check of this name${hint ? `. Did you mean ${hint}?` : ""} A check of your own takes a function.`
                );
            }
        const own = Object.entries<Json>(network.checks ?? {}).filter(([, check]) => typeof check === "function");
        const resolved = own.length ? resolvedForChecks(network, devices) : undefined;
        for (const [check, run] of own) {
            let found: Finding[];
            try {
                found = run(resolved);
            } catch (error) {
                findings.push(`checks.${check}: the check stopped: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
            for (const { message, device, path } of found) {
                const registeredAt = registered.devices.find((d) => d.device.name === device)?.at;
                const where = device && devices[device] && registeredAt ? foundAt(devices[device], path, registeredAt) : "";
                findings.push(`${where}${check}: ${device ? `${device}: ` : ""}${path ? `${path}: ` : ""}${message}`);
            }
        }
        if (networks.length > 1) for (let i = start; i < findings.length; i++) findings[i] = `${networkName}: ${findings[i]}`;
    }
    if (findings.length) stop(findings);

    return {
        warnings: warnings.map(short),
        networks: networks.map(({ name, registered, network, devices }) => ({
            name,
            ...(network.asn !== undefined ? { asn: network.asn } : {}),
            communities: network.communities ? catalogue(network) : [],
            devices: Object.fromEntries(Object.values(devices).map((d) => [d.name, primitive(d, network)])),
            files: Object.fromEntries(registered.devices.map(({ device, file }) => [device.name, short(file)])),
            settings: network,
        })),
    };
}

// ---------- into the model's primitives ----------

/**
 * One rule per combination of the lists in its `if`, in the order of `fields`: the first outermost. A `src` and a `dst` of different
 * families match no packet, so that combination is left out. When every combination is like that, they all stay, and the checks
 * report the rule.
 */
function combinations(rule: Json, fields: [string, unknown[]][], drop: string[]): Json[] {
    const rest = Object.fromEntries(Object.entries<Json>(rule.if).filter(([k]) => !drop.includes(k)));
    let matches: Json[] = [rest];
    for (const [key, values] of fields) if (values.length) matches = matches.flatMap((m) => values.map((v) => ({ ...m, [key]: v })));
    const sameFamily = matches.filter(
        (m) => typeof m.src !== "string" || typeof m.dst !== "string" || Address.family(m.src) === Address.family(m.dst)
    );
    return (sameFamily.length ? sameFamily : matches).map((match) => ({ ...rule, if: match }));
}

/** An ACL rule: the VLAN outermost, then `src`, then `dst`. */
const acl = (rule: Json): Json[] =>
    rule.if
        ? combinations(
              rule,
              [
                  ["vlan", many(rule.if.vlan)],
                  ["src", many(rule.if.src)],
                  ["dst", many(rule.if.dst)],
              ],
              ["vlan", "src", "dst"]
          )
        : [rule];

/** A filter or NAT rule: the interfaces outermost (an interface set is its interfaces), then `src`, then `dst`. */
const filter = (rule: Json, sets: Record<string, string[]>): Json[] => {
    const m = rule.if;
    if (!m) return [rule];
    const way = (w: string) => (m[`${w}_interface_set`] !== undefined ? sets[m[`${w}_interface_set`]]! : many(m[`${w}_interface`]));
    if ([m.in_interface_set, m.out_interface_set].some((s) => s !== undefined && !sets[s]!.length)) return [];
    const fields: [string, unknown[]][] = [
        ["in_interface", way("in")],
        ["out_interface", way("out")],
        ["src", many(m.src)],
        ["dst", many(m.dst)],
    ];
    return combinations(rule, fields, ["in_interface", "out_interface", "in_interface_set", "out_interface_set", "src", "dst"]);
};

/** An address written with its length, as the address alone: `192.0.2.1/32` is `192.0.2.1`. Anything else as it is. */
const alone = (v: unknown) => (typeof v === "string" ? v.replace(/\/\d+$/, "") : v);

/**
 * What the model keeps otherwise than a device writes it: an address set named in `management.allow` as its addresses; no VLAN
 * description where a VLAN is only its number (`NUMBERED_VLANS`), so a VLAN written whole once serves every platform; the address alone in each field that names one host (`HostAddress`), which a device may write with its length; and the network's AS on BGP,
 * which the model needs there. No default is written: what a device leaves out stays out.
 */
function written(d: Json, network: Json) {
    // `management.allow` written as an address set's name is that set's addresses.
    if (typeof d.management?.allow === "string") d.management.allow = d.firewall.address_sets[d.management.allow];
    if (NUMBERED_VLANS.includes(d.platform)) for (const vlan of Object.values<Json>(d.switching?.vlans ?? {})) delete vlan.description;

    if (d.system?.ntp?.servers) d.system.ntp.servers = d.system.ntp.servers.map(alone);
    for (const kind of ["gre", "vxlan", "eoip"])
        for (const tunnel of Object.values<Json>(d.interfaces?.[kind] ?? {})) tunnel.local_address = alone(tunnel.local_address);
    for (const wg of Object.values<Json>(d.interfaces?.wireguard ?? {})) if (wg.endpoint) wg.endpoint = alone(wg.endpoint);
    for (const route of [
        ...(d.routing?.static_routes ?? []),
        ...Object.values<Json>(d.system?.vdoms ?? {}).flatMap((v) => v.static_routes ?? []),
    ])
        if (route.next_hop) route.next_hop = alone(route.next_hop);
    for (const rules of Object.values<Json>(d.routing?.policies ?? {}))
        for (const rule of rules) if (rule.set?.preferred_source) rule.set.preferred_source = alone(rule.set.preferred_source);
    for (const way of ["source", "destination"])
        for (const rule of d.firewall?.nat?.[way] ?? []) if (rule.to_address) rule.to_address = alone(rule.to_address);

    const bgp = d.routing?.bgp;
    if (!bgp) return;
    for (const x of [...Object.values<Json>(bgp.neighbor_groups ?? {}), ...Object.values<Json>(bgp.neighbors ?? {})])
        if (x.local_address) x.local_address = alone(x.local_address);
    // The model needs an AS on BGP: the network's own, not a guess.
    if (bgp.asn === undefined) d.routing.bgp = { asn: network.asn, ...bgp };
}

/**
 * A device in the model the platforms read: a copy, with `written`'s changes, a list in a match as one rule per value, an interface set
 * as its interfaces, and a prefix set written as a map of named prefixes as its prefixes.
 */
function primitive(device: AnyDevice, network: Json): Device {
    const d = JSON.parse(JSON.stringify(device));
    written(d, network);
    for (const [name, rules] of Object.entries<Json>(d.switching?.acls ?? {})) d.switching.acls[name] = rules.flatMap(acl);
    for (const set of Object.values<Json>(d.routing?.prefix_sets ?? {}))
        if (set.prefixes && !Array.isArray(set.prefixes)) set.prefixes = Object.values(set.prefixes);

    if (d.firewall) {
        const sets = d.firewall.interface_sets ?? {};
        delete d.firewall.interface_sets;
        for (const chain of Object.values<Json>(d.firewall.filter ?? {}))
            if (chain.rules) chain.rules = chain.rules.flatMap((r: Json) => filter(r, sets));
        for (const way of ["source", "destination"])
            if (d.firewall.nat?.[way]) d.firewall.nat[way] = d.firewall.nat[way].flatMap((r: Json) => filter(r, sets));
        if (d.firewall.tcp_mss) d.firewall.tcp_mss = d.firewall.tcp_mss.flatMap((r: Json) => filter(r, sets));
        if (!Object.keys(d.firewall).length) delete d.firewall;
    }
    return d;
}
