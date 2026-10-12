// `circuit studio`: the network in the browser, on this machine or on a server for a team. The page is the files in public/, served as they are. What it shows comes from /data: gathered by `circuit studio --json` in a new process, so the config is always read fresh, and gathered again each time a file beside the config changes.

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { packageRoot, type StudioData } from "./data";
import { commitOf, history, networkAt, references } from "./git";

export type StudioOptions = {
    /** The config file. */
    configPath: string;
    /** The directory watched for changes: the config's own. */
    root: string;
    port: number;
    /** Open the browser once the server listens. */
    open: boolean;
    /** The address to listen on: 127.0.0.1 on a machine of one's own, or a server's address. */
    host: string;
    /** Names besides this machine's own that requests may be addressed to, such as `studio.example.com` behind a proxy. */
    allowHosts: string[];
};

/** Whether an address to listen on is this machine's own, which nothing else on the network can reach. */
export const isLoopback = (host: string) => host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);

/**
 * Whether a request's Host header names Studio, so a web page elsewhere cannot read the network through a name it points here.
 *
 * Studio answers to this machine's own names at its port, and to each name it was told to, with or without a port.
 */
export function hostAllowed(header: string | undefined, port: number, allowHosts: readonly string[]): boolean {
    if (!header) return false;
    if (header === `127.0.0.1:${port}` || header === `localhost:${port}` || header === `[::1]:${port}`) return true;

    const name = header.replace(/:\d+$/, "").toLowerCase();
    return allowHosts.some((allowed) => {
        const wanted = allowed.toLowerCase();
        return wanted === header.toLowerCase() || wanted === name;
    });
}

/** Directories whose changes never change what Studio shows. */
const IGNORED = /(^|[\\/])(node_modules|\.git|\.circuit[\\/]cache)([\\/]|$)/;

const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
};

/** What Studio shows, as JSON, from `circuit studio --json` run as a new process, or what stopped it. */
function gather(configPath: string): Promise<string> {
    const cli = process.argv[1]!;
    const args = [...process.execArgv, cli, "studio", "--json", `--config=${configPath}`];

    return new Promise((done) => {
        execFile(process.execPath, args, { maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (!error) return done(stdout);

            const message = (stderr || error.message).trim();
            done(JSON.stringify({ error: message }));
        });
    });
}

/** Open the address in the browser. A machine without one only misses the convenience. */
function openBrowser(url: string): void {
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

export async function studio(options: StudioOptions): Promise<void> {
    const { configPath, root, port } = options;

    // The page's files ship in the package's sources, which Bun runs as they are and Node's build leaves in place.
    const installed = packageRoot();
    if (!installed) throw new Error("cannot find where Circuit is installed, so Studio has no page to serve");
    const pages = join(installed, "src", "studio", "public");

    let data = await gather(configPath);

    // Another commit's network is read once: a commit does not change. Each is kept as it is being read, so two asks share one read.
    const past = new Map<string, Promise<string>>();

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

    const server = createServer((request, response) => {
        if (!hostAllowed(request.headers.host, port, options.allowHosts)) {
            response.writeHead(403).end();
            return;
        }

        const url = new URL(request.url ?? "/", "http://studio");
        const path = url.pathname;

        // The commits that changed a device: its file and its snapshot.
        if (path === "/history") {
            void answer(response, async () => {
                const name = url.searchParams.get("device") ?? "";
                const files = (JSON.parse(data) as StudioData).files?.[name];
                if (!files) throw new Error(`no device ${name}`);
                return history(
                    root,
                    [files.source, files.snapshot].filter((file): file is string => Boolean(file))
                );
            });
            return;
        }

        // What Studio can compare with: branches, tags and the latest commits.
        if (path === "/refs") {
            void answer(response, () => references(root));
            return;
        }

        // The network as it was at a branch, tag or commit.
        if (path === "/compare") {
            void answer(response, async () => {
                const asked = url.searchParams.get("ref") ?? "";
                const commit = await commitOf(root, asked);
                if (!commit) throw new Error(`${asked} names no commit here`);

                if (!past.has(commit.commit)) past.set(commit.commit, networkAt(root, configPath, commit.commit, gather));
                const network = await past.get(commit.commit)!;
                if (network.startsWith('{"error"')) past.delete(commit.commit);

                return `{"commit":${JSON.stringify(commit)},"network":${network}}`;
            });
            return;
        }

        if (path === "/data") {
            response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(data);
            return;
        }

        // Changes are told as they happen; a proxy such as nginx is asked not to hold them back.
        if (path === "/events") {
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

        // Only a file directly in public/, by a plain name, is served: nothing above it can be reached.
        const name = path === "/" ? "index.html" : path.slice(1);
        const type = CONTENT_TYPES[extname(name)];
        const file = join(pages, name);

        if (!/^[a-z-]+\.[a-z]+$/.test(name) || !type || !existsSync(file)) {
            response.writeHead(404).end();
            return;
        }

        response.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(readFileSync(file));
    });

    // Several files often change at once, such as on a save or a checkout: the config is read again once they settle.
    let timer: NodeJS.Timeout | undefined;

    watch(root, { recursive: true }, (_event, filename) => {
        if (filename && IGNORED.test(filename)) return;

        clearTimeout(timer);
        timer = setTimeout(async () => {
            data = await gather(configPath);
            tell("changed");
            console.log(`${new Date().toLocaleTimeString()}  ${filename ?? "a file"} changed, read again`);
        }, 300);
    });

    // A change to the page's own files, while working on Circuit, loads the page again.
    watch(pages, () => tell("page"));

    server.on("error", (error: NodeJS.ErrnoException) => {
        const message = error.code === "EADDRINUSE" ? `port ${port} is in use; choose another with --port=N` : error.message;
        console.error(message);
        process.exit(1);
    });

    server.listen(port, options.host, () => {
        const local = isLoopback(options.host);
        const url = local ? `http://127.0.0.1:${port}` : `http://${options.allowHosts[0] ?? options.host}`;
        console.log(`Circuit Studio at ${url}, listening on ${options.host}:${port}, watching ${root}. Stop it with Ctrl+C.`);
        if (options.open && local) openBrowser(url);
    });
}
