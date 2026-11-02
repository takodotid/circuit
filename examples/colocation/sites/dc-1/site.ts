// dc-1: the facts both devices write.

export const dc_1 = literal({
    timezone: "Asia/Jakarta",
    addresses: {
        management: "10.0.0.0/24",
        router_on_switches: "10.0.99.1/24",
        tor_01: "10.0.99.2/24",
    },
    vlans: {
        mgmt: { id: 99, description: "Management of the switches" },
    },
});
