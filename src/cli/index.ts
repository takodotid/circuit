#!/usr/bin/env node
// The command line. `new` starts a project; every other command loads the network from `circuit.config.ts` in the working directory, or the file `--config` names.

import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Platforms } from "../platforms";
import type { ApplyOptions, Platform, Plan } from "../platforms/platform";
import { Registries } from "../integrations/registries";
import { LibreNms } from "../integrations/librenms";
import { PeeringDb } from "../integrations/peeringdb";
import { Prometheus } from "../integrations/prometheus";
import { Address } from "../core/address";
import { AddressSpace, type Segment } from "../core/address-space";
import type { Network } from "../core/define";
import { Topology, type Annotated, type Drift, type Layer } from "../core/topology";
import { Secrets } from "../core/secrets";
import { Validator } from "../core/validator";
import type { Device } from "../schema";
import { GraphFormat } from "./graph-format";
import { Rename, type RenamePlan } from "./rename";
import { ProjectFiles } from "../core/project-files";
import { StudioModel } from "../studio/data";

const HELP = `usage: circuit <command> [device...] [options]

  new [directory]       start a project from a pattern, asking what it needs
  validate              check the config, then every rule in checks
  build <device>        print the configuration the device should run, without contacting it
  diff [device...]      what apply would send, planned against the last snapshot, offline
  snapshot [device...]  read what each device runs into the state directory
  apply <device>        read the device, plan against what it runs, and send with --confirm
                          --secrets      also send every secret, to rotate one
                          --rollback=N   minutes before a device that can restore itself does, default 10
                          --console      through the device's serial console on its jump host, instead of SSH; also for snapshot
  refresh <device>      fetch prefix sets that come from a registry onto the device, with --confirm
  wireguard <device> <interface> <peer>
                        a client config for one peer, its private key left for the peer to fill
  communities           the network's BGP communities, one per line, for a looking glass or bgp.tools
  peeringdb             bring PeeringDB's exchange records in line with the config, with --confirm
  librenms              add every device LibreNMS does not monitor yet, with --confirm
  prometheus            every device with SNMP, as Prometheus targets for snmp_exporter
                          --auths        snmp_exporter's auths for them instead, with secrets as \${NAME}
  secrets               every secret the config uses, and whether each can be read
  rename <device> <new-name>
                        give a device a new name in every file that names it, with --confirm
                          --file         also rename the file that declares it, to <new-name>.ts
  addresses [prefix]    every address the config uses, by prefix, and what is still free
                          --length=N     free prefixes of this length, instead of the fewest that cover the free space
                          --format=json  as JSON
  graph [device...]     the network as a graph, from the config alone, without contacting a device
                          --layer=l1     l1, l2, l3, bgp, ospf or tunnels, several with commas, or all
                          --format=mermaid  mermaid, dot or json
  studio                Circuit Studio: the network in the browser, drawn again whenever the config changes
                          --port=4600    the port it listens on
                          --no-open      do not open the browser
                          --host=0.0.0.0 listen on a server's address instead, with --allow-host
                          --allow-host=studio.example.com
                                         the names it is reached by, several with commas
                          --json         print what Studio shows, as JSON, instead

  --config <path>       the network's config file, circuit.config.ts in the working directory by default`;

const GENERATED_README = `# Written by Circuit

Do not edit anything here: an edit changes nothing on a device, and Circuit overwrites it. Change the config instead.

\`state/\` holds what each device ran when Circuit last read it, with secrets removed. \`circuit snapshot\` and \`circuit apply\` write it, and \`circuit diff\` plans against it. Commit it, so the history of this directory is the history of the network.
`;

/** One run of the command line: the network it loaded, and the device names and flags it was given. */
class Cli {
    static readonly DEFAULT_CONFIG = "circuit.config.ts";

