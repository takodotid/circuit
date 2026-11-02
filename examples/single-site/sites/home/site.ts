// The site's facts that both devices write. Change them to your own.

export const home = literal({
    timezone: "Asia/Jakarta",
    addresses: {
        /** The management network. Only addresses in it may log in to the devices. */
        management: "192.168.10.0/24",
        router: "192.168.10.1/24",
        switch: "192.168.10.2/24",
    },
    vlans: {
        mgmt: { id: 10, description: "Management" },
        home: { id: 20, description: "Home" },
        guests: { id: 30, description: "Guests" },
    },
});
