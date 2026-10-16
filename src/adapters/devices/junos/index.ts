// Junos, as on the QFX series with its Enhanced Layer 2 Software.
//
// The configuration is read and written as `set` statements, one per line, the form `show configuration | display set` prints. A statement the render does not hold is deleted, at the shortest path that holds nothing the render wants. Changes stage in a candidate and take effect only at `commit`. `commit confirmed` rolls itself back unless confirmed, so access is proved by a fresh login before the commit is confirmed.

import type { Client, ClientChannel } from "ssh2";
import { familyOf, host, isAddress, split } from "../../../core/addr";
import { resolve, substitute } from "../../../core/secrets";
import type { Device, Family } from "../../../schema";
import { type ConsoleDialect, consoleLogin, consoleOf, openConsole } from "../../../transport/console";
import { connect, exec, readUntil, shell } from "../../../transport/ssh";
import { lagIds } from "../derive";
import type { ApplyOptions, DeviceAdapter, Plan, ReadOptions, Step } from "../types";
import { GENERATED, settingsOf } from "./bgp";
import { KEY_STATEMENT, Names, render, stormProfile, vrrpAddress } from "./render";

/** The release this adapter renders for, and was proved on. */
const SUPPORTED_MAJOR = 21;

/** Statements the device keeps for itself: the release it runs and the number it gives each user. */
const DEVICE_FACTS = [/^set version /, /^set system login user \S+ uid \d+$/];

/** Names the platform keeps for its own system accounts. A user under one fails the commit check. */
const SYSTEM_ACCOUNTS = new Set(["bind", "daemon", "kmem", "nobody", "operator", "sshd", "tty", "uucp"]);

/** A statement's words; a quoted value is one word with its quotes. */
export function wordsOf(statement: string): string[] {
    return statement.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
}

/** A word as the platform means it, without quotes or escapes, so a value quoted on one side and not on the other compares equal. */
const bare = (word: string) => (word.startsWith('"') ? word.slice(1, -1).replace(/\\(.)/g, "$1") : word);

