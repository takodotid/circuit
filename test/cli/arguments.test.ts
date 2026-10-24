// The command line reads its arguments the same way whichever order or form they are written in.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const config = "templates/edge-router/circuit.config.ts";

/** Run the CLI from the repository, and keep what it printed and its exit code. */
function circuit(...args: string[]) {
    const result = spawnSync("bun", [join(root, "src/cli/index.ts"), ...args], { cwd: root, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("--config takes its path after a space or after =", () => {
    expect(circuit("validate", "--config", config)).toMatchObject({ status: 0, stdout: "1 device(s), no errors.\n" });
    expect(circuit("validate", `--config=${config}`)).toMatchObject({ status: 0, stdout: "1 device(s), no errors.\n" });
});

test("options can come before or after the device names", () => {
    const after = circuit("build", "edge-01", "--config", config);
    const before = circuit("build", "--config", config, "edge-01");

    expect(after.status).toBe(0);
    expect(before.stdout).toBe(after.stdout);
});

test("with no command, the help lists every command", () => {
    const { status, stdout } = circuit();

    expect(status).toBe(0);
    expect(stdout).toContain("validate");
    expect(stdout).toContain("studio");
});

test("an unknown option or a missing device stops with an error", () => {
    expect(circuit("validate", "--confrim", `--config=${config}`).status).toBe(1);
    expect(circuit("build", `--config=${config}`).status).toBe(1);
    expect(circuit("build", "nope", `--config=${config}`)).toMatchObject({ status: 1, stderr: "no device nope; known: edge-01\n" });
});

test("show refuses a command not known to only read, before it connects", () => {
    const write = "/ip address add address=192.0.2.1/24 interface=ether1";
    const result = circuit("show", "edge-01", "/ip route print", write, `--config=${config}`);

    expect(result).toMatchObject({
        status: 1,
        stdout: "",
        stderr: `not known to only read on routeros, so nothing was sent:\n  ${write}\n`,
    });
    expect(circuit("show", "edge-01", `--config=${config}`)).toMatchObject({ status: 1, stderr: "give a command to run, or --file\n" });
});

test("bgp takes the only device with BGP when none is named, and checks the neighbors and the platform before it connects", () => {
    expect(circuit("bgp", "nope", `--config=${config}`)).toMatchObject({
        status: 1,
        stderr: "no BGP neighbor of edge-01 matches /nope/; known: hurricane-electric, sgix-rs-v4, sgix-rs-v6\n",
    });
    expect(circuit("bgp", "edge-01", "nope", `--config=${config}`).status).toBe(1);
    expect(circuit("bgp", "example-aggregation-switch", "--config=examples/platforms/circuit.config.ts")).toMatchObject({
        status: 1,
        stderr: "circuit bgp does not support junos yet, only routeros\n",
    });
    expect(circuit("bgp", "--config=examples/platforms/circuit.config.ts").stderr).toStartWith(
        "several devices have BGP neighbors, so name one: "
    );
    expect(circuit("bgp", "--clear-limit", "--wait", `--config=${config}`)).toMatchObject({
        status: 1,
        stderr: "--clear-limit and --wait go in two runs: clear first, then wait\n",
    });
});

test("console stops at once on a device without a console", () => {
    expect(circuit("console", "edge-01", `--config=${config}`)).toMatchObject({ status: 1, stderr: "edge-01 has no connection.console\n" });
});
