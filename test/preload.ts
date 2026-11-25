import { tmpdir } from "node:os";
import { join } from "node:path";

// The tests log in over SSH to fake devices on this machine. The machine's own SSH agent stays out: one that waits for the user's approval, as 1Password's does, stalls each login until the test times out.
process.env.SSH_AUTH_SOCK = join(tmpdir(), "circuit-test-no-agent");
