import type { VirtualMember } from "../exchange";

export default {
    name: "acme",
    asn: 65550,
    endpoint: "203.0.113.10",
    tunnel: { interface: "vix-acme", address: "10.254.1.2/31" },
} satisfies VirtualMember;
