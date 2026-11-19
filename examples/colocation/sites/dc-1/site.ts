// dc-1: the facts both devices write.

export const dc_1 = literal({
    timezone: "Asia/Jakarta",
    addresses: {
        management: "10.0.0.0/24",
        router_on_switches: "10.0.99.1/24",
        tor_01: "10.0.99.2/24",
        tor_02: "10.0.99.3/24",
    },
    vlans: {
        mgmt: { id: 99, description: "Management of the switches" },
        shared: { id: 500, description: "Small tenants, one server each" },
    },
});
