#!/usr/bin/env node
// The command line. `new` starts a project; every other command loads the network from `circuit.config.ts` in the working directory, or the file `--config` names.

import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { adapters } from "../adapters/devices";
import type { ApplyOptions, DeviceAdapter, Plan } from "../adapters/devices/types";
import { registries } from "../adapters/registries";
import { planLibreNms, sendLibreNms } from "../adapters/registries/librenms";
import { planPeeringDb, sendPeeringDb } from "../adapters/registries/peeringdb";
import { prometheusTargets, snmpExporterAuths } from "../adapters/registries/prometheus";
import { isCidr, network as prefixOf } from "../core/addr";
import { addressesOf, freeOfLength, type Segment } from "../core/addresses";
import type { Network } from "../core/define";
import { type Annotated, type Drift, graphOf, LAYERS, only, type Layer } from "../core/graph";
import { isSecret, referenceOf, resolve as reveal, sourceOf, useRoot } from "../core/secrets";
import { validate } from "../core/validate";
import type { Device } from "../schema";
import { dot, mermaid } from "./graph";
import { applyRename, planRename, type RenamePlan } from "./rename";
import { studioData } from "../studio/data";

const HELP = `usage: circuit <command> [device...] [options]

  new [directory]       start a project from a pattern, asking what it needs
  validate              check the config, then every rule in checks
  build <device>        print the configuration the device should run, without contacting it
  diff [device...]      what apply would send, planned against the last snapshot, offline
  snapshot [device...]  read what each device runs into the state directory
  apply <device>        read the device, plan against what it runs, and send with --confirm
                          --secrets      also send every secret, to rotate one
                          --rollback=N   minutes before a device that can restore itself does, default 10
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
  studio                the graph in the browser, drawn again whenever the config changes
                          --port=4600    the port it listens on, on this machine only
                          --no-open      do not open the browser
                          --json         print what studio shows, as JSON, instead

  --config <path>       the network's config file, circuit.config.ts in the working directory by default`;

const DEFAULT_CONFIG = "circuit.config.ts";

const [command, ...args] = process.argv.slice(2);

if (command === "new") {
    const { create } = await import("./new");
    await create(args);
    process.exit(0);
}

if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
}

// `--config <path>` and `--config=<path>` both name the config file; neither is a device name.
const configAt = args.indexOf("--config");
const configArgument = configAt >= 0 ? args[configAt + 1] : args.find((arg) => arg.startsWith("--config="))?.slice("--config=".length);
const rest = args.filter((arg, index) => index !== configAt && (configAt < 0 || index !== configAt + 1) && !arg.startsWith("--config="));

const configPath = resolve(process.cwd(), configArgument ?? DEFAULT_CONFIG);

if (!existsSync(configPath)) {
    console.error(
        configArgument ? `no config at ${configPath}` : `no ${DEFAULT_CONFIG} in ${process.cwd()}; name another with --config <path>`
    );
    process.exit(1);
}

/** The directory of the config file. `.circuit/`, `.env` and secret files are found from here. */
const root = dirname(configPath);
useRoot(root);

/** The config, a TypeScript file. Bun imports it as it is; Node needs jiti, which also resolves imports written without an extension. */
async function load(path: string): Promise<Network> {
    if (process.versions.bun) return (await import(path)).default;

    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path, { default: true });
}

const network = await load(configPath);

const flags = rest.filter((arg) => arg.startsWith("--"));
const names = rest.filter((arg) => !arg.startsWith("--"));
const confirmed = flags.includes("--confirm");
const options: ApplyOptions = {
    secrets: flags.includes("--secrets"),
    rollback: Number(flags.find((flag) => flag.startsWith("--rollback="))?.split("=")[1] ?? 10),
};

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

/** The devices named on the command line, or every device when none is and `allByDefault`. */
function selected(allByDefault: boolean): Device[] {
    if (!names.length && allByDefault) return [...network.devices];

    const known = network.devices.map((device) => device.name).join(", ");
    const byName = (name: string) => network.devices.find((device) => device.name === name);

    return names.map((name) => byName(name) ?? fail(`no device ${name}; known: ${known}`));
}

