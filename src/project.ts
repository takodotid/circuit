import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { catalog, schemeProblems, writeCommunities } from "./config/communities";
import { BGP_NEIGHBORS, registry } from "./config/define";
import type { Registered } from "./config/define";
import type { AnyDevice } from "./config/device";
import type { Community, Finding, ResolvedNetwork } from "./config/network";
import * as globals from "./config/index";
import { ACTIONS, CHECKS, DEVICE, NETWORK, POLICY_RULE, closest, plainSecrets, unknownKeyHelp, unknownKeys } from "./config/keys";
import { isOrdered, lineOf, source, userFrames, writtenAt } from "./config/merge";
import { isPort, NUMBERED_VLANS, spell } from "./config/models";
import { policyRuleProblem } from "./config/routing";
import { Address } from "./core/address";
import { Secrets } from "./core/secrets";
import { SecretsFile } from "./core/secrets-file";
import { Utils } from "./core/utils";
import type { Device } from "./model";

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

/** Each network, and what Circuit tells but doesn't stop on. What stops it is thrown as `ProjectError`. */
export type ProjectRead = { networks: ProjectNetwork[]; warnings: { device: string; message: string }[] };

/** A project that can't be read, with each reason. */
export class ProjectError extends Error {
    constructor(readonly lines: string[]) {
        super(lines.join("\n"));
    }
}

export class Project {
    /** A name in `checks` that holds a function is the project's own check. Any other name is one of these. */
    private static readonly BUILT_IN = Object.keys(CHECKS);

    private static root = "";
    private static findings: string[] = [];
    private static warnings: ProjectRead["warnings"] = [];

    /**
     * Imports `circuit.ts` and each device file, checks what the types can't, runs the project's own checks, and gives each network's devices in the model. It fills in only the network's AS on BGP. Throws `ProjectError` with every reason it can't.
     */
    static async read(folder: string): Promise<ProjectRead> {
        // Bun gives a file's real path in an error, so the root is a real path too. On macOS, /var is /private/var.
        Project.root = existsSync(folder) ? realpathSync(folder) : resolve(folder);
        Project.findings = [];
        Project.warnings = [];
        registry.networks.length = 0;
        registry.sources.length = 0;
        registry.rules.length = 0;
        Utils.root = Project.root;
        Secrets.useRoot(Project.root);
        // Circuit's functions and `presets` are globals (circuit.d.ts): the project's files use them with no import.
        Object.assign(globalThis, globals);
        // Where a key is written is found by reading the file that writes it.
        source.read = (file) => readFileSync(file, "utf8");

        if (!existsSync(resolve(Project.root, "circuit.ts")))
            Project.stop([`${Project.root} has no circuit.ts. Start a project with circuit new, or give the project's folder.`]);

        // The networks circuit.ts exports come first.
        const circuit = await Project.load(resolve(Project.root, "circuit.ts"));

        // Then each `.ts` under `sites/`, at any depth, except `site.ts`, which holds what a site's devices share. `lib/` and `tenants/` are imported only by the files that use them.
        const sites = resolve(Project.root, "sites");
        const files = existsSync(sites)
            ? (readdirSync(sites, { recursive: true }) as string[])
                  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && basename(f) !== "site.ts")
                  .map((f) => resolve(sites, f))
                  .sort()
            : [];
        for (const file of files) await Project.load(file);

        /** Each network, by its name in circuit.ts, or by its AS when it is the default export. */
        const networks: { name: string; registered: Registered; network: Json; devices: Record<string, AnyDevice> }[] = [];
        for (const registered of registry.networks) {
            const name = Object.keys(circuit).find((k) => circuit[k] === registered.network);
            const network = registered.network as Json;
            if (name === undefined)
                Project.findings.push(
                    `${registered.at}: this network is not exported from circuit.ts. Export each network under its own name, after its AS: export const as64500 = circuit({ ... }).`
                );
            else networks.push({ name: name === "default" ? `as${network.asn}` : name, registered, network, devices: {} });
        }
        for (const { registered, network } of networks) {
            const file = (network.secrets as Json)?.file;
            if (
                network.secrets !== undefined &&
                (typeof file !== "string" || !file.trim() || isAbsolute(file) || file.split(/[\\/]/).includes(".."))
            )
                Project.findings.push(
                    `${registered.at}: secrets.file must be a path inside the project, such as ".circuit/lab-secrets". Leave secrets out to use .circuit/secrets.`
                );
        }
        if (!registry.networks.length)
            Project.stop([
                "circuit.ts makes no network. Write it as export const as64500 = circuit({ asn, sites, checks, integrations }), named after its AS.",
            ]);

        // Each device file registers one device.
        const registeredBy = new Map<string, string[]>();
        for (const { devices } of registry.networks)
            for (const { device, file } of devices) registeredBy.set(file, [...(registeredBy.get(file) ?? []), device.name]);
        for (const file of files) {
            const names = registeredBy.get(file) ?? [];
            if (!names.length)
                Project.findings.push(
                    `${file}: registers no device. Each .ts file under sites/, except site.ts, is one device: export default as64500.device({ ... }), with your network's name. What a site's devices share goes in its site.ts.`
                );
            else if (names.length > 1)
                Project.findings.push(`${file}: registers ${names.length} devices, ${names.join(", ")}. Write one file per device.`);
        }

