#!/usr/bin/env bun
// The command line. Loads `circuit.config.ts` from the working directory.

import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { adapters } from "../adapters/devices";
import type { ApplyOptions, DeviceAdapter, Plan } from "../adapters/devices/types";
import { registries } from "../adapters/registries";
import { planPeeringDb, sendPeeringDb } from "../adapters/registries/peeringdb";
import { network as prefixOf } from "../core/addr";
import type { Network } from "../core/define";
import { resolve as reveal } from "../core/secrets";
import { validate } from "../core/validate";
import type { Device } from "../schema";

const HELP = `usage: circuit <command> [device...] [options]

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
  peeringdb             bring PeeringDB's exchange records in line with the config, with --confirm`;

const CONFIG_FILE = "circuit.config.ts";

const root = process.cwd();
const configPath = resolve(root, CONFIG_FILE);

if (!existsSync(configPath)) {
    console.error(`no ${CONFIG_FILE} in ${root}`);
    process.exit(1);
}

const network = (await import(configPath)).default as Network;

const [command, ...rest] = process.argv.slice(2);
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
const stateDirectory = join(root, network.state);
const statePath = (device: Device) => join(stateDirectory, device.name + adapterOf(device).extension);

const STATE_README = `# Do not edit

Written by \`circuit snapshot\` and \`circuit apply\`: what each device ran when it was last read, with secrets removed.

An edit here changes nothing on a device and is overwritten on the next read. Change the config instead.
`;

/** Record what a device runs, beside a note that the directory is generated. */
function writeState(device: Device, text: string): void {
    mkdirSync(stateDirectory, { recursive: true });
    writeFileSync(join(stateDirectory, "README.md"), STATE_README);
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
};

const run = commands[command ?? ""];
if (run) await run();
else console.log(HELP);
