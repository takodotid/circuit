/** An SSH shell, a serial console, or anything else that streams the CLI. */
export type Channel = {
    write(data: string): unknown;
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
    on(event: "close", listener: () => void): unknown;
    removeListener(event: "data", listener: (chunk: Buffer) => void): unknown;
    removeListener(event: "close", listener: () => void): unknown;
};

/** How a change that could cut access is guarded: the device reloads its saved configuration after `seconds` unless `prove` shows access survived. */
export type Guard = { seconds: number; prove: () => Promise<void> };

export class FortiOsCli {
    /** `host # `, or `host (context) # ` inside a level. */
    private static readonly PROMPT = /(?:^|\n)[^\n]*[#$] $/;
    static readonly QUESTION = /\(y\/n\)\s*$/;

    /** The pre-login banner, which waits for the reader to accept it. */
    static readonly BANNER = /\(Press 'a' to accept\):\s*$/;

    /** The device ended the session and asks for a login again. */
    private static readonly LOGGED_OUT = /(?:^|\n)[^\n]*login: $/;

    /** The pager the device stops at, and how it erases itself once answered. */
    private static readonly PAGER = /--More-- \r? *\r/g;

    /** The prompt that ended the last answer, which shows where the session is: `(port1)` inside an entry. */
    prompt = "";

    constructor(
        private readonly channel: Channel,
        private readonly newline = "\n"
    ) {}

    /** Wait for the prompt, after logging in. */
    async ready(timeout = 30_000): Promise<void> {
        await this.collect(timeout);
    }

    /** What the device printed after the line, without the echo or the prompt. */
    async run(line: string, timeout = 60_000): Promise<string> {
        this.channel.write(line + this.newline);
        const output = await this.collect(timeout);

        const lines = output.split("\n");
        return lines.slice(1, -1).join("\n");
    }

    answer(reply: "y" | "n", timeout = 60_000): Promise<string> {
        this.channel.write(reply);
        return this.collect(timeout);
    }

    /** What the device prints until its prompt or a question. A session the device ended, or that went silent, fails. */
    private collect(timeout: number): Promise<string> {
        return new Promise((done, fail) => {
            let raw = "";
            let settle: ReturnType<typeof setTimeout> | undefined;

            const text = () => raw.replace(FortiOsCli.PAGER, "").replace(/\r/g, "");

            const stop = () => {
                clearTimeout(limit);
                clearTimeout(settle);
                this.channel.removeListener("data", onData);
                this.channel.removeListener("close", onClose);
            };

            const finish = () => {
                stop();

                const output = text();
                this.prompt = output.split("\n").at(-1) ?? "";
                done(output);
            };

            const onData = (chunk: Buffer) => {
                raw += chunk.toString("utf8");
                if (raw.endsWith("--More-- ")) this.channel.write(" ");
                if (FortiOsCli.BANNER.test(raw)) this.channel.write("a");

                clearTimeout(settle);

                if (FortiOsCli.LOGGED_OUT.test(text())) {
                    stop();
                    fail(new Error("the device ended the session"));
                } else if (FortiOsCli.PROMPT.test(text()) || FortiOsCli.QUESTION.test(text())) {
                    settle = setTimeout(finish, 300);
                }
            };

            const onClose = () => {
                stop();
                fail(new Error("the device ended the session"));
            };

            const limit = setTimeout(() => {
                stop();
                fail(new Error(`no prompt within ${timeout / 1000} seconds: ${text().slice(-200)}`));
            }, timeout);

            this.channel.on("data", onData);
            this.channel.on("close", onClose);
        });
    }
}
