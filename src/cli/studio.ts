// `circuit studio`: the graph in the browser, on this machine only. Each time a file beside the config changes, the graph is made again by `circuit graph` in a new process, so the config is always read fresh.

import { execFile, spawn } from "node:child_process";
import { watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { page, STYLE } from "./studio-page";

export type StudioOptions = {
    /** The config file. */
    configPath: string;
    /** The directory watched for changes: the config's own. */
    root: string;
    port: number;
    /** Open the browser once the server listens. */
    open: boolean;
};

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Circuit studio</title>
<style>${STYLE}</style>
</head>
<body>
<script>(${page.toString()})()</script>
</body>
</html>
`;

/** Directories whose changes never change the graph. */
const IGNORED = /(^|[\\/])(node_modules|\.git)([\\/]|$)/;

/** The graph as JSON, from `circuit graph` run as a new process, or what stopped it. */
function makeGraph(configPath: string): Promise<string> {
    const cli = process.argv[1]!;
    const args = [...process.execArgv, cli, "graph", "--format=json", "--layer=all", `--config=${configPath}`];

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

    let graph = await makeGraph(configPath);
    const listeners = new Set<ServerResponse>();

    // Only this machine's own names are answered, so a web page elsewhere cannot read the graph through a name it points here.
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

    const server = createServer((request, response) => {
        if (!allowedHosts.has(request.headers.host ?? "")) {
            response.writeHead(403).end();
            return;
        }

        if (request.url === "/") {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(HTML);
            return;
        }

        if (request.url === "/graph") {
            response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(graph);
            return;
        }

        if (request.url === "/events") {
            response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
            response.write(": connected\n\n");

            listeners.add(response);
            request.on("close", () => listeners.delete(response));
            return;
        }

        response.writeHead(404).end();
    });

    // Several files often change at once, such as on a save or a checkout: the graph is made once they settle.
    let timer: NodeJS.Timeout | undefined;

    watch(root, { recursive: true }, (_event, filename) => {
        if (filename && IGNORED.test(filename)) return;

        clearTimeout(timer);
        timer = setTimeout(async () => {
            graph = await makeGraph(configPath);
            for (const listener of listeners) listener.write("data: changed\n\n");
            console.log(`${new Date().toLocaleTimeString()}  ${filename ?? "a file"} changed, graph made again`);
        }, 300);
    });

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
