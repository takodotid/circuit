// `circuit migrate`: a Circuit 0.x project written again as a v1 project. 0.x's `circuit.config.ts` is plain data made by functions that only return what they are given (`defineNetwork`, `defineDevice`), so Circuit imports it as it is, with the 0.x package the project installed, and writes each device in v1's groups and names. What v1 cannot take is listed in MIGRATION.md, for a person to do.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Validation } from "../checks";
import { EnvFile } from "../core/env-file";
import { ProjectError, readProject } from "../project/project";
import { EditorTypes } from "./editor-types";
import { GENERATED_README, GITIGNORE } from "./setup";
import { Ui } from "./ui";

type Json = any;

/** What 0.x's `defineNetwork` holds, as far as a migration reads it. */
type V0Network = {
    devices: readonly Json[];
    checks?: readonly unknown[];
    asn?: number;
    communities?: readonly { community: string; description: string }[];
    site?: (device: Json) => string;
    peeringdb?: { api_key: Json };
    librenms?: { url: string; api_token: Json };
    netbox?: { url: string; api_token: Json; device?: (device: Json) => { role?: string; device_type?: string } };
};

/** A project written in v1: its network, its devices by site, its certificate files, and what a person has to do. */
export type Migrated = {
    /** The network's name in `circuit.ts`, such as `as64500`. */
    name: string;
    settings: Json;
    devices: { site: string; device: Json }[];
    /** Certificate files, by path from the project. */
    files: Record<string, string>;
    /** What did not move, by device; the network's under "". */
    notes: Record<string, string[]>;
};

/** Drops each key whose value is undefined, and the map itself when nothing is left. */
function clean(map: Json): Json {
    if (!map || typeof map !== "object" || Array.isArray(map)) return map;
    const kept = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
    return Object.keys(kept).length ? kept : undefined;
}

/** A map with each value changed by `change`. */
const each = (map: Json, change: (v: Json, k: string) => Json) =>
    map && Object.fromEntries(Object.entries<Json>(map).map(([k, v]) => [k, change(v, k)]));

/** A filter or NAT rule's match. */
const filterMatch = (m: Json) =>
    m &&
    clean({
        ...m,
        src_set: undefined,
        dst_set: undefined,
        state: undefined,
        src_address_set: m.src_set,
        dst_address_set: m.dst_set,
        connection_state: m.state,
    });

const filterRule = ({ match, action, offload, ...rest }: Json) =>
    clean({ ...rest, if: filterMatch(match), then: action, fast_path: offload });

const natRule = ({ match, action, to, ...rest }: Json) => clean({ ...rest, if: filterMatch(match), then: action, to_address: to });

const aclRule = ({ match, action, ...rest }: Json) => clean({ ...rest, if: match, then: action });

function policyRule(rule: Json): Json {
    // A v1 call rule holds nothing but `call`: 0.x's description on one has no place.
    if (rule.call !== undefined) return { call: rule.call };
    const { match, set, action, ...rest } = rule;
    const m =
        match &&
        clean({
            ...match,
            through_as: undefined,
            community: undefined,
            as_path_contains: match.through_as,
            standard_community: match.community,
        });
    const s =
        set &&
        clean({
            ...set,
            communities: undefined,
            add_communities: undefined,
            remove_communities: undefined,
            standard_communities: set.communities,
            add_standard_communities: set.add_communities,
            remove_standard_communities: set.remove_communities,
        });
    return clean({ ...rest, if: m, set: s, then: action });
}

const staticRoute = ({ via, table, ...rest }: Json) => clean({ ...rest, next_hop: via, routing_table: table });

const neighbor = ({ import: imp, export: exp, families, table, group, ...rest }: Json) =>
    clean({ ...rest, import_policy: imp, export_policy: exp, address_families: families, routing_table: table, neighbor_group: group });

const addresses = (list: Json) => list?.map((a: Json) => (typeof a === "string" ? a : clean({ address: a.address, peer_address: a.peer })));

/** A port or an interface, in v1's names. */
function routed(x: Json): Json {
    const { lag, acl, local, remote, members, addresses: list, ...rest } = x;
    // A port with no settings stays: it is on, where a port left out is shut down.
    return (
        clean({
            ...rest,
            addresses: addresses(list),
            in_lag: lag,
            ingress_acl: acl,
            local_address: local,
            remote_address: remote,
            member_interfaces: members,
        }) ?? {}
    );
}