function one(): Device {
    const [device] = selected(false);
    return device ?? fail("name a device");
}

const adapterOf = (device: Device): DeviceAdapter => adapters[device.platform] ?? fail(`no adapter for ${device.platform}`);
/** What Circuit writes, beside the config. */
const generated = join(root, ".circuit");
const stateDirectory = join(generated, "state");
const statePath = (device: Device) => join(stateDirectory, device.name + adapterOf(device).extension);

const GENERATED_README = `# Written by Circuit

Do not edit anything here: an edit changes nothing on a device, and Circuit overwrites it. Change the config instead.

\`state/\` holds what each device ran when Circuit last read it, with secrets removed. \`circuit snapshot\` and \`circuit apply\` write it, and \`circuit diff\` plans against it. Commit it, so the history of this directory is the history of the network.
`;

/** Record what a device runs, beside a note that the directory is generated. */
function writeState(device: Device, text: string): void {
    mkdirSync(stateDirectory, { recursive: true });
    writeFileSync(join(generated, "README.md"), GENERATED_README);
    writeFileSync(statePath(device), text);
}

/** Validate, print what was found, and stop on an error about one of these devices. */
function guard(devices: Device[]): void {
    const relevant = new Set(devices.map((device) => device.name));
    const findings = validate(network).filter((finding) => !finding.device || relevant.has(finding.device));

    for (const finding of findings) {
        const where = finding.device ? `${finding.device}: ` : "";
        const level = finding.level === "error" ? "error" : "warn ";
        console.log(`  ${level}  ${where}${finding.message}`);
    }

    const errors = findings.filter((finding) => finding.level === "error").length;
    if (errors) fail(`\n${errors} error(s).`);
}

