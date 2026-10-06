// Your AS number, and what your BGP communities mean, for you and for your customers.

import { communityScheme } from "@takodotid/circuit/presets";

export const ASN = 64500;

export const communities = communityScheme({
    asn: ASN,
    learned_from: { function: 1, classes: { transit: 1, exchange: 2, customer: 3 } },
    learned_from_as: 3,
    // What a neighbor can ask us for, and who may: only customers.
    do_not_announce: { function: 100, trusted: ["customer"] },
    prepend: { once: 101, twice: 102, three_times: 103, trusted: ["customer"] },
    blackhole: { function: 666, trusted: ["customer"] },
});
