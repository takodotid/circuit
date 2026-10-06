#!/usr/bin/env node
// The command line. `new` starts a project; every other command loads the network from `circuit.config.ts` in the working directory, or the file `--config` names.

import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { adapters } from "../adapters/devices";
import type { ApplyOptions, DeviceAdapter, Plan } from "../adapters/devices/types";
import { registries } from "../adapters/registries";
import { planLibreNms, sendLibreNms } from "../adapters/registries/librenms";
import { planPeeringDb, sendPeeringDb } from "../adapters/registries/peeringdb";
import { prometheusTargets } from "../adapters/registries/prometheus";
import { network as prefixOf } from "../core/addr";
import type { Network } from "../core/define";
import { isSecret, referenceOf, resolve as reveal, sourceOf, useRoot } from "../core/secrets";
import { validate } from "../core/validate";
import type { Device } from "../schema";

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
  secrets               every secret the config uses, and whether each can be read

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
};

const run = commands[command];
if (run) await run();
else
    fail(`no command ${command}

${HELP}`);