/** Print a plan. Returns how many commands and problems it holds. */
function show(device: Device, plan: Plan): number {
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

function validateCommand(): void {
    guard([...network.devices]);
    console.log(`${network.devices.length} device(s), no errors.`);
}

function buildCommand(): void {
    const device = one();
    process.stdout.write(adapterOf(device).render(device));
}

function diffCommand(): void {
    const devices = selected(true);
    guard(devices);

    let differences = 0;

    for (const device of devices) {
        const path = statePath(device);
        if (!existsSync(path)) {
            console.log(`${device.name}: no snapshot, run snapshot first`);
            continue;
        }

        const adapter = adapterOf(device);
        const plan = adapter.plan(adapter.render(device), readFileSync(path, "utf8"), options);
        differences += show(device, plan);
    }

    process.exit(differences ? 1 : 0);
}

async function snapshotCommand(): Promise<void> {
    for (const device of selected(true)) {
        const text = await adapterOf(device).read(device, network.devices);
        writeState(device, text);
        console.log(`${device.name}: ${text.split("\n").length} lines`);
    }

    // With every device read, a snapshot of a device the config no longer has, such as one renamed, is removed.
    if (names.length || !existsSync(stateDirectory)) return;

    const current = new Set(network.devices.map((device) => basename(statePath(device))));
    for (const file of readdirSync(stateDirectory)) {
        if (current.has(file)) continue;

        rmSync(join(stateDirectory, file));
        console.log(`${file}: removed, no such device in the config`);
    }
}

async function applyCommand(): Promise<void> {
    const device = one();
    guard([device]);
    const adapter = adapterOf(device);

    // The plan is made against what the device runs now, never against an old snapshot.
    const live = await adapter.read(device, network.devices);
    writeState(device, live);

    const plan = adapter.plan(adapter.render(device), live, options);
    if (!show(device, plan)) return;

    if (plan.problems.length) fail("\nNot sent: resolve the problems first.");

    if (!confirmed) {
        console.log("\nNothing sent. Re-run with --confirm.");
        return;
    }

    await adapter.apply(device, network.devices, plan, options);

    writeState(device, await adapter.read(device, network.devices));
    console.log("snapshot updated");
}

async function refreshCommand(): Promise<void> {
    const device = one();
    const fill = adapterOf(device).fill ?? fail(`${device.platform} cannot hold a fetched prefix set`);

    for (const [name, set] of Object.entries(device.prefix_sets ?? {})) {
        if (!("source" in set)) continue;

        const { registry, query, family } = set.source;
        const prefixes = await registries[registry](query, family);

        // An empty or absurd answer is a broken feed, not a policy.
        if (prefixes.length < 1 || prefixes.length > 100_000) {
            fail(`${name}: ${prefixes.length} prefixes from ${registry}, refusing`);
        }

        console.log(`${name}: ${prefixes.length} prefixes from ${registry} ${query}`);
        if (confirmed) await fill(device, network.devices, name, family, prefixes);
    }

    if (!confirmed) console.log("\nNothing sent. Re-run with --confirm.");
}

/** A WireGuard public key from its private key, so the device's never has to be read off the box. */
function publicKeyOf(privateKey: string): string {
    // The DER prefix of a raw X25519 private key in PKCS#8.
    const pkcs8Prefix = Buffer.from("302e020100300506032b656e04220420", "hex");
    const der = Buffer.concat([pkcs8Prefix, Buffer.from(privateKey, "base64")]);

    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    const publicDer = createPublicKey(key).export({ format: "der", type: "spki" });

    return publicDer.subarray(-32).toString("base64");
}

function wireguardCommand(): void {
    const [deviceName, interfaceName, peerName] = names;
    const device = network.devices.find((candidate) => candidate.name === deviceName) ?? fail(HELP);

    const iface = device.interfaces?.[interfaceName ?? ""];
    if (iface?.type !== "wireguard") fail(`${deviceName} has no WireGuard interface ${interfaceName}`);

    const peers = iface.peers ?? [];
    const peerNames = peers.map((candidate) => candidate.name).join(", ");
    const peer = peers.find((candidate) => candidate.name === peerName) ?? fail(`no peer ${peerName} on ${interfaceName}: ${peerNames}`);

    const tunnelNetworks = (iface.addresses ?? []).map((entry) => prefixOf(typeof entry === "string" ? entry : entry.address));

    const lines = [
        "[Interface]",
        `# ${peerName}'s own private key. It never leaves their machine.`,
        "PrivateKey = <FILL IN>",
        `Address = ${peer.allowed_addresses.join(", ")}`,
        "",
        "[Peer]",
        `PublicKey = ${publicKeyOf(reveal(iface.private_key))}`,
        `Endpoint = ${iface.endpoint ?? "<FILL IN>"}:${iface.listen_port}`,
        `AllowedIPs = ${(peer.client_allowed_addresses ?? tunnelNetworks).join(", ")}`,
        "PersistentKeepalive = 25",
        "",
    ];
    process.stdout.write(lines.join("\n"));
}

function communitiesCommand(): void {
    const communities = network.communities ?? fail("the network declares no communities");

    for (const { community, description } of communities) {
        // The format splits each line at its first comma.
        if (community.includes(",")) fail(`community ${community} holds a comma`);
        console.log(`${community},${description}`);
    }
}

async function peeringdbCommand(): Promise<void> {
    const plan = await planPeeringDb(network);

    for (const name of plan.unknown) {
        console.log(`  PeeringDB lists ${name}, which the config does not. Remove it by hand if the network left.`);
    }

    for (const change of plan.changes) console.log(`  ${change.summary}`);

    if (!plan.changes.length) {
        console.log("PeeringDB matches the config.");
        return;
    }

    if (!confirmed) {
        console.log("\nNothing sent. Re-run with --confirm.");
        return;
    }

    await sendPeeringDb(network, plan.changes);
}

async function librenmsCommand(): Promise<void> {
    const plan = await planLibreNms(network);

    for (const hostname of plan.unknown)
        console.log(`  LibreNMS monitors ${hostname}, which the config does not. Remove it by hand if it is gone.`);
    for (const device of plan.withoutSnmp)
        console.log(`  ${device.name} has no SNMP in its config, so LibreNMS cannot poll it. Add management.snmp first.`);
    for (const device of plan.additions) console.log(`  add ${device.name}, ${device.connection.host}`);

    if (!plan.additions.length) {
        console.log("LibreNMS monitors every device it can.");
        return;
    }

    if (!confirmed) {
        console.log("\nNothing sent. Re-run with --confirm.");
        return;
    }

    await sendLibreNms(network, plan.additions);
}

function prometheusCommand(): void {
    if (flags.includes("--auths")) {
        const { yaml, notes } = snmpExporterAuths(network);
        for (const note of notes) console.error(note);
        process.stdout.write(yaml);
        return;
    }

    const { targets, withoutSnmp } = prometheusTargets(network);
    for (const device of withoutSnmp) console.error(`${device.name} has no SNMP in its config; left out`);
    console.log(JSON.stringify(targets, null, 4));
}

/** Every secret reference in a value, however deep. */
function secretsIn(value: unknown, found = new Set<string>()): Set<string> {
    if (isSecret(value)) found.add(referenceOf(value));
    else if (Array.isArray(value)) for (const item of value) secretsIn(item, found);
    else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) secretsIn(item, found);

    return found;
}