    /** The directory of the config file. `.circuit/`, `.env` and secret files are found from here. */
    private readonly root: string;
    private readonly flags: string[];
    private readonly names: string[];
    private readonly confirmed: boolean;
    private readonly options: ApplyOptions;
    /** What Circuit writes, beside the config. */
    private readonly generated: string;
    private readonly stateDirectory: string;

    constructor(
        private readonly configPath: string,
        private readonly network: Network,
        rest: string[]
    ) {
        this.root = dirname(configPath);
        this.flags = rest.filter((arg) => arg.startsWith("--"));
        this.names = rest.filter((arg) => !arg.startsWith("--"));
        this.confirmed = this.flags.includes("--confirm");
        this.options = {
            secrets: this.flags.includes("--secrets"),
            rollback: Number(this.flags.find((flag) => flag.startsWith("--rollback="))?.split("=")[1] ?? 10),
            ...(this.flags.includes("--console") ? { console: true } : {}),
        };
        this.generated = join(this.root, ".circuit");
        this.stateDirectory = join(this.generated, "state");
    }

    /** Read the arguments, load the network, and run the command they name. */
    static async main(argv: string[]): Promise<void> {
        const [command, ...args] = argv;

        if (command === "new") {
            const { Scaffold } = await import("./new");
            await Scaffold.create(args);
            process.exit(0);
        }

        if (!command || command === "help" || command === "--help" || command === "-h") {
            console.log(HELP);
            process.exit(0);
        }

        // `--config <path>` and `--config=<path>` both name the config file; neither is a device name.
        const configAt = args.indexOf("--config");
        const configArgument =
            configAt >= 0 ? args[configAt + 1] : args.find((arg) => arg.startsWith("--config="))?.slice("--config=".length);
        const rest = args.filter(
            (arg, index) => index !== configAt && (configAt < 0 || index !== configAt + 1) && !arg.startsWith("--config=")
        );

        const configPath = resolve(process.cwd(), configArgument ?? Cli.DEFAULT_CONFIG);

        if (!existsSync(configPath)) {
            console.error(
                configArgument
                    ? `no config at ${configPath}`
                    : `no ${Cli.DEFAULT_CONFIG} in ${process.cwd()}; name another with --config <path>`
            );
            process.exit(1);
        }

        Secrets.useRoot(dirname(configPath));

        const network = await Cli.load(configPath);
        await new Cli(configPath, network, rest).run(command);
    }

    /** The config, a TypeScript file. Bun imports it as it is; Node needs jiti, which also resolves imports written without an extension. */
    private static async load(path: string): Promise<Network> {
        if (process.versions.bun) return (await import(path)).default;

        const { createJiti } = await import("jiti");
        return createJiti(import.meta.url).import(path, { default: true });
    }

    private static fail(message: string): never {
        console.error(message);
        process.exit(1);
    }

    /** Run one command, or say there is no such command. */
    async run(command: string): Promise<void> {
        const commands: Record<string, () => void | Promise<void>> = {
            validate: () => this.validate(),
            build: () => this.build(),
            diff: () => this.diff(),
            snapshot: () => this.snapshot(),
            apply: () => this.apply(),
            refresh: () => this.refresh(),
            wireguard: () => this.wireguard(),
            communities: () => this.communities(),
            peeringdb: () => this.peeringdb(),
            librenms: () => this.librenms(),
            prometheus: () => this.prometheus(),
            secrets: () => this.secrets(),
            rename: () => this.rename(),
            addresses: () => this.addresses(),
            graph: () => this.graph(),
            studio: () => this.studio(),
        };

        const run = commands[command];
        if (run) await run();
        else Cli.fail(`no command ${command}\n\n${HELP}`);
    }

    /** The devices named on the command line, or every device when none is and `allByDefault`. */
    private selected(allByDefault: boolean): Device[] {
        if (!this.names.length && allByDefault) return [...this.network.devices];

        const known = this.network.devices.map((device) => device.name).join(", ");
        const byName = (name: string) => this.network.devices.find((device) => device.name === name);

        return this.names.map((name) => byName(name) ?? Cli.fail(`no device ${name}; known: ${known}`));
    }

