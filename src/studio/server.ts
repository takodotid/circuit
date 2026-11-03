// `circuit studio`: the project in the browser, on this machine, or on a server for a team. The page is built by Vite from `app/` and carried inside Circuit (`assets.generated.ts`). What it shows comes from /api/data: gathered by Circuit in a new process, so the project is always read fresh, and gathered again each time a file of the project changes.

import { execFile, spawn } from "node:child_process";
import { watch } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SecretsFile } from "../core/secrets-file";
import { Secrets } from "../core/secrets";
import { Platforms } from "../platforms";
import { Releases } from "../cli/releases";
import { STUDIO_ASSETS } from "./assets.generated";
import { Git } from "./git";
import type { LiveRead, SecretEntry, SecretsFileListing, SecretsListing, StudioData } from "./types";

export type StudioOptions = {
    /** The project's folder. */
    root: string;
    port: number;
    /** The address to listen on: 127.0.0.1 on a machine of one's own, or a server's address. */
    host: string;
    /** Names besides this machine's own that requests may be addressed to, such as `studio.example.com` behind a proxy. */
    allowHosts: string[];
    /** How the project is read: by default, Circuit itself in a new process. Tests give their own. */
    gather?: (folder: string) => Promise<string>;
};

export class StudioServer {
    /** Folders whose changes never change what Studio shows. */
    private static readonly IGNORED = /(^|[\\/])(node_modules|\.git|\.circuit)([\\/]|$)/;

    /** The header the page sends with a request that reaches a device, which a page on another site cannot send without asking first. */
    static readonly REQUEST_HEADER = "x-circuit-studio";

    /** Whether an address to listen on is this machine's own, which nothing else on the network can reach. */
    static isLoopback(host: string): boolean {
        return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
    }

    /** Whether a request's Host header names Studio, so a web page elsewhere cannot read the project through a name it points here. */
    static hostAllowed(header: string | undefined, port: number, allowHosts: readonly string[]): boolean {
        if (!header) return false;
        if (header === `127.0.0.1:${port}` || header === `localhost:${port}` || header === `[::1]:${port}`) return true;

        const name = header.replace(/:\d+$/, "").toLowerCase();
        return allowHosts.some((allowed) => {
            const wanted = allowed.toLowerCase();
            return wanted === header.toLowerCase() || wanted === name;
        });
    }

    /** Circuit itself, to run again: the binary, or Bun with Circuit's sources. */
    private static self(): { command: string; args: string[] } {
        return Releases.binary()
            ? { command: process.execPath, args: [] }
            : { command: process.execPath, args: [...process.execArgv, process.argv[1]!] };
    }

