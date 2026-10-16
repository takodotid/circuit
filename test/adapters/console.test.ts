// Logging in on a serial console, against a FortiGate console played back from what a FortiGate 3700D printed on 6.2.2.

import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
import { consoleLogin } from "../../src/adapters/devices/fortios/index";

/** A console that answers each line it receives from a script, and records what was written. */
function fakeConsole(answers: Record<string, string>) {
    const emitter = new EventEmitter();
    const written: string[] = [];

    const channel = {
        write(data: string) {
            written.push(data);
            const answer = answers[data];
            if (answer !== undefined) setTimeout(() => emitter.emit("data", Buffer.from(answer)), 5);
            return true;
        },
        on: (event: string, listener: (chunk: Buffer) => void) => emitter.on(event, listener),
        removeListener: (event: string, listener: (chunk: Buffer) => void) => emitter.removeListener(event, listener),
    };

    return { channel, written };
}

test("a console left inside a config level is left, logged out, and logged in again", async () => {
    const { channel, written } = fakeConsole({
        "\r": "\r\nFortiGate-3700D (mgmt1) # ",
        "end\r": "end\r\nFortiGate-3700D # ",
        "exit\r": "exit\r\n\r\nFortiGate-3700D login: ",
        "supertako\r": "supertako\r\nPassword: ",
        "secret\r": "*******\r\nWelcome !\r\n\r\nFortiGate-3700D # ",
    });

    await consoleLogin(channel, "supertako", "secret");
    expect(written).toEqual(["\r", "end\r", "exit\r", "supertako\r", "secret\r"]);
});

test("a console showing the pre-login banner is accepted before the login", async () => {
    const { channel, written } = fakeConsole({
        "\r": "\r\nAuthorised access only.\r\n(Press 'a' to accept):",
        a: "\r\nFortiGate-3700D login: ",
        "supertako\r": "supertako\r\nPassword: ",
        "secret\r": "*******\r\nFortiGate-3700D # ",
    });

    await consoleLogin(channel, "supertako", "secret");
    expect(written).toEqual(["\r", "a", "supertako\r", "secret\r"]);
});

test("a refused console login fails", async () => {
    const { channel } = fakeConsole({
        "\r": "\r\nFortiGate-3700D login: ",
        "supertako\r": "supertako\r\nPassword: ",
        "wrong\r": "*****\r\nLogin incorrect\r\nFortiGate-3700D login: ",
    });

    await expect(consoleLogin(channel, "supertako", "wrong")).rejects.toThrow("refused the login");
});
