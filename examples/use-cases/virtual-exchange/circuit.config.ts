import type { Check } from "@takodotid/circuit";
import { defineNetwork } from "@takodotid/circuit";
import hub from "./hub-01";
import { MEMBERS } from "./members";

export default defineNetwork({
    devices: [hub],
    checks: [
        // Two members with the same name, AS or number would share a tunnel.
        () =>
            MEMBERS.flatMap((m, index) =>
                MEMBERS.slice(index + 1)
                    .filter((other) => other.name === m.name || other.asn === m.asn || other.number === m.number)
                    .map((other) => ({
                        level: "error" as const,
                        message: `members ${m.name} and ${other.name} share a name, an AS or a number`,
                    }))
            ),
    ] satisfies Check[],
});
