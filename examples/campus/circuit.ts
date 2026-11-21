// The network: a campus on private IPv4 addresses (RFC 1918) and its own IPv6 prefix, run as one OSPF network without BGP. The data center's core router is the backbone's designated router. The library's router is the border router of an area that also holds the field station. Circuit reads this file first, then every device file under sites/.

export const campus = circuit({
    sites: {
        "data-center": { description: "The data center: the core router and the servers." },
        library: { description: "The library: its router, the reading rooms, and the archive." },
        "field-station": {
            description:
                "The field station by the lake: its router, the radio to the observatory and the boathouse, and the carrier's line to the farm.",
        },
    },
});

// #region classes
// The classes of traffic, the same on every router, each with the DSCPs RFC 4594 gives it. The phones mark their calls EF themselves.
export const classes = literal({
    network: { dscp: ["cs6", "cs7"] },
    voice: { dscp: ["ef"] },
    video: { dscp: ["af41", "af42", "af43"] },
    "best-effort": { dscp: ["cs0"] },
    bulk: { dscp: ["cs1", "le"] },
});
// #endregion classes
