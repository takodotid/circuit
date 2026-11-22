// The network, AS64500: three points of presence joined by an MPLS core, where IS-IS carries the IPv4 and IPv6 loopbacks and LDP labels them. iBGP carries a bank's VPN routes. Pseudowires join a clinic's two sites, a TV station's two VLANs, and an ISP's handoffs. BGP joins a museum's sites in one VPLS, a library's in another, and a school's in an EVPN VXLAN segment.

export const as64500 = circuit({
    asn: 64500,
    prefixes: {
        ours: { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" },
    },
    sites: {
        "pop-1": { description: "The first point of presence." },
        "pop-2": { description: "The second point of presence, one link away from the first." },
        "pop-3": { description: "The third point of presence, one link away from the second." },
    },
});
