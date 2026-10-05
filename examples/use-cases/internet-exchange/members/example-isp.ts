import { member } from "../exchange";

export default member({
    name: "example-isp",
    asn: 64510,
    ports: { "ix-sw-01": "10g-1" },
    ipv4: "203.0.113.10",
    ipv6: "2001:db8:ffff::10",
});
