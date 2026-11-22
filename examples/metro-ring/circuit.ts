// The network, AS64500: three routers of a city's metro network in a ring, each a link away from the other two. OSPF carries their loopbacks and the bandwidth of each link (RFC 3630), and LDP labels the loopbacks. A TV station's two studios share one Ethernet segment, which crosses the ring in RSVP-TE tunnels that reserve its bandwidth (RFC 3209).

export const as64500 = circuit({
    asn: 64500,
    sites: {
        north: { description: "The north point of presence." },
        east: { description: "The east point of presence." },
        south: { description: "The south point of presence." },
    },
});
