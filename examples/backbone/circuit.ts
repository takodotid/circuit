// The network, AS64500, in two regions. Each region is a member AS of a BGP confederation (RFC 5065), with its own iBGP, and every network outside sees AS64500 only.

export const as64500 = circuit({
    asn: 64500,
    prefixes: {
        ours: { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" },
    },
    sites: {
        north: { description: "The north region, member AS 65001, with transit from Hurricane Electric." },
        south: { description: "The south region, member AS 65002, with transit from Cogent." },
    },
    checks: {
        imports_end_in_accept_or_reject: true,
    },
});
