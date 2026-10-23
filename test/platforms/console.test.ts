// Logging in on a serial console and running commands there, against consoles played back from what each device printed.

import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
import { FORTIOS_CONSOLE } from "../../src/adapters/devices/fortios/index";
import { VRP_CONSOLE } from "../../src/adapters/devices/vrp/index";
import { ROUTEROS_CONSOLE } from "../../src/adapters/devices/routeros/index";
import { afterEcho, consoleLogin, ConsoleShell } from "../../src/transport/console";

/** A console that answers each line it receives from a script, and records what was written. */
function fakeConsole(answers: Record<string, string | string[] | (() => string | string[])>) {
    const emitter = new EventEmitter();
    const written: string[] = [];

    const channel = {
        write(data: string) {
            written.push(data);
            const given = answers[data];
            const answer = typeof given === "function" ? given() : given;
            const chunks = answer === undefined ? [] : Array.isArray(answer) ? answer : [answer];
            chunks.forEach((chunk, index) => setTimeout(() => emitter.emit("data", Buffer.from(chunk)), 5 * (index + 1)));
            return true;
        },
        on: (event: string, listener: (chunk: Buffer) => void) => emitter.on(event, listener),
        removeListener: (event: string, listener: (chunk: Buffer) => void) => emitter.removeListener(event, listener),
    };

    return { channel, written };
}

test("a FortiOS console left inside a config level is left, logged out, and logged in again", async () => {
    const { channel, written } = fakeConsole({
        "\n": "\r\nFortiGate-3700D (mgmt1) # ",
        "end\n": "end\r\nFortiGate-3700D # ",
        "exit\n": "exit\r\n\r\nFortiGate-3700D login: ",
        "supertako\n": "supertako\r\nPassword: ",
        "secret\n": "*******\r\nWelcome !\r\n\r\nFortiGate-3700D # ",
    });

    await consoleLogin(channel, FORTIOS_CONSOLE, "supertako", "secret");
    expect(written).toEqual(["\n", "end\n", "exit\n", "supertako\n", "secret\n"]);
});

test("a FortiOS console showing the pre-login banner is accepted before the login", async () => {
    const { channel, written } = fakeConsole({
        "\n": "\r\nAuthorised access only.\r\n(Press 'a' to accept):",
        a: "\r\nFortiGate-3700D login: ",
        "supertako\n": "supertako\r\nPassword: ",
        "secret\n": "*******\r\nFortiGate-3700D # ",
    });

    await consoleLogin(channel, FORTIOS_CONSOLE, "supertako", "secret");
    expect(written).toEqual(["\n", "a", "supertako\n", "secret\n"]);
});

test("a refused console login fails", async () => {
    const { channel } = fakeConsole({
        "\n": "\r\nFortiGate-3700D login: ",
        "supertako\n": "supertako\r\nPassword: ",
        "wrong\n": "*****\r\nLogin incorrect\r\nFortiGate-3700D login: ",
    });

    await expect(consoleLogin(channel, FORTIOS_CONSOLE, "supertako", "wrong")).rejects.toThrow("refused the login");
});

test("a RouterOS console logs in with its flags after the user", async () => {
    const { channel, written } = fakeConsole({
        "\n": "\r\n\r\nMikroTik 7.23.5 (long-term)\r\ntako-bdr-01 Login: ",
        "supertako+cwt\n": "supertako+cwt\r\nPassword: ",
        "secret\n": "\r\n  MikroTik RouterOS 7.23.5\r\n\r\n[supertako@tako-bdr-01] > ",
    });

    await consoleLogin(channel, ROUTEROS_CONSOLE, "supertako", "secret");
    expect(written).toEqual(["\n", "supertako+cwt\n", "secret\n"]);
});

test("a console command returns what it printed, without its wrapped echo or the prompt", async () => {
    const command = '/interface ethernet print without-paging where name~"sfp28-1|ether1"';
    const { channel } = fakeConsole({
        [`${command}\n`]: [
            '/interface ethernet print without-paging where name~"s\r\nfp28-1|ether1"\r\n',
            "Flags: X - DISABLED\r\n 0 X ether1\r\n",
            "[supertako@tako-bdr-01] > ",
        ],
    });

    const shell = new ConsoleShell(channel, ROUTEROS_CONSOLE);
    expect(await shell.run(command)).toBe("Flags: X - DISABLED\n 0 X ether1");
});

test("an echo that does not match leaves the text as it is", () => {
    expect(afterEcho("something else\nout", "/system print")).toBe("something else\nout");
});

test("a device needs a management address or a console", async () => {
    const { validate } = await import("../../src/core/validate");
    const { default: firewall } = await import("../../examples/firewall");
    const reach = (connection: object) =>
        validate({ devices: [{ ...firewall, connection: { user: firewall.connection.user, ...connection } }] });
    const message = "connection has neither a host nor a console to reach the device through";

    expect(reach({}).map((finding) => finding.message)).toContain(message);
    expect(reach({ console: { port: "COM3", baud: 9600 } }).map((finding) => finding.message)).not.toContain(message);
});

test("a VRP console that asks for a username and a password logs in", async () => {
    const { channel, written } = fakeConsole({
        "\n": "\r\nUsername:",
        "netops\n": "netops\r\nPassword:",
        "secret\n": "\r\nInfo: Current time.\r\n<tako-sw-01>",
    });

    await consoleLogin(channel, VRP_CONSOLE, "netops", "secret");
    expect(written).toEqual(["\n", "netops\n", "secret\n"]);
});

test("a VRP console that asks only for a password gets the password and no name", async () => {
    const { channel, written } = fakeConsole({
        "\n": "\r\nPassword:",
        "secret\n": "\r\n<tako-sw-01>",
    });

    await consoleLogin(channel, VRP_CONSOLE, "netops", "secret", true);
    expect(written).toEqual(["\n", "secret\n"]);
});

test("a VRP console left logged in is logged out and brought back to its password prompt", async () => {
    const screens = ["\r\n<tako-sw-01>", "\r\nUser interface con0 is available\r\n\r\nPlease Press ENTER.", "\r\nPassword:"];
    const { channel, written } = fakeConsole({
        "\n": () => screens.shift()!,
        "quit\n": "quit\r\nUser interface con0 is available\r\n\r\nPlease Press ENTER.",
        "secret\n": "\r\n<tako-sw-01>",
    });
    screens.splice(1, 1);

    await consoleLogin(channel, VRP_CONSOLE, "netops", "secret", true);
    expect(written).toEqual(["\n", "quit\n", "\n", "secret\n"]);
});

test("a VRP console that refuses the password says so", async () => {
    const { channel } = fakeConsole({
        "\n": "\r\nPassword:",
        "wrong\n": "\r\nError: The password is invalid.\r\n\r\nUser interface con0 is available\r\n\r\nPlease Press ENTER.",
    });

    await expect(consoleLogin(channel, VRP_CONSOLE, "netops", "wrong", true)).rejects.toThrow("refused the password");
});

test("a console set to ask only for a password fails when it asks for a name", async () => {
    const { channel } = fakeConsole({ "\n": "\r\nUsername:" });

    await expect(consoleLogin(channel, VRP_CONSOLE, "netops", "secret", true)).rejects.toThrow("asks for a name");
});
