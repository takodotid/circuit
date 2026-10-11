// `circuit studio`: the network in the browser, on this machine only. The page is the files in public/, served as they are. What it shows comes from /data: gathered by `circuit studio --json` in a new process, so the config is always read fresh, and gathered again each time a file beside the config changes.

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { packageRoot } from "./data";

export type StudioOptions = {
    /** The config file. */
    configPath: string;
    /** The directory watched for changes: the config's own. */
    root: string;
    port: number;
    /** Open the browser once the server listens. */
    open: boolean;
};

/** Directories whose changes never change what studio shows. */
const IGNORED = /(^|[\\/])(node_modules|\.git)([\\/]|$)/;

const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};

/** What studio shows, as JSON, from `circuit studio --json` run as a new process, or what stopped it. */
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
    if (!installed) throw new Error("cannot find where Circuit is installed, so studio has no page to serve");
    const pages = join(installed, "src", "cli", "studio", "public");

    let data = await gather(configPath);
    const listeners = new Set<ServerResponse>();
    const tell = (message: string) => {
        for (const listener of listeners) listener.write(`data: ${message}\n\n`);
    };

    // Only this machine's own names are answered, so a web page elsewhere cannot read the network through a name it points here.
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

    const server = createServer((request, response) => {
        if (!allowedHosts.has(request.headers.host ?? "")) {
            response.writeHead(403).end();
            return;
        }

        const path = (request.url ?? "/").split("?")[0]!;

        if (path === "/data") {
            response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(data);
            return;
        }

        if (path === "/events") {
            response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
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

    server.listen(port, "127.0.0.1", () => {
        const url = `http://127.0.0.1:${port}`;
        console.log(`Circuit studio at ${url}, watching ${root}. Stop it with Ctrl+C.`);
        if (options.open) openBrowser(url);
    });
}