export class Migrate {
    /** 0.x's built-in checks, by their name in v1's `checks`. */
    private static readonly CHECKS: Record<string, string> = {
        exportsEndInReject: "exports_end_in_reject",
        importsEndInAcceptOrReject: "imports_end_in_accept_or_reject",
        tunnelsOutsideOffered: "tunnels_outside_offered",
        nativeVlansAreDeadEnds: "native_vlans_are_dead_ends",
    };

    /** The site a device is at when 0.x's network names none. */
    static readonly DEFAULT_SITE = "site-1";

    /**
     * A device written for Circuit 0.x, as the v1 model has it: the same values, in v1's groups and field names, every rule as `{ if, then }`. `certificate` gives the path a certificate's text is kept at.
     */
    static device(d: Json, site: string, certificate: (name: string, pem: string) => string): Json {
        const {
            name,
            platform,
            model,
            connection,
            system = {},
            users,
            management = {},
            certificates: certs,
            vlans,
            ports,
            interfaces,
            vrfs,
        } = d;
        const {
            routing = {},
            policies,
            prefix_sets,
            firewall,
            acls,
            dhcp,
            dhcp_relay,
            flow_export,
            lldp,
            stp,
            hardware_offload,
            vdoms,
        } = d;
        const { dns, ntp, logging, alarms, transceiver_monitoring, ip, ...systemRest } = system;
        const { snmp, native, ...managementRest } = management;
        const { console: con, ...conn } = connection;

        const byType: Json = {};
        for (const [key, { type, ...rest }] of Object.entries<Json>(interfaces ?? {}))
            (byType[type === "vlan" ? "vlan_interface" : type] ??= {})[key] = routed(rest);

        const { static: statics, rules, bgp, ospf, ...routingRest } = routing;

        return clean({
            name,
            site,
            platform,
            model,
            connection: clean({ ...conn, console: con && clean({ ...con, passwordOnly: undefined, password_only: con.passwordOnly }) }),
            system: clean({
                ...systemRest,
                ip_stack: ip,
                dns: dns?.servers && { servers: dns.servers },
                ntp: ntp?.servers && { servers: ntp.servers },
                logging: logging?.local && { local: logging.local },
                alarms,
                hardware_offload,
                users,
                certificates: each(certs, (c, k) => clean({ certificate_file: certificate(k, c.certificate), private_key: c.private_key })),
                vdoms: each(vdoms, ({ static: s, ...v }) => clean({ ...v, static_routes: s?.map(staticRoute) })),
            }),
            management: clean({ ...managementRest, native_protocol: native }),
            monitoring: clean({ snmp, syslog: logging?.remote, flow_export, transceivers: transceiver_monitoring }),
            interfaces: clean({ ethernet: each(ports, routed), ...byType }),
            switching: clean({ vlans, stp, lldp, acls: each(acls, (rules) => rules.map(aclRule)) }),
            services: clean({ dhcp_server: dhcp, dhcp_relay, dns_server: dns?.serve, ntp_server: ntp?.serve }),
            routing: clean({
                ...routingRest,
                vrfs,
                static_routes: statics?.map(staticRoute),
                policy_routing: rules?.map(({ table, ...r }: Json) => clean({ ...r, routing_table: table })),
                ospf: ospf && clean({ ...ospf, families: undefined, address_families: ospf.families }),
                bgp:
                    bgp &&
                    clean({
                        asn: bgp.asn,
                        originated_prefixes: bgp.networks,
                        neighbor_groups: each(bgp.groups, neighbor),
                        neighbors: each(bgp.neighbors, neighbor),
                    }),
                policies: each(policies, (rules) => rules.map(policyRule)),
                prefix_sets,
            }),
            firewall:
                firewall &&
                clean({
                    address_sets: firewall.address_sets,
                    filter: each(firewall.filter, ({ default: def, rules: r }) =>
                        clean({ default_action: def, rules: r?.map(filterRule) })
                    ),
                    nat:
                        firewall.nat &&
                        clean({ source: firewall.nat.source?.map(natRule), destination: firewall.nat.destination?.map(natRule) }),
                    conntrack_helpers: firewall.helpers,
                    untracked: firewall.untracked,
                }),
        });
    }

    /** What a person has to do for one 0.x device that the migration cannot: values that have no place in v1. */
    private static deviceNotes(d: Json): string[] {
        const notes: string[] = [];

        for (const [name, rules] of Object.entries<Json>(d.policies ?? {})) {
            const described = (rules as Json[]).filter((rule) => rule.call !== undefined && rule.description !== undefined).length;
            if (described)
                notes.push(
                    `Route policy \`${name}\`: ${described} \`call\` rule(s) had a description. A v1 call rule holds only \`call\`, so it was left out.`
                );
        }

        return notes;
    }

