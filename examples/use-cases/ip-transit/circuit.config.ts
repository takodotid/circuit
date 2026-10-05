import { defineNetwork } from "@takodotid/circuit";
import { exportsEndInReject, trustBoundary } from "@takodotid/circuit/presets";
import edge from "./edge-01";
import { ASN, communities } from "./routing";

export default defineNetwork({
    devices: [edge],
    // The customer's VLAN counts as ours: traffic from the transit and the exchange reaches it only through the router.
    checks: [exportsEndInReject, trustBoundary({ untrusted: ["transit", "ix"], routers: ["edge-01"] })],
    asn: ASN,
    communities: communities.catalogue,
});