    /** What Studio shows, as JSON, from `circuit studio-data` run as a new process, or what stopped it. A new process reads every file again: one process imports a file once. */
    static gather(folder: string): Promise<string> {
        const { command, args } = StudioServer.self();

        return new Promise((done) => {
            execFile(
                command,
                [...args, "studio-data", folder],
                { maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CIRCUIT_LOCAL: "1" } },
                (error, stdout, stderr) => {
                    if (!error) return done(stdout);
                    done(JSON.stringify({ error: (stderr || error.message).trim() }));
                }
            );
        });
    }

    /** Open the address in the browser. A machine without one only misses the convenience. */
    static openBrowser(url: string): void {
        const [command, args] =
            process.platform === "win32"
                ? ["cmd", ["/c", "start", "", url]]
                : process.platform === "darwin"
                  ? ["open", [url]]
                  : ["xdg-open", [url]];

        const child = spawn(command, args, { stdio: "ignore", detached: true });
        child.on("error", () => {});
        child.unref();
    }

    /** Each secrets file the networks use, as the page may see it: names, how each is kept, ciphertexts. Never a value in plain text, and never the password. */
    static secretsListing(root: string, data: StudioData): SecretsListing {
        const files = [...new Set(data.networks.map((network) => network.secretsFile))];
        return {
            files: files.map((file) =>
                StudioServer.fileListing(
                    root,
                    file,
                    data.networks.filter((network) => network.secretsFile === file)
                )
            ),
        };
    }

    private static fileListing(root: string, name: string, networks: StudioData["networks"]): SecretsFileListing {
        const file = SecretsFile.at(root, name);
        const values = file.values();
        const needed = [...new Set(networks.flatMap((network) => network.secrets))];
        const names = [...new Set([...file.names(), ...needed])].sort();

        const entries = names.map((entry): SecretEntry => {
            const value = values[entry];
            const isNeeded = needed.includes(entry);
            if (value === undefined) return { name: entry, kind: "missing", needed: isNeeded };

            const kind = SecretsFile.kindOf(value);
            if (kind === "encrypted") return { name: entry, kind, ciphertext: value, needed: isNeeded };
            if (kind === "1password") {
                const [vault = "", item = "", ...field] = value.slice("op://".length).split("/");
                return { name: entry, kind, onePassword: { vault, item, field: field.join("/") }, needed: isNeeded };
            }

            return { name: entry, kind, needed: isNeeded };
        });

        const passwordLocation = file.passwordLocation();
        return {
            file: name,
            networks: networks.map((network) => network.name),
            ...(passwordLocation ? { passwordLocation } : {}),
            entries,
        };
    }

    /** Read a device now and plan against what it runs, as `circuit diff` does. Nothing is kept. */
    static async readDevice(root: string, data: StudioData, name: string): Promise<LiveRead> {
        const device = data.devices.find((candidate) => candidate.name === name);
        if (!device) throw new Error(`no device ${name}`);

        const adapter = Platforms.find(device.platform);
        if (!adapter) throw new Error(`no platform ${device.platform}`);

        Secrets.useRoot(root);
        Secrets.useFile(data.networks.find((network) => network.devices.includes(name))?.secretsFile);
        const locked = Secrets.lockedFor(device);
        if (locked)
            throw new Error(
                `${locked.name} is encrypted, and Studio has no password for it. Studio reads a device when the password comes from 1Password or ${SecretsFile.PASSWORD}; or run circuit diff ${name}, which asks for it.`
            );
        const options = { secrets: false, rollback: 10, ...(device.connection.host ? {} : { console: true }) };
        const running = await adapter.read(device, data.devices, options);
        const rendered = adapter.render(device);
        const plan = adapter.plan(rendered, running, options);

        return {
            device: name,
            running,
            rendered,
            steps: plan.steps.map((step) => ({ title: step.title, show: step.show })),
            problems: plan.problems,
            readAt: new Date().toISOString(),
        };
    }

    /** Serve Studio until the process stops, and gather what it shows again whenever a file of the project changes. Resolves with its address once it listens. */
    static async start(options: StudioOptions): Promise<string> {
        const { root, port } = options;
        const gather = options.gather ?? StudioServer.gather;
        const local = StudioServer.isLoopback(options.host);

        let data = await gather(root);

        // Another commit's project is read once: a commit does not change. Each is kept as it is being read, so two asks share one read.
        const past = new Map<string, Promise<string>>();

        const parsed = (): StudioData => {
            const value = JSON.parse(data) as StudioData | { error: string };
            if ("error" in value) throw new Error("the project has errors, so Studio cannot use it");
            return value;
        };

        /** Answer with JSON, or with an error the page shows. */
        const answer = async (response: ServerResponse, work: () => Promise<unknown>) => {
            let body: string;
            try {
                const result = await work();
                body = typeof result === "string" ? result : JSON.stringify(result);
            } catch (error) {
                body = JSON.stringify({ error: (error as Error).message });
            }
            response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(body);
        };

        const listeners = new Set<ServerResponse>();
        const tell = (message: string) => {
            for (const listener of listeners) listener.write(`data: ${message}\n\n`);
        };

        const handle = (request: IncomingMessage, response: ServerResponse) => {
            // Studio shows one team's network: every answer asks search engines to leave it out.
            response.setHeader("x-robots-tag", "noindex, nofollow, noarchive");

            if (!StudioServer.hostAllowed(request.headers.host, port, options.allowHosts)) {
                response.writeHead(403).end();
                return;
            }

            const url = new URL(request.url ?? "/", "http://studio");
            const path = url.pathname;

            if (path === "/api/data") {
                response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(data);
                return;
            }

            // Changes are told as they happen; a proxy such as nginx is asked not to hold them back.
            if (path === "/api/events") {
                response.writeHead(200, {
                    "content-type": "text/event-stream",
                    "cache-control": "no-store",
                    connection: "keep-alive",
                    "x-accel-buffering": "no",
                });
                response.write(": connected\n\n");
                listeners.add(response);
                request.on("close", () => listeners.delete(response));
                return;
            }

            if (path === "/api/secrets") {
                void answer(response, async () => StudioServer.secretsListing(root, parsed()));
                return;
            }

            // The commits that changed a device's file.
            if (path === "/api/history") {
                void answer(response, async () => {
                    const name = url.searchParams.get("device") ?? "";
                    const file = parsed().files[name];
                    if (!file) throw new Error(`no device ${name}`);
                    return Git.history(root, [file]);
                });
                return;
            }

            // What Studio can compare with: branches, tags and the latest commits.
            if (path === "/api/refs") {
                void answer(response, () => Git.references(root));
                return;
            }

            // The project as it was at a branch, tag or commit.
            if (path === "/api/compare") {
                void answer(response, async () => {
                    const asked = url.searchParams.get("ref") ?? "";
                    const commit = await Git.commitOf(root, asked);
                    if (!commit) throw new Error(`${asked} names no commit here`);

                    if (!past.has(commit.commit)) past.set(commit.commit, Git.projectAt(root, commit.commit, gather));
                    const project = await past.get(commit.commit)!;
                    if (project.startsWith('{"error"')) past.delete(commit.commit);

                    return `{"commit":${JSON.stringify(commit)},"network":${project}}`;
                });
                return;
            }

            // Reading a device reaches the device, so it takes a POST with Studio's own header, which a page on another site cannot send unasked.
            if (path === "/api/read") {
                if (request.method !== "POST" || request.headers[StudioServer.REQUEST_HEADER] !== "1") {
                    response.writeHead(403).end();
                    return;
                }
                void answer(response, async () => {
                    if (!local)
                        throw new Error("Studio on a server does not read devices. Run circuit diff, or Studio on your own machine.");
                    return StudioServer.readDevice(root, parsed(), url.searchParams.get("device") ?? "");
                });
                return;
            }

            if (path === "/robots.txt") {
                response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("User-agent: *\nDisallow: /\n");
                return;
            }

            const asset = STUDIO_ASSETS[path === "/" ? "index.html" : path.slice(1)];
            if (!asset) {
                response.writeHead(404).end();
                return;
            }

            const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
            response.writeHead(200, { "content-type": asset.type, "cache-control": cache }).end(Buffer.from(asset.body, "base64"));
        };

        const server = createServer(handle);

        // Several files often change at once, such as on a save or a checkout: the project is read again once they settle.
        let timer: NodeJS.Timeout | undefined;
        const watcher = watch(root, { recursive: true }, (_event, filename) => {
            if (filename && StudioServer.IGNORED.test(filename)) return;

            clearTimeout(timer);
            timer = setTimeout(async () => {
                data = await gather(root);
                tell("changed");
            }, 300);
        });
        server.on("close", () => watcher.close());

        await new Promise<void>((done, fail) => {
            server.once("error", (error: NodeJS.ErrnoException) =>
                fail(new Error(error.code === "EADDRINUSE" ? `port ${port} is in use; choose another with --port` : error.message))
            );
            server.listen(port, options.host, () => done());
        });

        StudioServer.servers.add(server);
        return local ? `http://127.0.0.1:${port}` : `http://${options.allowHosts[0] ?? options.host}:${port}`;
    }

    /** Every server started, so a test can stop them. */
    static readonly servers = new Set<ReturnType<typeof createServer>>();
}
