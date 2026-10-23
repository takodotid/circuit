// A regional provider with two sites, three platforms, transits, an exchange, customers with and without BGP, OSPF in two areas, and tunnels between the sites. Each site's devices are in its own directory, site-a and site-b; what they share is beside this file. Any command runs on it from the repository, such as:
//
//   bun src/cli/index.ts validate --config=examples/use-cases/regional-provider/circuit.config.ts
//
// The snapshots in .circuit/state stand in for what the devices last printed: most match the config, edge-b1 does not have sirius yet, tor-a2 has a port described by hand, and agg-b1 and tor-b1 have none.

import { defineNetwork } from "@takodotid/circuit";
import checks from "./checks";
import { ASN, communities } from "./network";
import coreA1 from "./site-a/core-a1";
import coreA2 from "./site-a/core-a2";
import edgeA1 from "./site-a/edge-a1";
import edgeA2 from "./site-a/edge-a2";
import torA1 from "./site-a/tor-a1";
import torA2 from "./site-a/tor-a2";
import torA3 from "./site-a/tor-a3";
import aggB1 from "./site-b/agg-b1";
import edgeB1 from "./site-b/edge-b1";
import torB1 from "./site-b/tor-b1";

export default defineNetwork({
    devices: [edgeA1, edgeA2, edgeB1, coreA1, coreA2, torA1, torA2, torA3, aggB1, torB1],
    checks,
    asn: ASN,
    communities: communities.catalogue,
});
