// The network, AS64500: two points of presence joined by an MPLS core. IS-IS carries the routers' loopbacks, and LDP gives each loopback a label. Over the core, iBGP carries a bank's VPN routes between its offices, and a pseudowire joins a clinic's two sites.

export const as64500 = circuit({
    asn: 64500,
    prefixes: {
        ours: { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" },
    },
    sites: {
        "pop-1": { description: "The first point of presence." },
        "pop-2": { description: "The second point of presence, one link away from the first." },
    },
});
