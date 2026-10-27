import type { Check } from "@takodotid/circuit";
import { Address, defineNetwork } from "@takodotid/circuit";
import hub from "./hub-01";
import { MEMBERS } from "./members";

export default defineNetwork({
    devices: [hub],
    checks: [
        // Two members with the same name, AS, tunnel or tunnel network would take each other's place.
        () =>
            MEMBERS.flatMap((m, index) =>
                MEMBERS.slice(index + 1)
                    .filter(
                        (other) =>
                            other.name === m.name ||
                            other.asn === m.asn ||
                            other.tunnel.interface === m.tunnel.interface ||
                            Address.prefixOf(other.tunnel.address) === Address.prefixOf(m.tunnel.address)
                    )
                    .map((other) => ({
                        level: "error" as const,
                        message: `members ${m.name} and ${other.name} share a name, an AS, a tunnel or a tunnel network`,
                    }))
            ),
    ] satisfies Check[],
});