    private one(): Device {
        const [device] = this.selected(false);
        return device ?? Cli.fail("name a device");
    }

    /** How a device is reached: through its console when `--console` asks, or when it has no management address. */
    private optionsFor(device: Device): ApplyOptions {
        return this.options.console || !device.connection.host ? { ...this.options, console: true } : this.options;
    }

    /** The adapter of a device, which must be able to use its console when the device is reached through it. */
    private adapterOf(device: Device): Platform {
        const adapter = Platforms.find(device.platform) ?? Cli.fail(`no adapter for ${device.platform}`);
        if (!this.optionsFor(device).console) return adapter;

        if (!adapter.console) Cli.fail(`${device.name}: ${device.platform} cannot be reached through a console yet`);
        if (!device.connection.console) Cli.fail(`${device.name}: --console needs connection.console`);
        return adapter;
    }

    private statePath(device: Device): string {
        return join(this.stateDirectory, device.name + this.adapterOf(device).extension);
    }

    /** Record what a device runs, beside a note that the directory is generated. */
    private writeState(device: Device, text: string): void {
        mkdirSync(this.stateDirectory, { recursive: true });
        writeFileSync(join(this.generated, "README.md"), GENERATED_README);
        writeFileSync(this.statePath(device), text);
    }

    /** Validate, print what was found, and stop on an error about one of these devices. */
    private guard(devices: Device[]): void {
        const relevant = new Set(devices.map((device) => device.name));
        const findings = Validator.run(this.network).filter((finding) => !finding.device || relevant.has(finding.device));

        for (const finding of findings) {
            const where = finding.device ? `${finding.device}: ` : "";
            const level = finding.level === "error" ? "error" : "warn ";
            console.log(`  ${level}  ${where}${finding.message}`);
        }

        const errors = findings.filter((finding) => finding.level === "error").length;
        if (errors) Cli.fail(`\n${errors} error(s).`);
    }

    /** Print a plan. Returns how many commands and problems it holds. */
    private static show(device: Device, plan: Plan): number {
        const commands = plan.steps.reduce((count, step) => count + step.send.length, 0);
        const summary = commands ? `${commands} command(s) in ${plan.steps.length} step(s)` : "matches";
        console.log(`${device.name}: ${summary}`);

        for (const step of plan.steps) {
            console.log(`  ${step.title}`);
            for (const line of step.show) console.log(`    ${line.slice(0, 220)}`);
        }

        for (const problem of plan.problems) console.log(`  PROBLEM ${problem}`);

        return commands + plan.problems.length;
    }

    private validate(): void {
        this.guard([...this.network.devices]);
        console.log(`${this.network.devices.length} device(s), no errors.`);
    }

    private build(): void {
        const device = this.one();
        process.stdout.write(this.adapterOf(device).render(device));
    }

    private diff(): void {
        const devices = this.selected(true);
        this.guard(devices);

        let differences = 0;

        for (const device of devices) {
            const path = this.statePath(device);
            if (!existsSync(path)) {
                console.log(`${device.name}: no snapshot, run snapshot first`);
                continue;
            }

            const adapter = this.adapterOf(device);
            const plan = adapter.plan(adapter.render(device), readFileSync(path, "utf8"), this.options);
            differences += Cli.show(device, plan);
        }

        process.exit(differences ? 1 : 0);
    }

    private async snapshot(): Promise<void> {
        for (const device of this.selected(true)) {
            const text = await this.adapterOf(device).read(device, this.network.devices, this.optionsFor(device));
            this.writeState(device, text);
            console.log(`${device.name}: ${text.split("\n").length} lines`);
        }

        // With every device read, a snapshot of a device the config no longer has, such as one renamed, is removed.
        if (this.names.length || !existsSync(this.stateDirectory)) return;

        const current = new Set(this.network.devices.map((device) => basename(this.statePath(device))));
        for (const file of readdirSync(this.stateDirectory)) {
            if (current.has(file)) continue;

            rmSync(join(this.stateDirectory, file));
            console.log(`${file}: removed, no such device in the config`);
        }
    }

