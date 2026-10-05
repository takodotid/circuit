// The network: every device Circuit manages, your own checks, and what is published about the network.

import { defineNetwork } from "@takodotid/circuit";
import checks from "./checks";
import edge from "./edge-01";
import { ASN, communities } from "./routing";

export default defineNetwork({ devices: [edge], checks, asn: ASN, communities: communities.catalogue });
