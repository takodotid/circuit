// Screenshots of the docs site or Circuit Studio in a headless Chrome or Edge, with every console error the pages print. No dependency: it drives the browser through the DevTools protocol.
//
//   bun run docs:dev                                     # or: bun src/cli/index.ts studio --no-open --config=...
//   bun scripts/shots.ts http://localhost:5173/ http://localhost:5173/academy/
//
// Options: --out=.shots (folder), --sizes=1440x900,390x844, --themes=light,dark, --full (the whole page, not the window), --wait=1500 (ms after load), --scale=1 (device pixel ratio), --browser=<path>. Exits 1 when a page printed an error.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Message = { id?: number; method?: string; params?: Record<string, any>; result?: Record<string, any> };

/** One page in a headless browser, driven over the DevTools protocol. */
class Browser {
    static readonly PORT = 9341;

    /** Where Chrome or Edge usually is, on each system. */
    static readonly CANDIDATES = [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
    ];

    readonly errors: string[] = [];
    private readonly pending = new Map<number, (message: Message) => void>();
    private nextId = 0;

    private constructor(
        private readonly child: ReturnType<typeof spawn>,
        private readonly socket: WebSocket,
        private readonly profile: string
    ) {
        socket.addEventListener("message", (event) => this.receive(JSON.parse(String(event.data)) as Message));
    }

    static async open(path?: string): Promise<Browser> {
        const executable = path ?? Browser.CANDIDATES.find((candidate) => existsSync(candidate));
        if (!executable) throw new Error("no Chrome or Edge found: give one with --browser=<path>");

        const profile = mkdtempSync(join(tmpdir(), "circuit-shots-"));
        const child = spawn(
            executable,
            [
                "--headless=new",
                `--user-data-dir=${profile}`,
                "--no-first-run",
                "--disable-gpu",
                `--remote-debugging-port=${Browser.PORT}`,
                "about:blank",
            ],
            { stdio: "ignore" }
        );

        let address: string | undefined;
        for (let attempt = 0; attempt < 100 && !address; attempt++) {
            await Browser.sleep(200);

            try {
                const targets = (await (await fetch(`http://127.0.0.1:${Browser.PORT}/json`)).json()) as {
                    type: string;
                    webSocketDebuggerUrl: string;
                }[];
                address = targets.find((target) => target.type === "page")?.webSocketDebuggerUrl;
            } catch {
                // The browser isn't listening yet.
            }
        }
        if (!address) throw new Error(`${executable} did not open its DevTools port`);

        const socket = new WebSocket(address);
        await new Promise((done) => socket.addEventListener("open", done));

        const browser = new Browser(child, socket, profile);
        await browser.send("Page.enable");
        await browser.send("Runtime.enable");
        return browser;
    }

    static sleep(milliseconds: number): Promise<void> {
        return new Promise((done) => setTimeout(done, milliseconds));
    }

    private receive(message: Message): void {
        if (message.id !== undefined) {
            this.pending.get(message.id)?.(message);
            this.pending.delete(message.id);
        }

        if (message.method === "Runtime.exceptionThrown") {
            const details = message.params!.exceptionDetails;
            this.errors.push(details.exception?.description ?? details.text);
        }

        if (message.method === "Runtime.consoleAPICalled" && message.params!.type === "error") {
            this.errors.push(
                message.params!.args.map((arg: { value?: unknown; description?: string }) => arg.value ?? arg.description).join(" ")
            );
        }
    }

    send(method: string, params: Record<string, unknown> = {}): Promise<Message> {
        const id = ++this.nextId;

        return new Promise((done) => {
            this.pending.set(id, done);
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression: string): Promise<unknown> {
        const answer = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        return answer.result?.result?.value;
    }

    close(): void {
        this.socket.close();
        this.child.kill();
        setTimeout(() => rmSync(this.profile, { recursive: true, force: true }), 1_000);
    }
}

class Shots {
    /** Take every page at every size and theme. */
    static async main(args: string[]): Promise<void> {
        const urls = args.filter((arg) => !arg.startsWith("--"));
        const values = new Map(
            args.filter((arg) => arg.startsWith("--")).map((arg) => [arg.slice(2).split("=")[0]!, arg.split("=")[1] ?? "yes"])
        );
        if (!urls.length)
            throw new Error(
                "usage: bun scripts/shots.ts <url>... [--out=.shots] [--sizes=1440x900,390x844] [--themes=light,dark] [--full]"
            );

        const out = values.get("out") ?? ".shots";
        const sizes = (values.get("sizes") ?? "1440x900,390x844").split(",").map((size) => size.split("x").map(Number) as [number, number]);
        const themes = (values.get("themes") ?? "light,dark").split(",");
        const wait = Number(values.get("wait") ?? 1500);
        const scale = Number(values.get("scale") ?? 1);
        const full = values.has("full");

        mkdirSync(out, { recursive: true });
        const browser = await Browser.open(values.get("browser"));
        let failed = false;

        try {
            for (const url of urls) {
                for (const [width, height] of sizes) {
                    for (const theme of themes) {
                        const file = join(out, `${Shots.nameOf(url)}-${width}x${height}-${theme}.png`);
                        const before = browser.errors.length;

                        await browser.send("Emulation.setDeviceMetricsOverride", {
                            width,
                            height,
                            deviceScaleFactor: scale,
                            mobile: width < 700,
                        });
                        await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
                        await browser.send("Page.navigate", { url });
                        await Browser.sleep(wait);

                        writeFileSync(file, await Shots.capture(browser, full));

                        const errors = browser.errors.slice(before);
                        failed ||= errors.length > 0;
                        console.log(`${file}${errors.length ? `\n  errors:\n    ${errors.join("\n    ")}` : ""}`);
                    }
                }
            }
        } finally {
            browser.close();
        }

        if (failed) process.exitCode = 1;
    }

    /** A file name from a URL: `http://localhost:5173/guide/cli` to `guide-cli`, a hash kept. */
    static nameOf(url: string): string {
        const { pathname, hash } = new URL(url);
        const name = `${pathname}${hash}`.replace(/^\/+|\/+$/g, "").replace(/[^\w-]+/g, "-");
        return name || "home";
    }

    /** The window, or the whole page after scrolling through it, so what appears on scroll has appeared. */
    static async capture(browser: Browser, full: boolean): Promise<Buffer> {
        if (!full) {
            const shot = await browser.send("Page.captureScreenshot", { format: "png" });
            return Buffer.from(shot.result!.data, "base64");
        }

        const height = Number(await browser.evaluate("document.documentElement.scrollHeight"));
        for (let top = 0; top < height; top += 600) {
            await browser.evaluate(`window.scrollTo(0, ${top})`);
            await Browser.sleep(100);
        }
        await browser.evaluate("window.scrollTo(0, 0)");
        await Browser.sleep(500);

        const width = Number(await browser.evaluate("document.documentElement.scrollWidth"));
        const shot = await browser.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height, scale: 1 },
        });
        return Buffer.from(shot.result!.data, "base64");
    }
}

await Shots.main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
