import type { ExchangeMember } from "@takodotid/circuit/presets";

export default {
    name: "akamai",
    asn: 20940,
    ports: { "ix-sw-02": "40g-1" },
    ipv4: "203.0.113.11",
    ipv6: "2001:db8:ffff::11",
} satisfies ExchangeMember;
