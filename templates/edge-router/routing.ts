// What your network is on the internet: its AS number and its BGP communities.

import { communityScheme } from "@takodotid/circuit/presets";

/** Your AS number. */
export const ASN = 64500;

/** What your BGP communities mean. The router tags each route it learns with them, and `circuit communities` publishes them. */
export const communities = communityScheme({
    asn: ASN,
    learned_from: { function: 1, classes: { transit: 1, exchange: 2 } },
    learned_from_as: 3,
});
