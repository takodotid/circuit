// ix-1: what both switches write, and what every member's port is.

export const ix_1 = literal({
    timezone: "Asia/Singapore",
    management: "10.0.0.0/24",
    vlans: {
        mgmt: { id: 10, description: "Management, never on a member port" },
        peering: { id: 100, description: "Peering LAN" },
    },
    /** A member's port: on the peering LAN, no spanning tree or LLDP toward the member, one MAC address, IPv4, ARP and IPv6 only, and a cap on flooded traffic. */
    member_port: {
        access_vlan: "peering",
        stp: false,
        lldp: false,
        mac_limit: 1,
        ethertypes: ["ipv4", "arp", "ipv6"],
        storm_control: { broadcast: { percent: 1 }, multicast: { percent: 1 }, unknown_unicast: { percent: 1 } },
    },
});
