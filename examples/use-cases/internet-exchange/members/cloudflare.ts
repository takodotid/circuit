import type { ExchangeMember } from "@takodotid/circuit/presets";

export default {
    name: "cloudflare",
    asn: 13335,
    ports: { "ix-sw-01": "40g-1" },
    ipv4: "203.0.113.10",
    ipv6: "2001:db8:ffff::10",
} satisfies ExchangeMember;
