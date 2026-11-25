// The network: a data center's first hall, on private IPv4 addresses (RFC 1918) and the data center's own IPv6 prefix. IS-IS carries both families, IPv6 in a topology of its own (RFC 5120). The hall's leaf switches are in a level 1 area, and its spine switch joins hall 2's spine at level 2. Circuit reads this file, then every device file under sites/.

export const dc = circuit({
    sites: {
        "hall-1": { description: "Hall 1: its spine switch, and the leaf switch of each row of racks." },
    },
});