    /** Import 0.x's `circuit.config.ts`, with the 0.x package the project installed. Its default export is the network. */
    static async load(folder: string, config: string): Promise<{ network: V0Network; checks: Record<string, unknown> }> {
        const path = resolve(folder, config);
        if (!existsSync(path)) Ui.fail(`No ${config} in ${folder}. Give the 0.x project's folder, or its config file with --config.`);

        const installed = join(folder, "node_modules", "@takodotid", "circuit", "package.json");
        if (readFileSync(path, "utf8").includes("@takodotid/circuit") && !existsSync(installed)) {
            Ui.fail(
                `${folder} has no node_modules/@takodotid/circuit. Install the 0.x project's packages first, as you did to run it: npm install (or bun install) in that folder.`
            );
        }

        let module: Json;
        try {
            module = await import(pathToFileURL(path).href);
        } catch (error) {
            Ui.fail(`Circuit 0.x's config could not be read: ${(error as Error).message}`);
        }

        const network = module.default as V0Network | undefined;
        if (!network || !Array.isArray(network.devices))
            Ui.fail(`${config} does not export a network: export default defineNetwork({ devices: [...] }).`);

        // 0.x's own checks, the same functions the config placed in `checks`, so they can be told apart from a project's.
        let checks: Record<string, unknown> = {};
        try {
            const helpers = join(dirname(installed), "src", "helpers", "index.ts");
            if (existsSync(helpers)) checks = (await import(pathToFileURL(helpers).href)).Checks ?? {};
        } catch {
            checks = {};
        }

        return { network, checks };
    }

    /** The network and its devices in v1, and what did not move. */
    static convert(network: V0Network, v0Checks: Record<string, unknown> = {}): Migrated {
        const notes: Record<string, string[]> = { "": [] };
        const files: Record<string, string> = {};
        const name = network.asn ? `as${network.asn}` : "network";

        const siteOf = (device: Json) => network.site?.(device) ?? Migrate.DEFAULT_SITE;
        if (!network.site)
            notes[""]!.push(
                `0.x's network names no \`site\`, so every device is at \`${Migrate.DEFAULT_SITE}\`. Rename it in circuit.ts, and its folder under sites/.`
            );

        const devices = network.devices.map((d) => {
            const site = siteOf(d);
            const device = Migrate.device(d, site, (certificate, pem) => {
                const path = `certificates/${d.name}-${certificate}.pem`;
                files[path] = pem;
                return path;
            });

            const role = network.netbox?.device?.(d).role;
            if (role) device.role = role;

            notes[d.name] = Migrate.deviceNotes(d);
            return { site, device };
        });

        const checks: Record<string, true> = {};
        let own = 0;
        for (const check of network.checks ?? []) {
            const builtIn = Object.entries(Migrate.CHECKS).find(([v0]) => v0Checks[v0] === check)?.[1];
            if (builtIn) checks[builtIn] = true;
            else own++;
        }
        if (own) {
            notes[""]!.push(
                `${own} check(s) in \`checks\` are your own, or \`Checks.trustBoundary\`. They are code, so they did not move: write them again in circuit.ts. \`trustBoundary\` is now the built-in \`untrusted_vlans\`.`
            );
        }

        if (network.communities?.length) {
            notes[""]!.push(
                `0.x's \`communities\` listed ${network.communities.length} communities. v1 writes the network's community scheme instead, in \`circuit()\`'s \`communities\`: write it by hand. They were:`,
                ...network.communities.map((entry) => `    - \`${entry.community}\`: ${entry.description}`)
            );
        }

        if (network.netbox?.device)
            notes[""]!.push(
                "NetBox: each device's `role` came from `netbox.device`. A `device_type` other than the model has no place in v1."
            );

        const integrations = clean({
            peeringdb: network.peeringdb && { api_key: network.peeringdb.api_key },
            librenms: network.librenms && { url: network.librenms.url, api_token: network.librenms.api_token },
            netbox: network.netbox && { url: network.netbox.url, api_token: network.netbox.api_token },
        });

        const sites = Object.fromEntries([...new Set(devices.map((entry) => entry.site))].sort().map((site) => [site, {}]));
        const settings = clean({
            asn: network.asn,
            sites,
            checks: clean(checks),
            integrations,
        });

        return { name, settings, devices, files, notes };
    }