    private async apply(): Promise<void> {
        const device = this.one();
        this.guard([device]);
        const adapter = this.adapterOf(device);

        // The plan is made against what the device runs now, never against an old snapshot.
        const live = await adapter.read(device, this.network.devices, this.optionsFor(device));
        this.writeState(device, live);

        const plan = adapter.plan(adapter.render(device), live, this.options);
        if (!Cli.show(device, plan)) return;

        if (plan.problems.length) Cli.fail("\nNot sent: resolve the problems first.");

        if (!this.confirmed) {
            console.log("\nNothing sent. Re-run with --confirm.");
            return;
        }

        await adapter.apply(device, this.network.devices, plan, this.optionsFor(device));

        this.writeState(device, await adapter.read(device, this.network.devices, this.optionsFor(device)));
        console.log("snapshot updated");
    }

    private async refresh(): Promise<void> {
        const device = this.one();
        const adapter = this.adapterOf(device);
        const fill = adapter.fill?.bind(adapter) ?? Cli.fail(`${device.platform} cannot hold a fetched prefix set`);

        for (const [name, set] of Object.entries(device.prefix_sets ?? {})) {
            if (!("source" in set)) continue;

            const { registry, query, family } = set.source;
            const prefixes = await Registries.prefixes(registry, query, family);

            // An empty or absurd answer is a broken feed, not a policy.
            if (prefixes.length < 1 || prefixes.length > 100_000) {
                Cli.fail(`${name}: ${prefixes.length} prefixes from ${registry}, refusing`);
            }

            console.log(`${name}: ${prefixes.length} prefixes from ${registry} ${query}`);
            if (this.confirmed) await fill(device, this.network.devices, name, family, prefixes);
        }

        if (!this.confirmed) console.log("\nNothing sent. Re-run with --confirm.");
    }

    /** A WireGuard public key from its private key, so the device's never has to be read off the box. */
    private static publicKeyOf(privateKey: string): string {
        // The DER prefix of a raw X25519 private key in PKCS#8.
        const pkcs8Prefix = Buffer.from("302e020100300506032b656e04220420", "hex");
        const der = Buffer.concat([pkcs8Prefix, Buffer.from(privateKey, "base64")]);

        const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
        const publicDer = createPublicKey(key).export({ format: "der", type: "spki" });

        return publicDer.subarray(-32).toString("base64");
    }

    private wireguard(): void {
        const [deviceName, interfaceName, peerName] = this.names;
        const device = this.network.devices.find((candidate) => candidate.name === deviceName) ?? Cli.fail(HELP);

        const iface = device.interfaces?.[interfaceName ?? ""];
        if (iface?.type !== "wireguard") Cli.fail(`${deviceName} has no WireGuard interface ${interfaceName}`);

        const peers = iface.peers ?? [];
        const peerNames = peers.map((candidate) => candidate.name).join(", ");
        const peer =
            peers.find((candidate) => candidate.name === peerName) ?? Cli.fail(`no peer ${peerName} on ${interfaceName}: ${peerNames}`);

        const tunnelNetworks = (iface.addresses ?? []).map((entry) => Address.prefixOf(typeof entry === "string" ? entry : entry.address));

        const lines = [
            "[Interface]",
            `# ${peerName}'s own private key. It never leaves their machine.`,
            "PrivateKey = <FILL IN>",
            `Address = ${peer.allowed_addresses.join(", ")}`,
            "",
            "[Peer]",
            `PublicKey = ${Cli.publicKeyOf(Secrets.resolve(iface.private_key))}`,
            `Endpoint = ${iface.endpoint ?? "<FILL IN>"}:${iface.listen_port}`,
            `AllowedIPs = ${(peer.client_allowed_addresses ?? tunnelNetworks).join(", ")}`,
            "PersistentKeepalive = 25",
            "",
        ];
        process.stdout.write(lines.join("\n"));
    }

