import type { ExchangeMember } from "@takodotid/circuit/presets";

export default {
    name: "acme",
    asn: 65550,
    ports: { "ix-sw-02": "10g-1" },
    ipv4: "203.0.113.12",
    ipv6: "2001:db8:ffff::12",
} satisfies ExchangeMember;