function secretsCommand(): void {
    const references = [...secretsIn([network.devices, network.peeringdb, network.librenms])].sort();
    let missing = 0;

    for (const reference of references) {
        const name = reference.replace(/^file:/, "");

        try {
            reveal(reference);
            console.log(`  ok       ${name}, from ${sourceOf(reference)}`);
        } catch (error) {
            missing++;
            console.log(`  missing  ${name}: ${(error as Error).message}`);
        }
    }

    console.log(`
${references.length} secret(s), ${missing} missing.`);
    process.exit(missing ? 1 : 0);
}

/** The value of `--name=value`, or undefined when it is not given. */
const flagValue = (name: string) => flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);

/** How a device compares with its last snapshot, offline, as `diff` plans it. */
function driftOf(device: Device): Drift {
    const path = statePath(device);
    if (!existsSync(path)) return { status: "no snapshot", lines: [] };

    try {
        const adapter = adapterOf(device);
        const plan = adapter.plan(adapter.render(device), readFileSync(path, "utf8"), options);

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
function annotatedGraph(layers: readonly Layer[], deviceNames: readonly string[]): Annotated {
    const graph = only(graphOf(network.devices), layers, deviceNames);
    const shown = new Set(graph.nodes.map((node) => node.label));

    return {
        ...graph,
        findings: validate(network).filter((finding) => !finding.device || shown.has(finding.device)),
        drift: Object.fromEntries(
            network.devices.filter((device) => shown.has(device.name)).map((device) => [device.name, driftOf(device)])
        ),
    };
}

function graphCommand(): void {
    const requested = (flagValue("layer") ?? "l1").split(",");
    const layers = requested.includes("all") ? [...LAYERS] : (requested as Layer[]);

    const unknown = layers.filter((layer) => !LAYERS.includes(layer));
    if (unknown.length) fail(`no layer ${unknown.join(", ")}; known: ${LAYERS.join(", ")}, all`);

    const format = flagValue("format") ?? "mermaid";
    const devices = selected(true);
    const annotated = annotatedGraph(layers, names.length ? devices.map((device) => device.name) : []);

    if (format === "mermaid") process.stdout.write(mermaid(annotated));
    else if (format === "dot") process.stdout.write(dot(annotated));
    else if (format === "json") console.log(JSON.stringify(annotated, null, 4));
    else fail(`no format ${format}; known: mermaid, dot, json`);
}

/** One segment and what uses each address in it. */
function printSegment(segment: Segment, indent: string): void {
    const next = segment.next ? `, next ${segment.next}` : "";
    console.log(`${indent}${segment.prefix}, ${segment.free} free${next}`);

    const width = Math.max(...segment.uses.map((use) => use.address.length)) + 2;
    for (const use of segment.uses) console.log(`${indent}    ${use.address.padEnd(width)}${use.what}`);
}

function addressesCommand(): void {
    const [within] = names;
    if (within && !isCidr(within)) fail(`${within} is not a prefix, such as 10.0.0.0/16`);

    const lengthText = flagValue("length");
    const length = lengthText === undefined ? undefined : Number(lengthText);
    if (length !== undefined && !(Number.isInteger(length) && length >= 0 && length <= 128))
        fail("--length takes a prefix length, such as 24");

    const report = addressesOf(network.devices, within);

    if (flagValue("format") === "json") {
        console.log(JSON.stringify(report, null, 4));
        return;
    }

    for (const space of report.spaces) {
        console.log(`${space.prefix}, ${space.owner}`);
        for (const segment of space.segments) printSegment(segment, "  ");
        for (const block of space.blocks) console.log(`  ${block.prefix}  ${block.what}`);

        if (length === undefined) {
            console.log(`  free: ${space.free.join(", ") || "none"}`);
        } else {
            const { prefixes, total } = freeOfLength(space.free, length, 16);
            const more = total > BigInt(prefixes.length) ? `, and ${total - BigInt(prefixes.length)} more` : "";
            console.log(`  free /${length}: ${prefixes.join(", ") || "none"}${more}`);
        }

        console.log("");
    }

    const { segments, blocks } = report.elsewhere;
    if (segments.length || blocks.length) {
        console.log("Outside the space the network originates");
        for (const segment of segments) printSegment(segment, "  ");
        for (const block of blocks) console.log(`  ${block.prefix}  ${block.what}`);
    }

    if (!report.spaces.length && !segments.length && !blocks.length) console.log("The config holds no addresses.");
}

function renameCommand(): void {
    const [from, to] = names;
    if (!from || !to) fail("usage: circuit rename <device> <new-name> [--file] [--confirm]");

    const device = network.devices.find((candidate) => candidate.name === from);
    if (!device) fail(`no device ${from}; known: ${network.devices.map((candidate) => candidate.name).join(", ")}`);
    if (network.devices.some((candidate) => candidate.name === to)) fail(`${to} is already a device`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(to)) fail(`${to} is not a hostname: letters, digits, dots, dashes and underscores`);

    const snapshot = statePath(device);
    const snapshots = existsSync(snapshot) ? [relative(root, snapshot)] : [];

    let plan: RenamePlan;
    try {
        plan = planRename(root, from, to, { file: flags.includes("--file"), snapshots });
    } catch (error) {
        fail((error as Error).message);
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

    if (!confirmed) {
        console.log("\nNothing written. Re-run with --confirm.");
        return;
    }

    applyRename(root, plan);
    console.log(`\nRenamed. Run circuit validate, then circuit apply ${to}: the device keeps its old hostname until then.`);
}

async function studioCommand(): Promise<void> {
    if (flags.includes("--json")) {
        const data = studioData(network.devices, annotatedGraph(LAYERS, []), (device) => adapterOf(device).render(device));
        console.log(JSON.stringify(data));
        return;
    }

    const port = Number(flagValue("port") ?? 4600);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail("--port takes a number from 1 to 65535");

    const { studio } = await import("../studio/server");
    await studio({ configPath, root, port, open: !flags.includes("--no-open") });
}

const commands: Record<string, () => void | Promise<void>> = {
    validate: validateCommand,
    build: buildCommand,
    diff: diffCommand,
    snapshot: snapshotCommand,
    apply: applyCommand,
    refresh: refreshCommand,
    wireguard: wireguardCommand,
    communities: communitiesCommand,
    peeringdb: peeringdbCommand,
    librenms: librenmsCommand,
    prometheus: prometheusCommand,
    secrets: secretsCommand,
    rename: renameCommand,
    addresses: addressesCommand,
    graph: graphCommand,
    studio: studioCommand,
};

const run = commands[command];
if (run) await run();
else
    fail(`no command ${command}

${HELP}`);