        for (const n of networks)
            for (const { device, at } of n.registered.devices) {
                const first = n.registered.devices.find((d) => d.device.name === device.name)!;
                if (first.device !== device)
                    Project.findings.push(
                        `${at}: ${device.name} is registered twice with network ${n.name}, here and in ${first.at}. A hostname is one device.`
                    );
                else n.devices[device.name] = device;
            }
        const everyDevice = networks.flatMap((n) => Object.values(n.devices));

        // Each address set written `bgpNeighbors()` gets every BGP neighbor address of its device.
        for (const d of everyDevice as Json[]) {
            const sets = d.firewall?.address_sets ?? {};
            for (const [name, set] of Object.entries<Json>(sets))
                if (Object.hasOwn(set, BGP_NEIGHBORS))
                    sets[name] = Object.values<Json>(d.routing?.bgp?.neighbors ?? {}).map((n) => n.address);
        }

        // Each hostname a source gives a part to is a device of the network: a misspelt one would give its part to no one.
        const reported = new Set<string>();
        for (const { source, device, file, network } of registry.sources) {
            const devices = networks.find((n) => n.registered.network === network)?.devices ?? {};
            for (const host of Project.keys(source)) {
                const written = writtenAt(source, host);
                const where = written ? `${written}the source made here` : `${file}: a source given to ${device}`;
                if (devices[host] || reported.has(`${where} ${host}`)) continue;
                reported.add(`${where} ${host}`);
                Project.findings.push(
                    `${where} has a part for ${host}, which is not a device of the network. The devices: ${Project.keys(devices).join(", ")}.`
                );
            }
        }

        // Every rule a rule-list `part` made is in some device's ordered list: the file that writes the list has to place it, and may forget.
        const placed = new Set<object>(everyDevice.flatMap((d) => [...Project.orderedLists(d)].flat()));
        for (const { rules, file } of registry.rules) {
            const lost = rules.filter((rule) => !placed.has(rule)) as Json[];
            if (lost.length)
                Project.findings.push(
                    `${file}: ${lost.length} of the rules made here with part ${lost.length === 1 ? "is" : "are"} in no device: ${lost.map((r) => JSON.stringify(r.description ?? r.if ?? r.match ?? r)).join(", ")}. Place them in the ordered list where they go, with merge.`
                );
        }

        // Each network on its own. With several, each finding starts with the network's name.
        for (const { name: networkName, registered, network, devices } of networks) {
            const start = Project.findings.length;
            Project.checkPlaces(network, devices, (name) => `${registered.devices.find((d) => d.device.name === name)!.at}: `);
            const schemeKnown = !Project.checkSettings(network, registered.at);
            Project.checkUntrusted(network, devices);
            Project.checkVlanIds(network, devices);
            if (schemeKnown) for (const finding of schemeProblems(network)) Project.findings.push(`${registered.at}: ${finding}`);
            for (const [name, device] of Object.entries(devices)) {
                Project.checkKeys(
                    name,
                    device,
                    registered.devices.find((d) => d.device === device)!.at,
                    Project.secretsFile({ settings: network })
                );
                Project.checkNames(name, device);
                Project.checkLinks(name, device, devices);
                if (device.routing?.bgp && device.routing.bgp.asn === undefined && network.asn === undefined)
                    Project.findings.push(
                        `${registered.devices.find((d) => d.device === device)!.at}: ${name}: routing.bgp has no asn, and circuit.ts writes none. Write asn in circuit.ts, or in routing.bgp.`
                    );
                // Each `{ communities }` rule is written out for the neighbors that use its policy, before the project's own checks read the policies.
                Project.findings.push(
                    ...writeCommunities(network, device, (map, kind, key) => `${map ? writtenAt(map, key, [kind, key]) : ""}${name}: `)
                );
            }
            for (const [check, value] of Object.entries<Json>(network.checks ?? {}))
                if (typeof value !== "function" && !Project.BUILT_IN.includes(check)) {
                    const hint = closest(check, Project.BUILT_IN);
                    Project.findings.push(
                        `checks.${check}: Circuit has no check of this name.${hint ? ` Did you mean ${hint}?` : ""} A check of your own is a function.`
                    );
                }
            const own = Object.entries<Json>(network.checks ?? {}).filter(([, check]) => typeof check === "function");
            const resolved = own.length ? Project.resolved(network, devices) : undefined;
            for (const [check, run] of own) {
                let found: Finding[];
                try {
                    found = run(resolved);
                } catch (error) {
                    Project.findings.push(`checks.${check}: the check stopped: ${error instanceof Error ? error.message : String(error)}`);
                    continue;
                }
                for (const { message, device, path } of found) {
                    const registeredAt = registered.devices.find((d) => d.device.name === device)?.at;
                    const where = device && devices[device] && registeredAt ? Project.foundAt(devices[device], path, registeredAt) : "";
                    Project.findings.push(`${where}${check}: ${device ? `${device}: ` : ""}${path ? `${path}: ` : ""}${message}`);
                }
            }
            if (networks.length > 1)
                for (let i = start; i < Project.findings.length; i++) Project.findings[i] = `${networkName}: ${Project.findings[i]}`;
        }
        if (Project.findings.length) Project.stop(Project.findings);