    private communities(): void {
        const communities = this.network.communities ?? Cli.fail("the network declares no communities");

        for (const { community, description } of communities) {
            // The format splits each line at its first comma.
            if (community.includes(",")) Cli.fail(`community ${community} holds a comma`);
            console.log(`${community},${description}`);
        }
    }

    private async peeringdb(): Promise<void> {
        const plan = await PeeringDb.plan(this.network);

        for (const name of plan.unknown) {
            console.log(`  PeeringDB lists ${name}, which the config does not. Remove it by hand if the network left.`);
        }

        for (const change of plan.changes) console.log(`  ${change.summary}`);

        if (!plan.changes.length) {
            console.log("PeeringDB matches the config.");
            return;
        }

        if (!this.confirmed) {
            console.log("\nNothing sent. Re-run with --confirm.");
            return;
        }

        await PeeringDb.send(this.network, plan.changes);
    }

    private async librenms(): Promise<void> {
        const plan = await LibreNms.plan(this.network);

        for (const hostname of plan.unknown)
            console.log(`  LibreNMS monitors ${hostname}, which the config does not. Remove it by hand if it is gone.`);
        for (const device of plan.withoutSnmp)
            console.log(`  ${device.name} has no SNMP in its config, so LibreNMS cannot poll it. Add management.snmp first.`);
        for (const device of plan.additions) console.log(`  add ${device.name}, ${device.connection.host}`);

        if (!plan.additions.length) {
            console.log("LibreNMS monitors every device it can.");
            return;
        }

        if (!this.confirmed) {
            console.log("\nNothing sent. Re-run with --confirm.");
            return;
        }

        await LibreNms.send(this.network, plan.additions);
    }

    private prometheus(): void {
        if (this.flags.includes("--auths")) {
            const { yaml, notes } = Prometheus.snmpExporterAuths(this.network);
            for (const note of notes) console.error(note);
            process.stdout.write(yaml);
            return;
        }

        const { targets, withoutSnmp } = Prometheus.targets(this.network);
        for (const device of withoutSnmp) console.error(`${device.name} has no SNMP in its config; left out`);
        console.log(JSON.stringify(targets, null, 4));
    }

    /** Every secret reference in a value, however deep. */
    private static secretsIn(value: unknown, found = new Set<string>()): Set<string> {
        if (Secrets.isSecret(value)) found.add(Secrets.referenceOf(value));
        else if (Array.isArray(value)) for (const item of value) Cli.secretsIn(item, found);
        else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) Cli.secretsIn(item, found);

