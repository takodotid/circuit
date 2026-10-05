// The network: every device Circuit manages, your own checks, and what is published about the network.

import { defineNetwork } from "@takodotid/circuit";
import checks from "./checks";
import edge from "./edge-01";
import { ASN, communities } from "./routing";
import tor from "./tor-01";

export default defineNetwork({ devices: [edge, tor], checks, asn: ASN, communities: communities.catalogue });