    /** A value written as TypeScript a person reads: keys bare where they can be, a secret as `secret("NAME")`, short lists on one line. */
    static print(value: Json, indent = ""): string {
        const inner = `${indent}    `;

        if (value === null || typeof value !== "object") return JSON.stringify(value);

        if (!Array.isArray(value)) {
            const keys = Object.keys(value);
            if (keys.length === 1 && typeof value.secret === "string") return `secret(${JSON.stringify(value.secret)})`;
            if (keys.length === 1 && typeof value.secret_file === "string") return `secretFile(${JSON.stringify(value.secret_file)})`;
        }

        if (Array.isArray(value) ? !value.length : !Object.keys(value).length) return Array.isArray(value) ? "[]" : "{}";

        const flat = Array.isArray(value)
            ? `[${value.map((item) => Migrate.print(item, inner)).join(", ")}]`
            : `{ ${Object.entries(value)
                  .map(([key, item]) => `${Migrate.key(key)}: ${Migrate.print(item, inner)}`)
                  .join(", ")} }`;

        // One line when it is short and holds nothing nested over lines.
        if (!flat.includes("\n") && flat.length + indent.length <= 100) return flat;

        const lines = Array.isArray(value)
            ? value.map((item) => `${inner}${Migrate.print(item, inner)},`)
            : Object.entries(value).map(([key, item]) => `${inner}${Migrate.key(key)}: ${Migrate.print(item, inner)},`);
        const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
        return `${open}\n${lines.join("\n")}\n${indent}${close}`;
    }

    private static key(key: string): string {
        return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    }

    /** Write the project into `out`, which must be empty or not there yet. `.env` is copied, encrypted, only when `copyEnv`. */
    static write(out: string, migrated: Migrated, from: { root: string; copyEnv: boolean }): void {
        if (existsSync(out) && readdirSync(out).length) Ui.fail(`${out} already holds files. Give an empty folder with --out.`);

        mkdirSync(join(out, "sites"), { recursive: true });
        mkdirSync(join(out, "tenants"), { recursive: true });

        writeFileSync(
            join(out, "circuit.ts"),
            `// The network, moved from Circuit 0.x by circuit migrate. What did not move is in MIGRATION.md.\n\nexport const ${migrated.name} = circuit(${Migrate.print(migrated.settings)});\n`
        );

        for (const { site, device } of migrated.devices) {
            mkdirSync(join(out, "sites", site), { recursive: true });
            writeFileSync(
                join(out, "sites", site, `${device.name}.ts`),
                `import { ${migrated.name} } from "../../circuit";\n\nexport default ${migrated.name}.device(${Migrate.print(device)});\n`
            );
        }

        for (const [path, text] of Object.entries(migrated.files)) {
            mkdirSync(join(out, dirname(path)), { recursive: true });
            writeFileSync(join(out, path), text);
        }

        writeFileSync(
            join(out, "sites", "README.md"),
            "One folder per site, named as in circuit.ts, with one file per device: sites/<site>/<device>.ts.\n"
        );
        writeFileSync(
            join(out, "tenants", "README.md"),
            "What tenants share with your devices, one file each, merged in `tenants/index.ts`.\n"
        );
        writeFileSync(join(out, ".gitignore"), GITIGNORE);
        writeFileSync(join(out, "tsconfig.json"), EditorTypes.TSCONFIG);
        EditorTypes.write(out);
        writeFileSync(join(out, ".circuit", "README.md"), GENERATED_README);

        Migrate.writeEnv(out, from);
    }

    /** A new encrypted `.env`, with 0.x's values copied in and encrypted at once when asked. No value is ever printed. */
    private static writeEnv(out: string, from: { root: string; copyEnv: boolean }): void {
        EnvFile.create(out, { kind: "file" });

        const source = join(from.root, ".env");
        if (!from.copyEnv || !existsSync(source)) return;

        const lines = readFileSync(source, "utf8")
            .split(/\r?\n/)
            .filter((line) => !/^\s*(export\s+)?DOTENV_(PUBLIC|PRIVATE)_KEY/.test(line));
        writeFileSync(join(out, ".env"), `${readFileSync(join(out, ".env"), "utf8")}\n${lines.join("\n")}\n`);
        new EnvFile(out).encryptAll();
    }

