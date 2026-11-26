import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnownHosts } from "../src/transport/known-hosts";

// The tests log in over SSH to fake devices on this machine. The machine's own SSH agent stays out: one that waits for the user's approval, as 1Password's does, stalls each login until the test times out.
process.env.SSH_AUTH_SOCK = join(tmpdir(), "circuit-test-no-agent");

// The fake devices' host keys go to a known_hosts of the run's own, never the machine's.
const knownHosts = mkdtempSync(join(tmpdir(), "circuit-test-known-hosts-"));
KnownHosts.files = () => new KnownHosts(join(knownHosts, "known_hosts"));
process.on("exit", () => rmSync(knownHosts, { recursive: true, force: true }));
