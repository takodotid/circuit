import type { ExchangeMember } from "@takodotid/circuit/presets";

export default {
    name: "example-cdn",
    asn: 64520,
    ports: { "ix-sw-01": "40g-2" },
    ipv4: "203.0.113.11",
    ipv6: "2001:db8:ffff::11",
} satisfies ExchangeMember;