/** A value the device keeps hashed or encrypted, and the render writes as a marker, as one word both sides share. Each keeps the number of words. */
const SECRETS: [RegExp, string][] = [
    [/ (?:encrypted-password|plain-text-password-value) (?:"[^"]*"|\S+)/, " password <secret>"],
    [/ (?:authentication-key|authentication-password) (?:"[^"]*"|\S+)/, " authentication-key <secret>"],
    [/ (?:privacy-key|privacy-password) (?:"[^"]*"|\S+)/, " privacy-key <secret>"],
    [/^set snmp community (?:"[^"]*"|\S+)/, "set snmp community <secret>"],
];

/** A statement in the form both sides compare in: its words, secrets as one marker, quotes dropped. */
function keyOf(statement: string): string[] {
    let canonical = statement;
    for (const [pattern, replacement] of SECRETS) canonical = canonical.replace(pattern, replacement);

    return wordsOf(canonical).slice(1).map(bare);
}

/** The device prints a password as a hash, an SNMP key as a reversible cipher, and a community as itself. None leave the read. */
export function scrub(text: string): string {
    return text
        .replace(/ ## SECRET-DATA$/gm, "")
        .replace(/((?:encrypted-password|authentication-key|privacy-key) )(?:"[^"]*"|\S+)/g, "$1<redacted>")
        .replace(/^(set snmp community )(?:"[^"]*"|\S+)/gm, "$1<redacted>")
        .replace(/"\$\d\$[^"]*"/g, "<redacted>");
}

/** The configuration's statements from what `show configuration | display set` printed. */
export function clean(output: string): string {
    const statements = output
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => /^(set|deactivate) /.test(line))
        .filter((line) => !DEVICE_FACTS.some((fact) => fact.test(line)));

    return scrub(statements.join("\n") + "\n");
}

/** Lists whose entries are named: a delete cannot stop at the list, `delete interfaces xe-0/0/1 unit`, only at an entry, `unit 0`. A leaf-list such as `vlan members` or `ciphers` can go whole. */
const NAMED_LISTS = new Set([
    "address",
    "area",
    "as-path",
    "class",
    "collector",
    "community",
    "family",
    "file",
    "filter",
    "group",
    "host",
    "interface",
    "interfaces",
    "neighbor",
    "oid",
    "policer",
    "policy-statement",
    "pool",
    "prefix",
    "prefix-list",
    "qualified-next-hop",
    "range",
    "rib",
    "route",
    "security-level",
    "security-model",
    "security-name",
    "server",
    "server-group",
    "session",
    "storm-control-profiles",
    "term",
    "trap-group",
    "unit",
    "user",
    "view",
    "vlan",
    "vrrp-group",
]);

/** Whether a delete may stop after `path[index]`. Below the top level a named list may not; `vlan` names a list except in `vlan members`. */
function canStopAt(path: string[], index: number): boolean {
    if (index === 0 || !NAMED_LISTS.has(path[index]!)) return true;

    return path[index] === "vlan" && path[index + 1] === "members";
}

/** The section a statement belongs to, for a reviewer: `interfaces xe-0/0/1`, `system login`, `snmp`. */
const sectionOf = (path: string[]) => path.slice(0, 2).join(" ");

/**
 * The ordered block a statement sits in, and its item there: a policy's or a filter's term, or one policy of an import or export chain. The device keeps their order, and `set` adds at the end.
 */
function orderedBlockOf(path: string[]): { block: string[]; item: string } | undefined {
    if (path[0] === "policy-options" && path[1] === "policy-statement" && path[3] === "term") {
        return { block: path.slice(0, 3), item: path[4]! };
    }

    if (path[0] === "firewall" && path[1] === "family" && path[3] === "filter" && path[5] === "term") {
        return { block: path.slice(0, 5), item: path[6]! };
    }

    const chain = path.length - 2;
    if (path[0] === "protocols" && (path[chain] === "import" || path[chain] === "export")) {
        return { block: path.slice(0, chain + 1), item: path[chain + 1]! };
    }

    return undefined;
}

/** Whether a path starts with another. */
const startsWith = (path: string[], prefix: string[]) => prefix.every((word, index) => path[index] === word);

/**
 * What changes, by section.
 *
 * A statement the render holds and the device does not is set. One the device holds and the render does not is deleted at the shortest path that holds nothing the render wants, so a removed port goes as a whole and a changed value goes alone. A hidden value ends a path by its name alone; a hidden name in a list, such as a community, stays `<redacted>` and the session names each entry when it sends the plan. A statement the device holds deactivated is activated when the render wants it.
 *
 * A policy, a filter or an import or export chain is ordered, so when anything in one changes it is deleted and set again whole, in the render's order. A path the render marks as generated, such as a prefix list `refresh` fills, keeps what the device holds.
 */
export function plan(desired: string, current: string, options: Pick<ApplyOptions, "secrets">): Plan {
    const lines = (text: string, verb: string) => text.split("\n").filter((line) => line.startsWith(`${verb} `));

    const wanted = lines(desired, "set");
    const deactivated = lines(current, "deactivate");
    const generated = desired
        .split("\n")
        .filter((line) => line.startsWith(GENERATED))
        .map((line) => wordsOf(line.slice(GENERATED.length)).map(bare));

    const printed = lines(current, "set").filter((line) => !DEVICE_FACTS.some((fact) => fact.test(line)));
    const isGenerated = (line: string) => generated.some((path) => keyOf(line).length > path.length && startsWith(keyOf(line), path));
    const existing = printed.filter((line) => !isGenerated(line));

    const join = (path: string[]) => path.join("\u0000");
    const wantedPaths = wanted.map(keyOf);
    const wantedKeys = new Set(wantedPaths.map(join));
    const existingKeys = new Set(existing.map((line) => join(keyOf(line))));

    const wantedUnder = (path: string[]) => wantedPaths.filter((other) => startsWith(other, path));

    const sections = new Map<string, { show: string[]; activate: string[]; remove: string[]; add: string[] }>();
    const sectionFor = (path: string[]) => {
        const name = sectionOf(path);
        if (!sections.has(name)) sections.set(name, { show: [], activate: [], remove: [], add: [] });
        return sections.get(name)!;
    };

    // Sections in the order the render lists them, then the ones only the device has.
    for (const path of wantedPaths) sectionFor(path);

    // Ordered blocks the render holds whose items or order differ from the device's are rewritten whole.
    const rewritten: string[][] = [];
    const blocks = new Map<string, string[]>();
    for (const path of wantedPaths) {
        const ordered = orderedBlockOf(path);
        if (ordered) blocks.set(join(ordered.block), ordered.block);
    }

    for (const block of blocks.values()) {
        const inBlock = (line: string) => startsWith(keyOf(line), block);
        const order = (all: string[]) => [...new Set(all.filter(inBlock).map((line) => orderedBlockOf(keyOf(line))!.item))];
        const keys = (all: string[]) =>
            all
                .filter(inBlock)
                .map((line) => join(keyOf(line)))
                .sort()
                .join("\n");

        const wantedHere = wanted.filter(inBlock);
        const existingHere = existing.filter(inBlock);
        if (join(order(wanted)) === join(order(existing)) && keys(wanted) === keys(existing)) continue;

        rewritten.push(block);
        const section = sectionFor(block);

        if (existingHere.length)
            section.remove.push(
                `delete ${wordsOf(existingHere[0]!)
                    .slice(1, 1 + block.length)
                    .join(" ")}`
            );
        section.show.push(...existingHere.map((line) => `- ${line}`), ...wantedHere.map((line) => `+ ${line}`));
        section.add.push(...wantedHere);
    }

    const isRewritten = (line: string) => rewritten.some((block) => startsWith(keyOf(line), block));

    const removed: string[][] = [];

    for (const line of existing) {
        if (isRewritten(line)) continue;

        const path = keyOf(line);
        if (wantedKeys.has(join(path))) continue;
        // The render extends this statement, so setting the longer one replaces it.
        if (wantedUnder(path).length) continue;

        let length = 1;
        while (wantedUnder(path.slice(0, length)).length) length++;
        while (length < path.length && !canStopAt(path, length - 1)) length++;

        const hidden = path.indexOf("<secret>");
        if (hidden >= 0 && hidden < length && !NAMED_LISTS.has(path[hidden - 1]!)) length = hidden;

        removed.push(wordsOf(line).slice(1, 1 + length));
    }

    // A path inside another removed path goes with it.
    const isInside = (path: string[], other: string[]) =>
        other.length < path.length && other.every((word, index) => bare(path[index]!) === bare(word));
    const removals = removed.filter(
        (path, index) =>
            !removed.some((other) => isInside(path, other)) && removed.findIndex((other) => join(other) === join(path)) === index
    );

    const isRemoved = (line: string) => removals.some((path) => startsWith(keyOf(line), path.map(bare)));

    for (const path of removals) {
        const section = sectionFor(path.map(bare));
        section.remove.push(`delete ${path.join(" ")}`);

        const under = existing.filter((line) => startsWith(keyOf(line), path.map(bare)));
        section.show.push(...under.map((line) => `- ${line}`));
    }

    for (const line of deactivated) {
        const path = wordsOf(line).slice(1);
        if (!wantedUnder(path.map(bare)).length) continue;

        const section = sectionFor(path.map(bare));
        section.activate.push(`activate ${path.join(" ")}`);
        section.show.push(`+ activate ${path.join(" ")}`);
    }

    // A statement the device extends with one it keeps is there already: the device prints only the longest.
    const extended = (path: string[]) => printed.some((line) => !isRemoved(line) && startsWith(keyOf(line), path));

    for (const line of wanted) {
        if (isRewritten(line)) continue;

        const path = keyOf(line);
        const isNew = !existingKeys.has(join(path)) && !extended(path);
        const rotated = options.secrets && line.includes("<secret:");
        if (!isNew && !rotated) continue;

        const section = sectionFor(path);
        section.add.push(line);
        section.show.push(`+ ${line}`);

        // A community is named by its value, so a new value is a second community. The device's go first.
        const clear = "delete snmp community <redacted>";
        if (rotated && line.startsWith("set snmp community ") && !section.remove.includes(clear)) section.remove.push(clear);
    }

    const steps: Step[] = [...sections]
        .filter(([, section]) => section.show.length)
        .map(([title, section]) => ({ title, show: section.show, send: [...section.activate, ...section.remove, ...section.add] }));

    return { steps, problems: [] };
}

export async function login(device: Device): Promise<Client> {
    const user = device.users?.[device.connection.user];
    if (!user) throw new Error(`${device.name}: connection user ${device.connection.user} is not one of its users`);

    return connect({
        host: device.connection.host,
        port: device.connection.port,
        user: device.connection.user,
        password: resolve(user.password),
    });
}

/** Refuse a device on a release this adapter was not proved on, before anything is read or sent. */
async function checkVersion(ask: (command: string) => Promise<string>, device: Device): Promise<void> {
    const version = await ask("show version | match Junos:");
    const release = /Junos: (\d+)\.(\S+)/.exec(version);

    if (!release) throw new Error(`${device.name} did not say which Junos it runs: ${version.slice(0, 200)}`);
    if (Number(release[1]) !== SUPPORTED_MAJOR) {
        throw new Error(`${device.name} runs Junos ${release[1]}.${release[2]}; this adapter renders for Junos ${SUPPORTED_MAJOR}`);
    }
}

export async function read(device: Device, _network: readonly Device[] = [], options: ReadOptions = {}): Promise<string> {
    if (options.console) {
        return onConsole(device, async (channel) => {
            await checkVersion((command) => run(channel, command), device);
            const output = await run(channel, "show configuration | display set | no-more", 180_000);
            if (!/^set /m.test(output)) throw new Error(`${device.name} returned no configuration`);

            return clean(output);
        });
    }

    const client = await login(device);

    try {
        await checkVersion((command) => exec(client, command), device);
        const output = await exec(client, "show configuration | display set | no-more", 180_000);
        if (!/^set /m.test(output)) throw new Error(`${device.name} returned no configuration`);

        return clean(output);
    } finally {
        client.end();
    }
}

/** A prompt at the end of what the device printed: `user@host> `, `user@host# `, or a shell's `% `. */
const PROMPT = /[>#%] $/;

/** Send one line and wait for the prompt to come back. */
async function run(channel: ClientChannel, line: string, timeout = 60_000): Promise<string> {
    channel.write(`${line}\n`);
    const output = await readUntil(channel, (text) => PROMPT.test(text.replace(/\r/g, "")), timeout, 300);
    return output.replace(/\r/g, "");
}

/** The prompt in configuration mode, under its `[edit]` line. An echoed statement cannot end with it. */
const EDIT_PROMPT = /\[edit[^\]\n]*\]\n[^\n]*# $/;

/** Send one line in configuration mode and wait for its prompt to come back. */
async function edit(channel: ClientChannel, line: string, timeout = 60_000): Promise<string> {
    channel.write(`${line}\n`);
    const output = await readUntil(channel, (text) => EDIT_PROMPT.test(text.replace(/\r/g, "")), timeout, 300);
    return output.replace(/\r/g, "");
}

/** How the console asks for a login. Root lands in a shell, `%`, every other user in the CLI, `>`; a session left in configuration mode, `#`, leaves it first. Not yet proved on a device. */
export const JUNOS_CONSOLE: ConsoleDialect = {
    login: /login: $/,
    password: /Password:\s*$/,
    prompt: /[>%] $/,
    logout: "exit",
    others: [[/# $/, "exit configuration-mode\n"]],
};

/** Log in on the console, open the CLI, and run `work` in it with a way to log in afresh. Logs out after. */
async function onConsole<T>(device: Device, work: (channel: ClientChannel, relogin: () => Promise<void>) => Promise<T>): Promise<T> {
    const { console, user, password } = consoleOf(device);
    const opened = await openConsole(console);

    // The CLI is opened on a prompt asked for after the login, since the login's own prompt is already read.
    const login = async () => {
        await consoleLogin(opened.channel, JUNOS_CONSOLE, user, password);
        const ready = openCli(opened.channel);
        opened.channel.write("\n");
        await ready;
    };

    try {
        await login();
        const result = await work(opened.channel, login);
        opened.channel.write(`${JUNOS_CONSOLE.logout}\n`);
        return result;
    } finally {
        opened.close();
    }
}

/** An interactive CLI with paging off. Root lands in a shell and starts the CLI from there. */
export async function openCli(channel: ClientChannel): Promise<void> {
    const banner = await readUntil(channel, (text) => PROMPT.test(text.replace(/\r/g, "")), 20_000, 500);
    if (/% $/.test(banner.replace(/\r/g, ""))) await run(channel, "cli");

    await run(channel, "set cli screen-length 0");
    await run(channel, "set cli screen-width 0");
    await run(channel, "set cli complete-on-space off");
}

/**
 * A delete through a name the read redacted, `delete snmp community <redacted>`, as one delete for each entry the device holds there. The names stay in the session.
 */
async function named(channel: ClientChannel, line: string): Promise<string[]> {
    const words = wordsOf(line).slice(1);
    const at = words.indexOf("<redacted>");
    if (at < 0) return [line];

    // `show` cannot stop at a list either, so the list's parent is shown and its entries picked out.
    const shown = await edit(channel, `show ${words.slice(0, at - 1).join(" ")} | display set`);
    const inList = (statement: string[]) =>
        statement[0] === "set" && words.slice(0, at).every((word, index) => statement[index + 1] === word);
    const names = new Set(
        shown
            .split("\n")
            .map(wordsOf)
            .filter(inList)
            .map((statement) => statement[at + 1]!)
    );

    return [...names].map((name) => `delete ${[...words.slice(0, at), name, ...words.slice(at + 1)].join(" ")}`);
}

/** What the device says when it refuses a statement in a load: `terminal:3:(14) syntax error: ...`. A warning, such as a statement not found, is not a refusal. */
const REFUSED = /^terminal:\d+:\(\d+\) (?!warning)|^error: /m;

/** How a commit that could cut access is guarded: it rolls back after `minutes` unless `prove` shows access survived. */
export type Guard = { minutes: number; prove: () => Promise<void> };

/**
 * Load the plan into an exclusive candidate and check it. With a guard, commit it to roll back after `minutes`, prove access, then confirm; without one, commit it outright.
 *
 * Deletions go before the statements that are set, so a path deleted and set again in one plan ends up set.
 */
export async function configure(channel: ClientChannel, plan: Plan, guard?: Guard): Promise<void> {
    const sent = plan.steps.flatMap((step) => step.send);

    const entered = await run(channel, "configure exclusive");
    if (!/Entering configuration mode/.test(entered) || /^error: /m.test(entered)) {
        throw new Error(`the candidate could not be locked: ${entered.trim().slice(0, 300)}`);
    }

    const deletions: string[] = [];
    for (const line of sent.filter((line) => line.startsWith("delete "))) deletions.push(...(await named(channel, line)));

    const ordered = [
        ...sent.filter((line) => line.startsWith("activate ")),
        ...deletions,
        ...sent.filter((line) => line.startsWith("set ")),
    ];

    const discard = async (reason: string) => {
        await edit(channel, "rollback 0").catch(() => undefined);
        await run(channel, "exit configuration-mode").catch(() => undefined);
        return new Error(reason);
    };

    channel.write("load set terminal\n");
    await readUntil(channel, (text) => text.includes("[Type ^D at a new line to end input]"), 20_000, 300);

    for (const line of ordered) channel.write(`${substitute(line)}\n`);

    const loaded = await edit(channel, "\u0004", 300_000);
    const refused = loaded.split("\n").filter((line) => REFUSED.test(line));
    if (refused.length) throw await discard(`the device refused the plan, nothing was applied:\n    ${refused.join("\n    ")}`);

    const checked = await edit(channel, "commit check", 600_000);
    if (!/configuration check succeeds/.test(checked)) {
        throw await discard(`commit check failed, nothing was applied:\n    ${checked.trim().split("\n").slice(1, 20).join("\n    ")}`);
    }

    if (!guard) {
        const committed = await edit(channel, "commit comment circuit", 600_000);
        if (!/commit complete/.test(committed))
            throw await discard(`commit failed, nothing was applied:
    ${committed.trim().slice(0, 300)}`);

        await run(channel, "exit configuration-mode");
        return;
    }

    const { minutes, prove } = guard;
    const committed = await edit(channel, `commit confirmed ${minutes} comment circuit`, 600_000);
    if (!/commit complete/.test(committed)) {
        throw await discard(`commit failed, nothing was applied:\n    ${committed.trim().split("\n").slice(1, 20).join("\n    ")}`);
    }

    console.log(`  committed; it rolls back in ${minutes} minutes unless access is proved`);

    try {
        await prove();
    } catch (error) {
        // The session still open restores the previous configuration at once; if it cannot, the device does when the time runs out.
        await edit(channel, "rollback 1", 60_000).catch(() => undefined);
        await edit(channel, "commit comment circuit-restore", 600_000).catch(() => undefined);
        await run(channel, "exit configuration-mode").catch(() => undefined);
        throw new Error(
            `a fresh login failed (${(error as Error).message}); the previous configuration is restored, at the latest in ${minutes} minutes`
        );
    }

    const confirmed = await edit(channel, "commit comment circuit-confirmed", 600_000);
    if (!/commit complete/.test(confirmed)) {
        throw new Error(
            `access was proved but the confirmation failed; the device rolls back in ${minutes} minutes:\n    ${confirmed.trim().slice(0, 300)}`
        );
    }

    await run(channel, "exit configuration-mode");
    console.log("  logged in again, commit confirmed");
}

export async function apply(device: Device, _network: readonly Device[], plan: Plan, options: ApplyOptions): Promise<void> {
    if (options.console) {
        await onConsole(device, async (channel, relogin) => {
            await checkVersion((command) => run(channel, command), device);

            // A fresh login on the console ends the session that holds the candidate, so the proof logs in again and takes the candidate back to confirm the commit.
            await configure(channel, plan, {
                minutes: options.rollback,
                prove: async () => {
                    await run(channel, "exit configuration-mode");
                    await relogin();
                    await run(channel, "configure exclusive");
                },
            });
        });
        return;
    }

    const client = await login(device);

    try {
        await checkVersion((command) => exec(client, command), device);

        const channel = await shell(client);
        await openCli(channel);

        await configure(channel, plan, {
            minutes: options.rollback,
            prove: async () => {
                const proof = await login(device);
                proof.end();
            },
        });

        channel.end();
    } finally {
        client.end();
    }
}

export function unsupported(device: Device): string[] {
    const found: string[] = [];
    const names = new Names(device);
    const users = device.users ?? {};

    const root = (users as Record<string, (typeof users)[keyof typeof users]>).root;
    if (!root) found.push("users without root, the platform needs a root password");
    if (root && root.role !== "admin") found.push("users.root.role, root is always admin");
    if (root?.description) found.push("users.root.description");
    if (device.connection.user === "root") found.push("connection.user root, which logs in to a shell rather than the CLI");

    for (const [name, user] of Object.entries(users)) {
        if (SYSTEM_ACCOUNTS.has(name)) found.push(`users.${name}, a name the platform keeps for a system account`);

        for (const key of user.ssh_keys ?? []) {
            const kind = key.split(" ")[0]!;
            if (!KEY_STATEMENT[kind]) found.push(`users.${name}.ssh_keys, a key of type ${kind}`);
        }
    }

    const management = device.management ?? {};

    for (const field of ["https", "api_tls", "privilege_password"] as const) {
        if (management[field]) found.push(`management.${field}`);
    }

    if (management.console) found.push("management.console, the console uses the device's users");
    if (management.native?.interfaces?.length) found.push("management.native.interfaces, NETCONF runs over IP only");
    if (management.ssh?.auth_timeout || management.ssh?.auth_retries) found.push("management.ssh.auth_timeout and auth_retries");

    for (const service of ["telnet", "ftp", "snmp"] as const) {
        if (management[service]?.port) found.push(`management.${service}.port`);
    }

    const system = device.system ?? {};

    if (system.release_channel) found.push("system.release_channel");
    if (system.transceiver_monitoring !== undefined) found.push("system.transceiver_monitoring, it is always on");
    if (system.dns?.serve) found.push("system.dns.serve");
    if (system.ip?.syn_cookies) found.push("system.ip.syn_cookies");
    if (system.logging?.local?.lines_per_file !== undefined) found.push("system.logging.local.lines_per_file, files rotate by size");

    // Time is answered only to its servers, which the filter names by address.
    if (system.ntp && !system.ntp.serve && system.ntp.servers.some((server) => !isAddress(server))) {
        found.push("system.ntp.servers by name while not serving, the filter keeping others out needs addresses");
    }

    for (const [name, port] of Object.entries(device.ports ?? {})) {
        if (!port) continue;

        const physical = names.port(name);

        if (physical.startsWith("em")) {
            for (const field of [
                "access_vlan",
                "trunk_vlans",
                "native_vlan",
                "lag",
                "stp",
                "storm_control",
                "speed",
                "vrrp",
                "vrf",
                "mtu",
                "acl",
                "ipv6_ra",
            ] as const) {
                if (port[field] !== undefined) found.push(`ports.${name}.${field}, a management port only routes`);
            }
        }

        if (port.speed && !(port.speed === "1g" && physical.startsWith("ge-")))
            found.push(`ports.${name}.speed ${port.speed}, only a 1G optic in a 10G cage`);

        if (port.hardware_offload !== undefined) found.push(`ports.${name}.hardware_offload`);

        // A port filter cannot match the VLAN a frame is switched in: `learn-vlan-id` is refused on an ingress port.
        const acl = port.acl ? device.acls?.[port.acl] : undefined;
        if (acl?.some((rule) => rule.match?.vlan)) found.push(`acls.${port.acl} matching a VLAN, on port ${name}`);

        found.push(...routedGaps(`ports.${name}`, port));
        found.push(...switchedGaps(`ports.${name}`, port, device));
    }

    const loopbackTables = new Set<string>();

    for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
        if (iface.type === "vxlan" || iface.type === "wireguard") {
            found.push(`interfaces.${name}, a ${iface.type}`);
            continue;
        }

        if (iface.hardware_offload !== undefined) found.push(`interfaces.${name}.hardware_offload`);
        if (iface.type === "loopback" && iface.ipv6_ra) found.push(`interfaces.${name}.ipv6_ra, on a loopback`);
        if (iface.type === "loopback" && iface.mtu !== undefined) found.push(`interfaces.${name}.mtu, on a loopback`);
        if (iface.type === "gre" && iface.vrrp?.length) found.push(`interfaces.${name}.vrrp, on a tunnel`);

        // A VLAN interface sends no larger packets than the ports carrying its VLAN take; the device warns and carries on.
        if (iface.type === "vlan" && iface.mtu !== undefined) {
            const smallest = Math.min(...carriers(device, iface.vlan));
            if (iface.mtu > smallest) found.push(`interfaces.${name}.mtu ${iface.mtu}, above the ${smallest} its VLAN's ports carry`);
        }

        found.push(...routedGaps(`interfaces.${name}`, iface));

        if (iface.type === "lag") found.push(...switchedGaps(`interfaces.${name}`, iface, device));

        if (iface.type === "loopback") {
            const table = iface.vrf ?? "";
            if (loopbackTables.has(table)) found.push(`interfaces.${name}, a second loopback in one routing table`);
            loopbackTables.add(table);
            if (iface.vrrp?.length) found.push(`interfaces.${name}.vrrp, on a loopback`);
        }
    }

    const ids = [...lagIds(device).values()];
    if (ids.length !== new Set(ids).size) found.push("interfaces, two LAGs with one number");

    if (device.stp?.priority !== undefined && device.stp.priority % 4096 !== 0) found.push("stp.priority, in steps of 4096");

    const routing = device.routing;
    found.push(...bgpGaps(device));

    const tables = new Map<string, number>();

    for (const route of routing?.static ?? []) {
        if (route.description) found.push(`routing.static ${route.prefix} description`);

        const table = `${route.vrf ?? ""} ${split(route.prefix).addr}/${split(route.prefix).len}`;
        tables.set(table, (tables.get(table) ?? 0) + 1);
    }

    for (const route of routing?.static ?? []) {
        const table = `${route.vrf ?? ""} ${split(route.prefix).addr}/${split(route.prefix).len}`;
        if (route.blackhole && tables.get(table)! > 1)
            found.push(`routing.static ${route.prefix}, a blackhole beside another route to the same prefix`);
    }

    for (const area of Object.values(routing?.ospf?.areas ?? {})) {
        for (const iface of Object.keys(area.interfaces)) {
            const settings = device.interfaces?.[iface] ?? device.ports?.[iface as keyof typeof device.ports];
            if (settings?.vrf) found.push(`routing.ospf on ${iface}, which routes in a VRF`);
        }
    }

    for (const field of ["firewall", "hardware_offload", "certificates"] as const) {
        if (device[field] !== undefined) found.push(field);
    }

    const relayed = new Set(Object.values(device.dhcp_relay ?? {}).map((relay) => relay.interface));

    for (const [name, server] of Object.entries(device.dhcp ?? {})) {
        // The device refuses a relay and a server on one interface: `Interface irb.10 already configured`.
        if (relayed.has(server.interface)) found.push(`dhcp.${name}.interface, which a DHCP relay also uses`);

        const settings = device.interfaces?.[server.interface] ?? device.ports?.[server.interface as keyof typeof device.ports];
        if (settings?.vrf) found.push(`dhcp.${name}.interface, which routes in a VRF`);
        if (familyOf(host(server.network)) === "ipv6") found.push(`dhcp.${name}.network, IPv6`);
    }

    for (const [name, relay] of Object.entries(device.dhcp_relay ?? {})) {
        if (relay.servers.some((server) => familyOf(server) === "ipv6")) found.push(`dhcp_relay.${name}.servers, IPv6`);
    }

    const flow = device.flow_export;
    if (flow && flow.protocol !== "sflow") found.push(`flow_export.protocol ${flow.protocol}, the platform exports sFlow`);
    if (flow?.protocol === "sflow" && flow.sampling === undefined) found.push("flow_export.sampling, the platform samples");

    for (const name of flow?.interfaces ?? []) {
        if (names.members(name).some((port) => port.startsWith("em"))) found.push(`flow_export.interfaces ${name}, a management port`);
    }

    return found;
}

/** The IP MTU of every port and LAG that carries a VLAN; 1500 where none is given. */
function carriers(device: Device, vlan: string): number[] {
    const sizes = [1500];
    const carrying = [...Object.values(device.ports ?? {}), ...Object.values(device.interfaces ?? {})];

    for (const settings of carrying) {
        if (!settings || !("access_vlan" in settings || "trunk_vlans" in settings)) continue;

        const members = [settings.access_vlan, settings.native_vlan, ...(settings.trunk_vlans ?? [])];
        if (members.includes(vlan)) sizes.push(settings.mtu ?? 1500);
    }

    return sizes.length > 1 ? sizes.slice(1) : sizes;
}

/** BGP settings Junos 21 has no statement for, and policy steps it cannot take. */
function bgpGaps(device: Device): string[] {
    const found: string[] = [];
    const bgp = device.routing?.bgp;

    for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
        const settings = settingsOf(device, neighbor);
        if (settings.role) found.push(`routing.bgp.neighbors.${name}.role, Junos 21 has no BGP roles`);
        // IPv4 routes over an IPv6 session need a local IPv4 address the config has no field for.
        if (familyOf(neighbor.address) === "ipv6" && settings.families?.includes("ipv4")) {
            found.push(`routing.bgp.neighbors.${name}.families ipv4 over an IPv6 session`);
        }

        if (settings.keepalive !== undefined)
            found.push(`routing.bgp.neighbors.${name}.keepalive, the platform keeps it at a third of hold_time`);
    }

    for (const server of device.routing?.rpki ?? []) {
        if (server.description) found.push(`routing.rpki ${server.address} description`);
    }

    for (const [name, rules] of Object.entries(device.policies ?? {})) {
        rules.forEach((rule, index) => {
            const where = `policies.${name}[${index}]`;
            if (rule.set?.preferred_source) found.push(`${where}.set.preferred_source`);
            if (rule.match?.prefix && rule.match.prefix_length) found.push(`${where}.match.prefix with prefix_length`);
        });
    }

    return found;
}

/** Layer 3 settings the platform cannot express on a port or an interface. */
function routedGaps(
    where: string,
    settings: { addresses?: readonly (string | { address: string; peer: string })[]; vrrp?: readonly { id: number; address: string }[] }
): string[] {
    const found: string[] = [];
    const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

    if (settings.addresses?.some((entry) => typeof entry !== "string")) found.push(`${where}.addresses with a peer`);

    for (const group of settings.vrrp ?? []) {
        if (familyOf(group.address) === "ipv6") found.push(`${where}.vrrp ${group.id}, IPv6`);
        else if (!vrrpAddress(addresses, group))
            found.push(`${where}.vrrp ${group.id}, no address of the interface holds ${group.address}`);
    }

    return found;
}

/** Storm control in a form a profile holds: one threshold in percent for every kind. */
function switchedGaps(where: string, settings: Parameters<typeof stormProfile>[0], device: Device): string[] {
    const found: string[] = [];
    const storm = Object.values(settings.storm_control ?? {});

    if (storm.some((threshold) => "pps" in threshold)) found.push(`${where}.storm_control in pps, the platform takes percent`);
    else if (new Set(storm.map((threshold) => ("percent" in threshold ? threshold.percent : 0))).size > 1) {
        found.push(`${where}.storm_control, one threshold for every kind`);
    }

    if (typeof settings.stp === "object" && !device.stp) found.push(`${where}.stp while spanning tree is off on the device`);

    return found;
}

/** The plan that replaces a prefix list's entries with what a registry returned. */
export function fillPlan(set: string, prefixes: string[]): Plan {
    const list = `policy-options prefix-list ${set}`;
    const send = [`delete ${list}`, `set ${list}`, ...prefixes.map((prefix) => `set ${list} ${prefix}`)];
    return { steps: [{ title: list, show: [], send }], problems: [] };
}

/** Replace a prefix list `refresh` fetched. It cannot cut access, so it is committed without a rollback. */
export async function fill(device: Device, _network: readonly Device[], set: string, _family: Family, prefixes: string[]): Promise<void> {
    const client = await login(device);

    try {
        await checkVersion((command) => exec(client, command), device);

        const channel = await shell(client);
        await openCli(channel);
        await configure(channel, fillPlan(set, prefixes));
        channel.end();

        console.log(`  ${set}: ${prefixes.length} prefixes on the device`);
    } finally {
        client.end();
    }
}

export const junos: DeviceAdapter = {
    extension: ".conf",
    console: true,
    unsupported,
    render,
    read,
    plan,
    apply,
    fill,
};
