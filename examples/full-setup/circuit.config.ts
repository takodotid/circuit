// A full setup: a regional provider with two sites, three platforms, transits, an exchange, customers with and without BGP, OSPF in two areas, and tunnels between the sites. Any command runs on it from the repository, such as:
//
//   bun src/cli/index.ts validate --config=examples/full-setup/circuit.config.ts
//
// The snapshots in .circuit/state stand in for what the devices last printed: most match the config, edge-b1 does not have sirius yet, tor-a2 has a port described by hand, and agg-b1 and tor-b1 have none.

import { defineNetwork } from "@takodotid/circuit";
import aggB1 from "./agg-b1";
import checks from "./checks";
import coreA1 from "./core-a1";
import coreA2 from "./core-a2";
import edgeA1 from "./edge-a1";
import edgeA2 from "./edge-a2";
import edgeB1 from "./edge-b1";
import { ASN, communities } from "./network";
import torA1 from "./tor-a1";
import torA2 from "./tor-a2";
import torA3 from "./tor-a3";
import torB1 from "./tor-b1";

export default defineNetwork({
    devices: [edgeA1, edgeA2, edgeB1, coreA1, coreA2, torA1, torA2, torA3, aggB1, torB1],
    checks,
    asn: ASN,
    communities: communities.catalogue,
});