        return {
            warnings: Project.warnings.map((warning) => ({ ...warning, message: Project.relative(warning.message) })),
            networks: networks.map(({ name, registered, network, devices }) => ({
                name,
                ...(network.asn !== undefined ? { asn: network.asn } : {}),
                communities: network.communities ? catalog(network) : [],
                devices: Object.fromEntries(Object.values(devices).map((d) => [d.name, Project.primitive(d, network)])),
                files: Object.fromEntries(registered.devices.map(({ device, file }) => [device.name, Project.relative(file)])),
                settings: network,
            })),
        };
    }

    /** A network's secrets file, from the project's folder: the one `secrets.file` gives, or `.circuit/secrets`. */
    static secretsFile(network: Pick<ProjectNetwork, "settings">): string {
        return ((network.settings.secrets as Json)?.file as string | undefined) ?? SecretsFile.DEFAULT;
    }

    /** Paths from the project's folder, with forward slashes. */
    private static relative(text: string): string {
        return text.replaceAll(Project.root + sep, "").replaceAll("\\", "/");
    }

    private static stop(lines: string[]): never {
        throw new ProjectError(lines.map(Project.relative));
    }

    private static list(v: unknown): unknown[] {
        return v === undefined ? [] : Array.isArray(v) ? v : [v];
    }

    private static keys(map: unknown): string[] {
        return Object.keys((map as object | undefined) ?? {});
    }

    private static escape(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /** Imports one file of the project. An error is given at the user's line it stopped on, unless its message starts with one. */
    private static async load(file: string): Promise<Record<string, unknown>> {
        registry.reading = file;
        try {
            return await import(pathToFileURL(file).href);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const at = error instanceof Error && !/^\S+\.ts:\d+: /.test(message) ? (userFrames(error)[0] ?? file) : undefined;
            return Project.stop([at ? `${at}: ${message}` : message]);
        }
    }

    /**
     * Where a finding is, as `file:line: `: the line that writes the deepest key of `path` the device has, such as a port a tenant's file gives. Without one, the line that made the device.
     */
    private static foundAt(device: AnyDevice, path: string | undefined, registeredAt: string): string {
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

    private static *orderedLists(value: unknown, path = ""): Generator<readonly object[]> {
        if (Array.isArray(value)) {
            if (isOrdered(path)) yield value;
        } else if (value && typeof value === "object")
            for (const [k, v] of Object.entries(value)) yield* Project.orderedLists(v, path ? `${path}.${k}` : k);
    }

    /** The device and where its VLAN's ID is written, such as `switch (sites/home/switch.ts:39)`. */
    private static declaredAt(d: Json, vlan: Json, name: string): string {
        return `${d.name} (${writtenAt(vlan, "id", ["vlans", name]).replace(/: $/, "") || "?"})`;
    }

    private static checkPlaces(network: Json, devices: Record<string, AnyDevice>, at: (name: string) => string): void {
        const sites = Project.keys(network.sites);
        for (const [name, d] of Object.entries(devices))
            if (!sites.includes(d.site)) {
                const hint = closest(d.site, sites);
                Project.findings.push(
                    `${at(name)}${name}: site ${d.site} is not a site of the network${hint ? `. Did you mean ${hint}?` : `. The sites: ${sites.join(", ")}.`}`
                );
            }
        for (const site of sites)
            if (!Object.values(devices).some((d) => d.site === site))
                Project.findings.push(`sites.${site}: no device is at this site. Remove it, or add a device.`);
        // NetBox places each device by its role, and Circuit never makes one up.
        if (network.integrations?.netbox)
            for (const [name, d] of Object.entries(devices))
                if (!d.role)
                    Project.findings.push(
                        `${at(name)}${name}: NetBox needs a role (integrations.netbox). Write role, such as role: "Edge router".`
                    );
        const trust = network.checks?.untrusted_vlans;
        for (const [field, named] of [
            ["filtering_devices", trust?.filtering_devices],
            ["mixed_links", trust?.mixed_links?.flat()],
        ] as const)
            for (const name of Project.list(named) as string[])
                if (!devices[name])
                    Project.findings.push(
                        `checks.untrusted_vlans.${field}: no device ${name}. The devices: ${Project.keys(devices).join(", ")}.`
                    );
    }

    private static checkUntrusted(network: Json, devices: Record<string, AnyDevice>): void {
        const flags = new Map<string, { on: string[]; off: string[] }>();
        // Without the check: each place that writes the flag, once, with the devices that take the VLAN from there.
        const unread = new Map<string, string[]>();
        for (const d of Object.values(devices)) {
            for (const [name, vlan] of Object.entries<Json>(d.switching?.vlans ?? {})) {
                const flag = flags.get(name) ?? { on: [], off: [] };
                if (vlan.untrusted) flag.on.push(d.name);
                else flag.off.push(Project.declaredAt(d, vlan, name));
                flags.set(name, flag);
                if (!vlan.untrusted || network.checks?.untrusted_vlans) continue;
                const where = `${writtenAt(vlan, "untrusted", ["vlans", name])}VLAN ${name}`;
                unread.set(where, [...(unread.get(where) ?? []), d.name]);
            }
        }
        for (const [where, names] of [...unread].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })))
            Project.findings.push(
                `${where} has untrusted: true (${names.join(", ")}), but circuit.ts doesn't turn on the check untrusted_vlans, the only thing that reads it. Turn it on, or remove untrusted.`
            );
        for (const [name, { on, off }] of flags)
            if (on.length && off.length)
                Project.findings.push(
                    `VLAN ${name} is untrusted on ${on.join(", ")} but not on ${off.join(", ")}: write untrusted: true on every device that declares it.`
                );
    }

    private static checkVlanIds(network: Json, devices: Record<string, AnyDevice>): void {
        if (!network.checks?.same_vlan_ids) return;
        const ids = new Map<string, Map<number, string[]>>();
        for (const d of Object.values(devices))
            for (const [name, vlan] of Object.entries<Json>(d.switching?.vlans ?? {})) {
                const byId = ids.get(name) ?? new Map<number, string[]>();
                byId.set(vlan.id, [...(byId.get(vlan.id) ?? []), Project.declaredAt(d, vlan, name)]);
                ids.set(name, byId);
            }
        for (const [name, byId] of ids)
            if (byId.size > 1)
                Project.findings.push(
                    `VLAN ${name} has ${byId.size} IDs: ${[...byId].map(([id, on]) => `${id} on ${on.join(", ")}`).join("; ")}. One VLAN name has one ID in the network (check same_vlan_ids).`
                );
    }

    /** The steps of a path that are keys, not list positions: `firewall.nat.source[0].if` is firewall, nat, source, if. */
    private static steps(path: string): string[] {
        return path.match(/[^.[\]]+/g)?.filter((s) => !/^\d+$/.test(s)) ?? [];
    }

    /** What to say about a secret written as plain text. It never repeats the text. */
    private static plainSecret(path: string, secretsFile: string): string {
        return `${path}: a secret can't be written as plain text. Write secret("NAME") instead, and set its value with ${SecretsFile.command(secretsFile, "set NAME")}.`;
    }

    /** A route policy rule's `then` is checked by `checkNames`, as the rule's kind decides what it may hold. */
    private static checkKeys(name: string, device: AnyDevice, registeredAt: string, secretsFile: string): void {
        for (const u of unknownKeys(device, DEVICE)) {
            const path = u.path ? `${u.path}.${u.key}` : u.key;
            Project.findings.push(`${Project.foundAt(device, path, registeredAt)}${name}: ${path}: no such field. ${unknownKeyHelp(u)}`);
        }
        for (const path of plainSecrets(device, DEVICE))
            Project.findings.push(`${Project.foundAt(device, path, registeredAt)}${name}: ${Project.plainSecret(path, secretsFile)}`);
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
            Project.list(rules).forEach((rule: Json, i) => {
                const takes: readonly string[] = ACTIONS[kind];
                if (!rule || typeof rule !== "object" || takes.includes(rule.then)) return;
                const path = `${at}[${i}].then`;
                const hint = typeof rule.then === "string" ? closest(rule.then, takes) : undefined;
                const what =
                    rule.then === undefined ? `a ${kind} rule needs then` : `then can't be ${JSON.stringify(rule.then)} in a ${kind} rule`;
                Project.findings.push(
                    `${Project.foundAt(device, rule.then === undefined ? `${at}[${i}]` : path, registeredAt)}${name}: ${path}: ${what}. ${hint ? `Did you mean ${hint}?` : `It takes: ${takes.join(", ")}.`}`
                );
            });
    }

    /** Returns whether `communities` has a key it doesn't take, so the scheme is not read further. */
    private static checkSettings(network: Json, at: string): boolean {
        const { device: _, checks, ...settings } = network;
        const found = [
            ...unknownKeys(settings, NETWORK),
            ...Object.entries<Json>(checks ?? {}).flatMap(([check, value]) =>
                Object.hasOwn(CHECKS, check) ? unknownKeys(value, CHECKS[check as keyof typeof CHECKS], `checks.${check}`) : []
            ),
        ];
        for (const u of found) {
            const path = u.path ? `${u.path}.${u.key}` : u.key;
            Project.findings.push(`${lineOf(at, Project.steps(path))}${path}: no such field. ${unknownKeyHelp(u)}`);
        }
        for (const path of plainSecrets(settings, NETWORK))
            Project.findings.push(
                `${lineOf(at, Project.steps(path))}${Project.plainSecret(path, Project.secretsFile({ settings: network }))}`
            );
        return found.some((u) => u.path.startsWith("communities"));
    }

    /** Every name a device refers to is one it declares. The editor checks the same, and this catches what reaches the device as a plain `string`. */
    private static checkNames(name: string, d: Json): void {
        const kinds = [
            "ethernet",
            "lag",
            "vlan_interface",
            "bridge",
            "loopback",
            "gre",
            "vxlan",
            "ipsec",
            "wireguard",
            "eoip",
            "pseudowire",
            "pppoe_client",
        ];

        // An interface's name is one interface: a rule or a route that uses it would otherwise not say which.
        const groupsOf = new Map<string, string[]>();
        for (const kind of kinds) for (const i of Project.keys(d.interfaces?.[kind])) groupsOf.set(i, [...(groupsOf.get(i) ?? []), kind]);
        for (const [i, groups] of groupsOf)
            if (groups.length > 1)
                Project.findings.push(
                    `${name}: interface ${i} is in ${groups.map((g) => `interfaces.${g}`).join(" and ")}. Give each interface its own name.`
                );

        const has: Record<string, Set<string>> = {
            VLAN: new Set(Project.keys(d.switching?.vlans)),
            interface: new Set(kinds.flatMap((k) => Project.keys(d.interfaces?.[k]))),
            LAG: new Set(Project.keys(d.interfaces?.lag)),
            "port, LAG, or VLAN interface": new Set(["ethernet", "lag", "vlan_interface"].flatMap((k) => Project.keys(d.interfaces?.[k]))),
            "VLAN interface": new Set(Project.keys(d.interfaces?.vlan_interface)),
            ACL: new Set(Project.keys(d.switching?.acls)),
            policy: new Set(Project.keys(d.routing?.policies)),
            "prefix set": new Set(Project.keys(d.routing?.prefix_sets)),
            "neighbor group": new Set(Project.keys(d.routing?.bgp?.neighbor_groups)),
            table: new Set(["main", ...Project.keys(d.routing?.tables)]),
            VRF: new Set(Project.keys(d.routing?.vrfs)),
            "VRF or main": new Set(["main", ...Project.keys(d.routing?.vrfs)]),
            "address set": new Set(Project.keys(d.firewall?.address_sets)),
            "interface set": new Set(Project.keys(d.firewall?.interface_sets)),
            user: new Set(Project.keys(d.system?.users)),
            certificate: new Set(Project.keys(d.system?.certificates)),
            "SNMP user": new Set(Project.keys(d.monitoring?.snmp?.users)),
            class: new Set(Project.keys(d.qos?.classes)),
            scheduler: new Set(Project.keys(d.qos?.schedulers)),
        };
        const need = (kind: string, value: unknown, where: string, written = "") => {
            for (const v of Project.list(value)) {
                if (typeof v !== "string" || has[kind]!.has(v)) continue;
                const hint = closest(v, has[kind]!);
                Project.findings.push(`${written}${name}: ${where}: no ${kind} ${v}${hint ? `. Did you mean ${hint}?` : ""}`);
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
        (d.monitoring?.snmp?.traps ?? []).forEach((t: Json, n: number) => need("SNMP user", t.user, `monitoring.snmp.traps[${n}].user`));
        (d.monitoring?.syslog ?? []).forEach((s: Json, n: number) => {
            need("certificate", s.transport_security?.ca_certificate, `monitoring.syslog[${n}].transport_security.ca_certificate`);
            need("VRF", s.vrf, `monitoring.syslog[${n}].vrf`);
        });
        need("VRF", d.monitoring?.snmp?.vrf, "monitoring.snmp.vrf");
        for (const [p, probe] of Object.entries<Json>(d.monitoring?.probes ?? {})) need("VRF", probe?.vrf, `monitoring.probes.${p}.vrf`);
        for (const [s, service] of Object.entries<Json>(d.management ?? {})) need("VRF", service?.vrf, `management.${s}.vrf`);
        for (const group of ["dns", "ntp"]) need("VRF", d.system?.[group]?.vrf, `system.${group}.vrf`);
        (d.system?.aaa?.radius ?? []).forEach((s: Json, n: number) => need("VRF", s.vrf, `system.aaa.radius[${n}].vrf`));
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
                need("certificate", x.certificate, `${at}.certificate`, written);
                need("certificate", x.ca_certificate, `${at}.ca_certificate`, written);
                need("scheduler", x.scheduler, `${at}.scheduler`, written);
                (x.dhcp_client?.default_routes ?? []).forEach((r: Json, n: number) =>
                    need("table", r.routing_table, `${at}.dhcp_client.default_routes[${n}].routing_table`, written)
                );
                if (kind !== "pppoe_client") continue;
                need("port, LAG, or VLAN interface", x.interface, `${at}.interface`, written);
                need("interface", Project.keys(x.prefix_delegation?.interfaces), `${at}.prefix_delegation.interfaces`, written);
            }
        if (typeof d.switching?.lldp === "object") need("interface", d.switching.lldp.interfaces, "switching.lldp.interfaces");
        for (const [a, rules] of Object.entries<Json>(d.switching?.acls ?? {}))
            rules.forEach((r: Json, i: number) =>
                need("VLAN", r.if?.vlan, `switching.acls.${a}[${i}].if.vlan`, writtenAt(d.switching.acls, a, ["acls", a]))
            );

        for (const group of ["dhcp_server", "dhcpv6_server", "dhcp_relay"])
            for (const [s, x] of Object.entries<Json>(d.services?.[group] ?? {})) {
                const written = writtenAt(d.services[group], s, [group, s]);
                need("interface", x.interface, `services.${group}.${s}.interface`, written);
                (x.radius ?? []).forEach((r: Json, n: number) => need("VRF", r.vrf, `services.${group}.${s}.radius[${n}].vrf`, written));
            }
        for (const [s, x] of Object.entries<Json>(d.services?.pppoe_server ?? {})) {
            const written = writtenAt(d.services.pppoe_server, s, ["pppoe_server", s]);
            need("interface", x.interfaces, `services.pppoe_server.${s}.interfaces`, written);
            (x.radius ?? []).forEach((r: Json, n: number) => need("VRF", r.vrf, `services.pppoe_server.${s}.radius[${n}].vrf`, written));
            need("interface set", x.interface_set, `services.pppoe_server.${s}.interface_set`, written);
        }
        need("interface", d.services?.upnp?.internal, "services.upnp.internal");
        need("interface", d.services?.upnp?.external, "services.upnp.external");

        need("class", d.qos?.default_class, "qos.default_class");
        for (const [s, scheduler] of Object.entries<Json>(d.qos?.schedulers ?? {}))
            (scheduler?.queues ?? []).forEach((q: Json, i: number) => need("class", q?.class, `qos.schedulers.${s}.queues[${i}].class`));

        (d.routing?.static_routes ?? []).forEach((r: Json, i: number) => {
            need("interface", r.interface, `routing.static_routes[${i}].interface`);
            need("table", r.routing_table, `routing.static_routes[${i}].routing_table`);
            need("VRF", r.vrf, `routing.static_routes[${i}].vrf`);
        });
        for (const [v, vrf] of Object.entries<Json>(d.routing?.vrfs ?? {}))
            for (const way of ["import_policy", "export_policy"]) need("policy", vrf?.[way], `routing.vrfs.${v}.${way}`);
        (d.routing?.vrf_imports ?? []).forEach((r: Json, i: number) => {
            need("VRF or main", r.from, `routing.vrf_imports[${i}].from`);
            need("VRF or main", r.to, `routing.vrf_imports[${i}].to`);
            need("policy", r.policy, `routing.vrf_imports[${i}].policy`);
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
                need("VRF", x.vrf, `routing.bgp.${kind}.${n}.vrf`, written);
            }
        for (const [p, rules] of Object.entries<Json>(d.routing?.policies ?? {}))
            rules.forEach((rule: Json, i: number) => {
                const written = writtenAt(d.routing.policies, p, ["policies", p]);
                // A key no policy rule has is said once, by `checkKeys`.
                const problem = unknownKeys(rule, POLICY_RULE).length ? undefined : policyRuleProblem(rule);
                if (problem) return Project.findings.push(`${written}${name}: routing.policies.${p}[${i}]: ${problem}`);
                need("policy", rule.call, `routing.policies.${p}[${i}].call`, written);
                need("prefix set", rule.if?.prefix_set, `routing.policies.${p}[${i}].if.prefix_set`, written);
            });
        need("VRF", d.routing?.ospf?.vrf, "routing.ospf.vrf");
        for (const [a, area] of Object.entries<Json>(d.routing?.ospf?.areas ?? {}))
            need("interface", Project.keys(area.interfaces), `routing.ospf.areas.${a}.interfaces`);
        need("interface", Project.keys(d.routing?.isis?.interfaces), "routing.isis.interfaces");
        need("policy", d.routing?.isis?.level2_to_level1?.import_policy, "routing.isis.level2_to_level1.import_policy");
        need("interface", d.routing?.mpls?.ldp?.interfaces, "routing.mpls.ldp.interfaces");
        for (const way of ["import_policy", "export_policy"]) {
            need("policy", d.routing?.mpls?.ldp?.[way], `routing.mpls.ldp.${way}`);
            for (const [lsrId, neighbor] of Object.entries<Json>(d.routing?.mpls?.ldp?.neighbors ?? {}))
                need("policy", neighbor?.[way], `routing.mpls.ldp.neighbors.${lsrId}.${way}`);
        }

        for (const [s, members] of Object.entries<Json>(d.firewall?.interface_sets ?? {}))
            need("interface", members, `firewall.interface_sets.${s}`, writtenAt(d.firewall.interface_sets, s, ["interface_sets", s]));
        const lists = [
            ...Object.entries<Json>(d.firewall?.filter ?? {}).map(([chain, c]) => [`firewall.filter.${chain}.rules`, c.rules] as const),
            ["firewall.nat.source", d.firewall?.nat?.source] as const,
            ["firewall.nat.destination", d.firewall?.nat?.destination] as const,
            ["firewall.tcp_mss", d.firewall?.tcp_mss] as const,
            ["qos.marking", d.qos?.marking] as const,
        ];
        for (const [at, rules] of lists)
            (rules ?? []).forEach((r: Json, i: number) => {
                const m = r.if ?? {};
                for (const way of ["in", "out"]) {
                    need("interface", m[`${way}_interface`], `${at}[${i}].if.${way}_interface`);
                    need("interface set", m[`${way}_interface_set`], `${at}[${i}].if.${way}_interface_set`);
                    if (m[`${way}_interface`] !== undefined && m[`${way}_interface_set`] !== undefined)
                        Project.findings.push(`${name}: ${at}[${i}].if: ${way}_interface and ${way}_interface_set together. Use one.`);
                }
                need("address set", m.src_address_set, `${at}[${i}].if.src_address_set`);
                need("address set", m.dst_address_set, `${at}[${i}].if.dst_address_set`);
            });
    }

    /** A linked port's description names the far end, `<far device> <far port as printed there>`. Circuit warns when it doesn't, and writes nothing. */
    private static checkLinks(name: string, device: AnyDevice, devices: Record<string, AnyDevice>): void {
        for (const [port, settings] of Object.entries(device.interfaces?.ethernet ?? {})) {
            const at = `${writtenAt(device.interfaces?.ethernet, port, ["ethernet", port])}${name}: interfaces.ethernet.${port}`;
            if (!isPort(device.platform, device.model, port)) Project.findings.push(`${at}: ${device.model} has no port ${port}`);
            const link = settings.link;
            if (!link) continue;
            const far = devices[link.device]?.interfaces?.ethernet?.[link.port];
            if (!devices[link.device]) Project.findings.push(`${at}.link: no device ${link.device}`);
            else if (!far) Project.findings.push(`${at}.link: ${link.device} has no port ${link.port}`);
            else if (far.link?.device !== name || far.link.port !== port)
                Project.findings.push(`${at}.link: ${link.device} ${link.port} does not link back to ${name} ${port}`);
            else if (far.link.through !== link.through) Project.findings.push(`${at}.link: the two ends give different \`through\` values`);
            else {
                const farPort = spell(devices[link.device]!.platform, devices[link.device]!.model, link.port);
                // A name counts as a word of its own: `port6` is not named by `port60`.
                const names = (text: string) => new RegExp(`(^|\\s)${Project.escape(text)}($|[\\s,.;:)])`).test(settings.description ?? "");
                if (!names(link.device) || !names(farPort))
                    Project.warnings.push({
                        device: name,
                        message: `${at}.description: ${settings.description === undefined ? "none" : JSON.stringify(settings.description)}. Write the far end in it: ${link.device} ${farPort}.`,
                    });
            }
        }
    }

    /**
     * The network as the project's own checks read it, still in the language's shape (`ResolvedDevice`). In a copy of each device, a neighbor takes its group's settings, and a `call` becomes the called policy's rules. An address set's name in `management.allow` becomes its addresses, and a rule's interface set its interfaces.
     */
    private static resolved(network: Json, devices: Record<string, AnyDevice>): ResolvedNetwork {
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
            const joined = Project.sessionSets(d);
            const rules = [
                ...Object.values<Json>(d.firewall?.filter ?? {}).flatMap((c) => c.rules ?? []),
                ...(d.firewall?.nat?.source ?? []),
                ...(d.firewall?.nat?.destination ?? []),
                ...(d.firewall?.tcp_mss ?? []),
                ...(d.qos?.marking ?? []),
            ];
            for (const rule of rules)
                for (const way of ["in", "out"]) {
                    const set = rule.if?.[`${way}_interface_set`];
                    if (set === undefined || joined.has(set)) continue;
                    rule.if[`${way}_interface`] = sets[set] ?? [];
                    delete rule.if[`${way}_interface_set`];
                }
            Project.keepSessionSets(d, joined);
            return d;
        });
        return { asn: network.asn, prefixes: network.prefixes ?? {}, devices: resolved };
    }

    /**
     * One rule per combination of the lists in its `if`, in the order of `fields`: the first outermost. A `src` and a `dst` of different families match no packet, so that combination is left out. When every combination is like that, they all stay, and the checks report the rule.
     */
    private static combinations(rule: Json, fields: [string, unknown[]][], drop: string[]): Json[] {
        const rest = Object.fromEntries(Object.entries<Json>(rule.if).filter(([k]) => !drop.includes(k)));
        let matches: Json[] = [rest];
        for (const [key, values] of fields) if (values.length) matches = matches.flatMap((m) => values.map((v) => ({ ...m, [key]: v })));
        const sameFamily = matches.filter(
            (m) => typeof m.src !== "string" || typeof m.dst !== "string" || Address.family(m.src) === Address.family(m.dst)
        );
        return (sameFamily.length ? sameFamily : matches).map((match) => ({ ...rule, if: match }));
    }

    /** An ACL rule: the VLAN outermost, then `src`, then `dst`. */
    private static acl(rule: Json): Json[] {
        return rule.if
            ? Project.combinations(
                  rule,
                  [
                      ["vlan", Project.list(rule.if.vlan)],
                      ["src", Project.list(rule.if.src)],
                      ["dst", Project.list(rule.if.dst)],
                  ],
                  ["vlan", "src", "dst"]
              )
            : [rule];
    }

    /** A filter or NAT rule: the interfaces outermost (an interface set in `sets` is its interfaces), then `src`, then `dst`. A set not in `sets` stays a set. */
    private static filter(rule: Json, sets: Record<string, string[]>): Json[] {
        const m = rule.if;
        if (!m) return [rule];
        const written = ["in", "out"].filter((w) => sets[m[`${w}_interface_set`]] !== undefined);
        const way = (w: string) => (written.includes(w) ? sets[m[`${w}_interface_set`]]! : Project.list(m[`${w}_interface`]));
        if (written.some((w) => !sets[m[`${w}_interface_set`]]!.length)) return [];
        const fields: [string, unknown[]][] = [
            ["in_interface", way("in")],
            ["out_interface", way("out")],
            ["src", Project.list(m.src)],
            ["dst", Project.list(m.dst)],
        ];
        const drop = ["in_interface", "out_interface", ...written.map((w) => `${w}_interface_set`), "src", "dst"];
        return Project.combinations(rule, fields, drop);
    }

    /** The interface sets a PPPoE server's sessions join. Each stays a set: the device names a session's interface only when it comes up. */
    private static sessionSets(d: Json): Set<string> {
        const servers = Object.values<Json>(d.services?.pppoe_server ?? {});
        return new Set(servers.map((server) => server?.interface_set).filter((set) => typeof set === "string"));
    }

    /** Keeps in `firewall.interface_sets` only the sets that sessions join. */
    private static keepSessionSets(d: Json, joined: Set<string>): void {
        if (!d.firewall) return;
        const kept = Object.entries<Json>(d.firewall.interface_sets ?? {}).filter(([set]) => joined.has(set));
        if (kept.length) d.firewall.interface_sets = Object.fromEntries(kept);
        else delete d.firewall.interface_sets;
    }

    /** A marking rule: as a filter rule, then one rule for each DSCP it matches. */
    private static marking(rule: Json, sets: Record<string, string[]>): Json[] {
        return Project.filter(rule, sets).flatMap((r) =>
            Array.isArray(r.if?.dscp) && r.if.dscp.length ? r.if.dscp.map((dscp: string) => ({ ...r, if: { ...r.if, dscp } })) : [r]
        );
    }

    /** `192.0.2.1/32` as `192.0.2.1`. Anything else as it is. */
    private static alone(v: unknown): unknown {
        return typeof v === "string" ? v.replace(/\/\d+$/, "") : v;
    }

    /**
     * Where the model differs from what a device writes. On a platform that numbers its VLANs (`NUMBERED_VLANS`), a VLAN has no description, so a VLAN written whole once serves every platform. A field that takes one host (`HostAddress`) holds the address without its length. No default is written.
     */
    private static rewrite(d: Json, network: Json): void {
        // `management.allow` written as an address set's name is that set's addresses.
        if (typeof d.management?.allow === "string") d.management.allow = d.firewall.address_sets[d.management.allow];
        if (NUMBERED_VLANS.includes(d.platform)) for (const vlan of Object.values<Json>(d.switching?.vlans ?? {})) delete vlan.description;

        if (d.system?.ntp?.servers) d.system.ntp.servers = d.system.ntp.servers.map(Project.alone);
        for (const kind of ["gre", "vxlan", "ipsec", "eoip"])
            for (const tunnel of Object.values<Json>(d.interfaces?.[kind] ?? {}))
                tunnel.local_address = Project.alone(tunnel.local_address);
        for (const wg of Object.values<Json>(d.interfaces?.wireguard ?? {})) if (wg.endpoint) wg.endpoint = Project.alone(wg.endpoint);
        for (const route of [
            ...(d.routing?.static_routes ?? []),
            ...Object.values<Json>(d.system?.vdoms ?? {}).flatMap((v) => v.static_routes ?? []),
        ])
            if (route.next_hop) route.next_hop = Project.alone(route.next_hop);
        for (const rules of Object.values<Json>(d.routing?.policies ?? {}))
            for (const rule of rules) if (rule.set?.preferred_source) rule.set.preferred_source = Project.alone(rule.set.preferred_source);
        for (const way of ["source", "destination"])
            for (const rule of d.firewall?.nat?.[way] ?? []) if (rule.to_address) rule.to_address = Project.alone(rule.to_address);

        const bgp = d.routing?.bgp;
        if (!bgp) return;
        for (const x of [...Object.values<Json>(bgp.neighbor_groups ?? {}), ...Object.values<Json>(bgp.neighbors ?? {})])
            if (x.local_address) x.local_address = Project.alone(x.local_address);
        // The model needs an AS on BGP: the network's own, not a guess.
        if (bgp.asn === undefined) d.routing.bgp = { asn: network.asn, ...bgp };
    }

    /** A copy of the device in the model, with `rewrite`'s changes. A list in a match becomes one rule per value, an interface set its interfaces unless sessions join it, and a map of named prefixes a list. */
    private static primitive(device: AnyDevice, network: Json): Device {
        const d = JSON.parse(JSON.stringify(device));
        Project.rewrite(d, network);
        for (const [name, rules] of Object.entries<Json>(d.switching?.acls ?? {})) d.switching.acls[name] = rules.flatMap(Project.acl);
        for (const set of Object.values<Json>(d.routing?.prefix_sets ?? {}))
            if (set.prefixes && !Array.isArray(set.prefixes)) set.prefixes = Object.values(set.prefixes);

        const joined = Project.sessionSets(d);
        const sets = Object.fromEntries(Object.entries<Json>(d.firewall?.interface_sets ?? {}).filter(([set]) => !joined.has(set)));
        if (d.qos?.marking) d.qos.marking = d.qos.marking.flatMap((r: Json) => Project.marking(r, sets));
        if (d.firewall) {
            Project.keepSessionSets(d, joined);
            for (const chain of Object.values<Json>(d.firewall.filter ?? {}))
                if (chain.rules) chain.rules = chain.rules.flatMap((r: Json) => Project.filter(r, sets));
            for (const way of ["source", "destination"])
                if (d.firewall.nat?.[way]) d.firewall.nat[way] = d.firewall.nat[way].flatMap((r: Json) => Project.filter(r, sets));
            if (d.firewall.tcp_mss) d.firewall.tcp_mss = d.firewall.tcp_mss.flatMap((r: Json) => Project.filter(r, sets));
            if (!Object.keys(d.firewall).length) delete d.firewall;
        }
        return d;
    }
}