    /** Files a `secretFile()` names, which a migration does not copy: they stay out of git, by hand. */
    private static secretFiles(value: Json, found = new Set<string>()): Set<string> {
        if (value && typeof value === "object") {
            if (typeof value.secret_file === "string") found.add(value.secret_file);
            for (const item of Object.values(value)) Migrate.secretFiles(item, found);
        }
        return found;
    }

    /** MIGRATION.md: what a person still has to do, the network's first, then each device's, then what Circuit v1 finds in the project. */
    static report(migrated: Migrated, found: string[]): string {
        const lines = [
            "# Moved from Circuit 0.x",
            "",
            "`circuit migrate` wrote this project from a Circuit 0.x project. Each line below is something to do by hand. Delete this file when they are done.",
            "",
            "0.x's snapshots (`.circuit/state`) did not move: v1 reads each device when it plans.",
        ];

        const files = [...Migrate.secretFiles(migrated.devices.map((entry) => entry.device)), ...Migrate.secretFiles(migrated.settings)];
        if (files.length)
            migrated.notes[""]!.push(
                `Copy the files \`secretFile()\` names into this folder, and keep them out of git: ${files.map((file) => `\`${file}\``).join(", ")}.`
            );

        if (migrated.notes[""]!.length)
            lines.push("", "## The network", "", ...migrated.notes[""]!.map((note) => (note.startsWith("    ") ? note : `- ${note}`)));

        for (const { device } of migrated.devices) {
            const notes = migrated.notes[device.name] ?? [];
            if (notes.length) lines.push("", `## ${device.name}`, "", ...notes.map((note) => `- ${note}`));
        }

        lines.push("", "## What Circuit v1 finds", "");
        if (found.length)
            lines.push(
                "An error stops `diff` and `apply` until it is fixed; a warning does not. Then run `circuit validate`:",
                "",
                ...found.map((line) => `- ${line}`)
            );
        else lines.push("Nothing: the project reads and validates. Run `circuit diff <device>` on each device before the first `apply`.");

        return `${lines.join("\n")}\n`;
    }

    /** What Circuit v1 finds in the project just written: errors reading it, then each error and warning of the model's checks. */
    static async findings(out: string): Promise<string[]> {
        try {
            const read = await readProject(out);
            return [
                ...read.warnings.map((warning) => `warning: ${warning}`),
                ...read.networks.flatMap((network) =>
                    Validation.run(Object.values(network.devices), network.settings.checks).map(
                        (finding) => `${finding.level}: ${finding.device ? `${finding.device}: ` : ""}${finding.message}`
                    )
                ),
            ];
        } catch (error) {
            if (error instanceof ProjectError) return error.lines;
            throw error;
        }
    }

    /** The whole of `circuit migrate`: read 0.x, write v1, and say what is left. */
    static async run(folder: string, options: { out?: string; config: string; yes: boolean }): Promise<void> {
        const root = resolve(process.cwd(), folder);
        const out = resolve(process.cwd(), options.out ?? `${root}-v1`);
        if (existsSync(out) && readdirSync(out).length) Ui.fail(`${out} already holds files. Give an empty folder with --out.`);

        const { network, checks } = await Ui.step("Reading the Circuit 0.x project", () => Migrate.load(root, options.config));
        const migrated = Migrate.convert(network, checks);

        let copyEnv = false;
        if (existsSync(join(root, ".env"))) {
            if (options.yes) copyEnv = true;
            else if (Ui.interactive)
                copyEnv = await Ui.confirm("Copy the 0.x project's .env into the new project? It is encrypted there at once.");
        }

        await Ui.step(`Writing ${migrated.devices.length} device(s) to ${out}`, async () =>
            Migrate.write(out, migrated, { root, copyEnv })
        );

        const found = await Ui.step("Checking the new project", () => Migrate.findings(out));
        writeFileSync(join(out, "MIGRATION.md"), Migrate.report(migrated, found));

        Ui.done(`${basename(out)}: ${migrated.devices.length} device(s) moved${copyEnv ? ", .env copied and encrypted" : ""}.`);
        Ui.note(
            [
                `cd ${out}`,
                "Read MIGRATION.md: what did not move, and what to fix.",
                copyEnv
                    ? "The key that decrypts .env is in .env.keys. Keep a copy in your password manager."
                    : "Set each secret with circuit secret set NAME, or copy .env and run circuit secret encrypt.",
                "circuit validate, then circuit diff <device> on each device.",
            ].join("\n"),
            "Next"
        );
    }
}
