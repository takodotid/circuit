// The network: a campus on private addresses (RFC 1918), run as one OSPF network without BGP. The data center's core router is the backbone's designated router, and each building's router is the border router of its building's area. Circuit reads this file first, then every device file under sites/.

export const campus = circuit({
    sites: {
        "data-center": { description: "The data center: the core router, the servers, and the carrier's line to the farm." },
        library: {
            description:
                "The library: its router, the reading rooms, the archive, and the radio link to the observatory and the boathouse.",
        },
    },
});
