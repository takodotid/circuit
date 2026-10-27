import type { VirtualMember } from "../exchange";

export default {
    name: "globex",
    asn: 65551,
    endpoint: "192.0.2.20",
    tunnel: { interface: "vix-globex", address: "10.254.1.4/31" },
} satisfies VirtualMember;