        return found;
    }

    private secrets(): void {
        const references = [...Cli.secretsIn([this.network.devices, this.network.peeringdb, this.network.librenms])].sort();
        let missing = 0;

        for (const reference of references) {
            const name = reference.replace(/^file:/, "");

            try {
                Secrets.resolve(reference);
                console.log(`  ok       ${name}, from ${Secrets.sourceOf(reference)}`);
            } catch (error) {
                missing++;
                console.log(`  missing  ${name}: ${(error as Error).message}`);
            }
        }

        console.log(`\n${references.length} secret(s), ${missing} missing.`);
        process.exit(missing ? 1 : 0);
    }

    /** The value of `--name=value`, or undefined when it is not given. */
    private flagValue(name: string): string | undefined {
        return this.flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
    }

    /** How a device compares with its last snapshot, offline, as `diff` plans it. */
    private driftOf(device: Device): Drift {
        const path = this.statePath(device);
        if (!existsSync(path)) return { status: "no snapshot", lines: [] };

        try {
            const adapter = this.adapterOf(device);
            const plan = adapter.plan(adapter.render(device), readFileSync(path, "utf8"), this.options);

            const lines = [
                ...plan.steps.flatMap((step) => [step.title, ...step.show.map((line) => `  ${line}`)]),
                ...plan.problems.map((problem) => `PROBLEM ${problem}`),
            ];

            return { status: lines.length ? "differs" : "matches", lines };
        } catch (error) {
            return { status: "cannot plan", lines: [(error as Error).message] };
        }
    }

    /** The graph on these layers, around these devices when any are named, with what validate found and how each device drawn compares with its snapshot. */
    private annotatedGraph(layers: readonly Layer[], deviceNames: readonly string[]): Annotated {
        const graph = Topology.only(Topology.of(this.network.devices), layers, deviceNames);
        const shown = new Set(graph.nodes.map((node) => node.label));

        return {
            ...graph,
            findings: Validator.run(this.network).filter((finding) => !finding.device || shown.has(finding.device)),
            drift: Object.fromEntries(
                this.network.devices.filter((device) => shown.has(device.name)).map((device) => [device.name, this.driftOf(device)])
            ),
        };
    }

    private graph(): void {
        const requested = (this.flagValue("layer") ?? "l1").split(",");
        const layers = requested.includes("all") ? [...Topology.LAYERS] : (requested as Layer[]);

        const unknown = layers.filter((layer) => !Topology.LAYERS.includes(layer));
        if (unknown.length) Cli.fail(`no layer ${unknown.join(", ")}; known: ${Topology.LAYERS.join(", ")}, all`);

        const format = this.flagValue("format") ?? "mermaid";
        const devices = this.selected(true);
        const annotated = this.annotatedGraph(layers, this.names.length ? devices.map((device) => device.name) : []);

        if (format === "mermaid") process.stdout.write(GraphFormat.mermaid(annotated));
        else if (format === "dot") process.stdout.write(GraphFormat.dot(annotated));
        else if (format === "json") console.log(JSON.stringify(annotated, null, 4));
        else Cli.fail(`no format ${format}; known: mermaid, dot, json`);
    }

    /** One segment and what uses each address in it. */
    private static printSegment(segment: Segment, indent: string): void {
        const next = segment.next ? `, next ${segment.next}` : "";
        console.log(`${indent}${segment.prefix}, ${segment.free} free${next}`);

        const width = Math.max(...segment.uses.map((use) => use.address.length)) + 2;
        for (const use of segment.uses) console.log(`${indent}    ${use.address.padEnd(width)}${use.what}`);
    }

    private addresses(): void {
        const [within] = this.names;
        if (within && !Address.isCidr(within)) Cli.fail(`${within} is not a prefix, such as 10.0.0.0/16`);

        const lengthText = this.flagValue("length");
        const length = lengthText === undefined ? undefined : Number(lengthText);
        if (length !== undefined && !(Number.isInteger(length) && length >= 0 && length <= 128))
            Cli.fail("--length takes a prefix length, such as 24");

        const report = AddressSpace.report(this.network.devices, within);

        if (this.flagValue("format") === "json") {
            console.log(JSON.stringify(report, null, 4));
            return;
        }

        for (const space of report.spaces) {
            console.log(`${space.prefix}, ${space.owner}`);
            for (const segment of space.segments) Cli.printSegment(segment, "  ");
            for (const block of space.blocks) console.log(`  ${block.prefix}  ${block.what}`);

            if (length === undefined) {
                console.log(`  free: ${space.free.join(", ") || "none"}`);
            } else {
                const { prefixes, total } = AddressSpace.freeOfLength(space.free, length, 16);
                const more = total > BigInt(prefixes.length) ? `, and ${total - BigInt(prefixes.length)} more` : "";
                console.log(`  free /${length}: ${prefixes.join(", ") || "none"}${more}`);
            }

            console.log("");
        }

        const { segments, blocks } = report.elsewhere;
        if (segments.length || blocks.length) {
            console.log("Outside the space the network originates");
            for (const segment of segments) Cli.printSegment(segment, "  ");
            for (const block of blocks) console.log(`  ${block.prefix}  ${block.what}`);
        }

        if (!report.spaces.length && !segments.length && !blocks.length) console.log("The config holds no addresses.");
    }

    private rename(): void {
        const [from, to] = this.names;
        if (!from || !to) Cli.fail("usage: circuit rename <device> <new-name> [--file] [--confirm]");

        const device = this.network.devices.find((candidate) => candidate.name === from);
        if (!device) Cli.fail(`no device ${from}; known: ${this.network.devices.map((candidate) => candidate.name).join(", ")}`);
        if (this.network.devices.some((candidate) => candidate.name === to)) Cli.fail(`${to} is already a device`);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(to)) Cli.fail(`${to} is not a hostname: letters, digits, dots, dashes and underscores`);

        const snapshot = this.statePath(device);
        const snapshots = existsSync(snapshot) ? [relative(this.root, snapshot)] : [];

        let plan: RenamePlan;
        try {
            plan = Rename.plan(this.root, from, to, { file: this.flags.includes("--file"), snapshots });
        } catch (error) {
            Cli.fail((error as Error).message);
        }

        for (const change of plan.changes) {
            console.log(`${change.file}:${change.line}`);
            console.log(`  - ${change.before.trim()}`);
            console.log(`  + ${change.after.trim()}`);
        }

        for (const move of plan.moves) console.log(`move ${move.from} to ${move.to}`);

        if (plan.mentions.length) {
            console.log(`\nStill naming ${from}, left as they are: change them by hand if they mean the device.`);
            for (const mention of plan.mentions) console.log(`  ${mention.file}:${mention.line}  ${mention.text.slice(0, 160)}`);
        }

        if (!this.confirmed) {
            console.log("\nNothing written. Re-run with --confirm.");
            return;
        }

        Rename.apply(this.root, plan);
        console.log(`\nRenamed. Run circuit validate, then circuit apply ${to}: the device keeps its old hostname until then.`);
    }

    private async studio(): Promise<void> {
        if (this.flags.includes("--json")) {
            const sources = ProjectFiles.sources(this.root);
            const data = StudioModel.build(this.network.devices, this.annotatedGraph(Topology.LAYERS, []), {
                render: (device) => this.adapterOf(device).render(device),
                snapshot: (device) => (existsSync(this.statePath(device)) ? readFileSync(this.statePath(device), "utf8") : undefined),
                files: (device) => ({
                    // Written with forward slashes on every system, as git and the page take them.
                    source: ProjectFiles.deviceFiles(this.root, device.name, sources)[0]?.split(sep).join("/"),
                    snapshot: existsSync(this.statePath(device))
                        ? relative(this.root, this.statePath(device)).split(sep).join("/")
                        : undefined,
                }),
            });
            console.log(JSON.stringify(data));
            return;
        }

        const port = Number(this.flagValue("port") ?? 4600);
        if (!Number.isInteger(port) || port < 1 || port > 65535) Cli.fail("--port takes a number from 1 to 65535");

        const { StudioServer } = await import("../studio/server");
        const host = this.flagValue("host") ?? "127.0.0.1";
        const allowHosts = (this.flagValue("allow-host") ?? "").split(",").filter(Boolean);

        // Off this machine, Studio must be told the names it is reached by: every other name is refused.
        if (!StudioServer.isLoopback(host) && !allowHosts.length) {
            Cli.fail(`Studio on ${host} needs --allow-host=<name>, the name people reach it by, such as studio.example.com`);
        }

        await StudioServer.start({
            configPath: this.configPath,
            root: this.root,
            port,
            open: !this.flags.includes("--no-open"),
            host,
            allowHosts,
        });
    }
}

await Cli.main(process.argv.slice(2));
