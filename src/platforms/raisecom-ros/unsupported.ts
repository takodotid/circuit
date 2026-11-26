import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device, Port, RateLimit, Switched } from "../../model";
import { RaisecomRosAcls } from "./acls";
import { RaisecomRosOspf } from "./ospf";
import { RaisecomRosRender } from "./render";
import { RaisecomRosRouting } from "./routing";
import { RaisecomRosServices } from "./services";
import { RaisecomRosSwitching } from "./switching";

/** What Raisecom ROS can't express, or what Circuit has not built for it, each with where it is written and why. */
export class RaisecomRosUnsupported {
    /** ROS 6.5.2's ND snooping trusts ports and checks router solicitations, and has no setting for router advertisements. */
    private static readonly RA_GUARD = "ROS 6.5.2 has no RA guard: its ND snooping checks router solicitations, not advertisements";

    /** IP source guard is one setting for the switch, `ip verify source`, after which every port drops IP from hosts it has no binding for unless trusted. */
    private static readonly SOURCE_GUARD =
        "IP source guard here is one setting for the whole switch, which drops IP on every other port unless it is trusted, and checks no ARP: not tried on a switch in service";

    static of(device: Device): string[] {
        return [
            ...RaisecomRosUnsupported.interfaces(device),
            ...RaisecomRosUnsupported.routing(device),
            ...RaisecomRosUnsupported.switching(device),
            ...RaisecomRosUnsupported.services(device),
        ];
    }

    private static interfaces(device: Device): string[] {
        const found: string[] = [];

        if (device.management?.interfaces) found.push("management.interfaces, which only FortiOS builds for now");

        const interfaces = Derive.interfaces(device);

        for (const { name, kind, settings } of interfaces) {
            if (kind === "bridge") found.push(`interfaces.bridge.${name}, the switch has no bridge interface`);
            if (kind === "vlan_interface" && "mac" in settings && settings.mac)
                found.push(`interfaces.vlan_interface.${name}.mac, which only RouterOS sets for now`);
        }

        for (const [name, port] of Derive.ports(device)) {
            const where = `interfaces.ethernet.${name}`;

            for (const field of ["speed", "mtu", "vrrp", "hardware_offload"] as const) {
                if (port[field] !== undefined) found.push(`${where}.${field}`);
            }
            found.push(...RaisecomRosUnsupported.routedPort(where, port));

            if (port.in_lag && (port.mac_limit !== undefined || port.ethertypes))
                found.push(`${where}.mac_limit and ethertypes on a LAG member, tested on a port alone`);
            if (port.mac_limit !== undefined && (port.mac_limit < 1 || port.mac_limit > RaisecomRosRender.MAC_LIMIT_MAX))
                found.push(`${where}.mac_limit ${port.mac_limit}, port security takes 1 to ${RaisecomRosRender.MAC_LIMIT_MAX}`);

            found.push(...RaisecomRosUnsupported.portStp(device, where, port));
            found.push(...RaisecomRosUnsupported.stormControl(where, port.storm_control));
            found.push(...RaisecomRosUnsupported.rateLimit(where, port.rate_limit, RaisecomRosRender.portKbps(name)));
        }

        for (const [name, lag] of Object.entries(device.interfaces?.lag ?? {})) {
            if (!lag) continue;
            const where = `interfaces.lag.${name}`;

            for (const field of [
                "addresses",
                "vrrp",
                "vrf",
                "urpf",
                "mtu",
                "storm_control",
                "stp",
                "ipv6_ra",
                "hardware_offload",
            ] as const) {
                if (lag[field] !== undefined) found.push(`${where}.${field}, a LAG here only switches`);
            }
            for (const field of ["mac_limit", "ethertypes", "qinq_vlan"] as const) {
                if (lag[field] !== undefined) found.push(`${where}.${field}, tested on a port alone`);
            }
            if (RaisecomRosRender.bpduGuard(device) && RaisecomRosRender.switches(lag))
                found.push(
                    `${where}, BPDU guard shuts down any LAG the switch finds to be an edge port, and Circuit sets no edge on a LAG here`
                );
            found.push(...RaisecomRosUnsupported.rateLimit(where, lag.rate_limit));
        }

        for (const [name, iface] of Object.entries(device.interfaces?.vlan_interface ?? {})) {
            if (!iface) continue;
            const where = `interfaces.vlan_interface.${name}`;

            for (const field of ["description", "mtu", "hardware_offload"] as const) {
                if (iface[field] !== undefined) found.push(`${where}.${field}`);
            }
            if (iface.rate_limit) found.push(`${where}.rate_limit, the platform limits ports and LAGs`);

            found.push(...RaisecomRosUnsupported.ipv6Addresses(where, iface), ...RaisecomRosUnsupported.urpf(where, iface));

            for (const group of iface.vrrp ?? []) {
                if (Address.family(group.address) === "ipv6") found.push(`${where}.vrrp for IPv6`);
            }
        }

        found.push(...RaisecomRosUnsupported.loopbacks(device));

        // ROS 6.5.2 takes the settings of a router advertisement, but has none that sends them or stops them: see TRAPS.md.
        for (const { where, kind, settings } of Derive.holders(device))
            if ((kind === "ethernet" || kind === "vlan_interface" || kind === "loopback") && settings.ipv6_ra !== undefined)
                found.push(`${where}.ipv6_ra, ROS 6.5.2 has no setting that turns router advertisements on or off`);

        // Only LAGs, VLAN interfaces, and loopbacks are built here.
        for (const { name, kind } of interfaces) {
            if (kind === "ipsec") found.push(`interfaces.ipsec.${name}, IPsec: the switch does not encrypt the traffic it forwards`);
            else if (kind === "pseudowire") found.push(`interfaces.pseudowire.${name}, a pseudowire, not built yet`);
            else if (kind === "pppoe_client")
                found.push(`interfaces.pppoe_client.${name}, a PPPoE client: Raisecom ROS only adds PPPoE+ tags to what it switches`);
            else if (!["lag", "vlan_interface", "loopback", "bridge"].includes(kind)) found.push(`interfaces.${kind}.${name}`);
        }

        return found;
    }

    /** A routed port takes its addresses, its description, and LLDP. Its other layer 2 settings were tried on switched ports alone. */
    private static routedPort(where: string, port: Port): string[] {
        if (!RaisecomRosRouting.routes(port)) return port.urpf ? [`${where}.urpf, on a port that does not route: give it addresses`] : [];

        const found = [...RaisecomRosUnsupported.ipv6Addresses(where, port), ...RaisecomRosUnsupported.urpf(where, port)];
        for (const field of ["stp", "storm_control", "mac_limit", "ethertypes", "rate_limit", "dhcp_trusted"] as const)
            if (port[field] !== undefined) found.push(`${where}.${field} on a routed port, tested on switched ports alone`);
        return found;
    }

    /** The switch checks IPv6 too, `ipv6 urpf`, but an interface here holds IPv4 addresses alone. */
    private static urpf(where: string, settings: Pick<Port, "urpf">): string[] {
        return settings.urpf?.ipv6 ? [`${where}.urpf.ipv6, only IPv4 here`] : [];
    }

    /** A loopback holds IPv4 addresses, numbered 1 to 1024 by its place. */
    private static loopbacks(device: Device): string[] {
        const found: string[] = [];
        const ids = RaisecomRosRouting.loopbackIds(device);

        for (const [name, loopback] of Object.entries(device.interfaces?.loopback ?? {})) {
            if (!loopback) continue;
            const where = `interfaces.loopback.${name}`;

            for (const field of ["description", "mtu", "vrrp"] as const)
                if (loopback[field] !== undefined) found.push(`${where}.${field}, not on a loopback here`);
            found.push(...RaisecomRosUnsupported.ipv6Addresses(where, loopback));
            if (ids.get(name)! > RaisecomRosRouting.LOOPBACK.max)
                found.push(`${where}, past the ${RaisecomRosRouting.LOOPBACK.max} loopbacks the switch takes`);
        }

        return found;
    }

    private static ipv6Addresses(where: string, settings: Pick<Port, "addresses">): string[] {
        return (settings.addresses ?? []).flatMap((entry) => {
            const address = typeof entry === "string" ? entry : entry.address;
            return Address.family(address) === "ipv6" ? [`${where}.addresses ${address}, only IPv4 here`] : [];
        });
    }

    /** A port runs spanning tree only while the switch does. The switch finds edge ports by itself unless told, and BPDU guard shuts down any edge port a BPDU reaches. So with BPDU guard, each port that runs spanning tree says which it is. */
    private static portStp(device: Device, where: string, port: Port): string[] {
        const found: string[] = [];
        const stp = typeof port.stp === "object" ? port.stp : undefined;
        const guarded = stp?.bpdu_guard || stp?.guard;

        if ((port.stp === true || stp) && !guarded && !device.switching?.stp)
            found.push(`${where}.stp, a port runs spanning tree here only with switching.stp`);
        if (stp?.cost !== undefined)
            found.push(`${where}.stp.cost, the platform has a path cost inside the MST region and another outside it`);

        if (!RaisecomRosRender.bpduGuard(device) || port.in_lag || port.stp === false || !RaisecomRosRender.switches(port)) return found;
        if (stp?.edge === undefined)
            found.push(`${where}.stp, BPDU guard shuts down any port the switch finds to be an edge port: write edge: true or false`);
        else if (stp.edge && !stp.bpdu_guard)
            found.push(`${where}.stp without bpdu_guard, the platform guards every edge port or none: write it on each`);

        return found;
    }

    /** Thresholds are in packets per second, one mode for every kind. */
    private static stormControl(where: string, storm: Switched["storm_control"]): string[] {
        if (!storm) return [];

        const found: string[] = [];
        // Raisecom's P200 guide writes `unknown-multicast`, and ROS 6.5.2 takes only `multicast`, so which multicast it limits is not known.
        if (storm.multicast)
            found.push(
                `${where}.storm_control.multicast, it is not known whether the platform limits all multicast or only unknown groups`
            );

        for (const kind of ["broadcast", "unknown_unicast"] as const) {
            const threshold = storm[kind];
            if (!threshold) continue;
            if (!("pps" in threshold)) found.push(`${where}.storm_control.${kind}.percent, the platform takes pps`);
            else if (!RaisecomRosUnsupported.inRange(threshold.pps, RaisecomRosRender.STORM_PPS))
                found.push(
                    `${where}.storm_control.${kind} ${threshold.pps} pps, the platform takes 1 to ${RaisecomRosRender.STORM_PPS.max}`
                );
        }

        return found;
    }

    /** A rate in whole kbit/s up to the port's speed, and a burst in whole kB, 1000 bytes each, up to 4096 kB. A rate alone takes the switch's own burst. */
    private static rateLimit(where: string, rateLimit: RateLimit | undefined, speedKbps?: number): string[] {
        const found: string[] = [];

        for (const direction of ["input", "output"] as const) {
            const limit = rateLimit?.[direction];
            if (!limit) continue;

            const { rate, burst } = Derive.limit(limit);
            const kbps = Derive.bitsPerSecond(rate) / RaisecomRosRender.BITS_PER_KBIT;
            const max = speedKbps ?? RaisecomRosRender.RATE_KBPS_MAX;
            if (!Number.isInteger(kbps)) found.push(`${where}.rate_limit.${direction}, the platform takes a rate in whole kbit/s`);
            else if (kbps > max) found.push(`${where}.rate_limit.${direction} ${rate}, above the port's speed: the platform refuses it`);

            if (burst === undefined) continue;
            const kilobytes = burst / RaisecomRosRender.BYTES_PER_KB;
            if (!Number.isInteger(kilobytes) || !RaisecomRosUnsupported.inRange(kilobytes, RaisecomRosRender.BURST_KB))
                found.push(
                    `${where}.rate_limit.${direction}.bc ${burst}, the platform takes a burst in whole kB of 1000 bytes, 1000 to ${RaisecomRosRender.BURST_KB.max * RaisecomRosRender.BYTES_PER_KB}`
                );
        }

        return found;
    }

    private static routing(device: Device): string[] {
        const found: string[] = [];
        const routing = device.routing;

        for (const field of ["bgp", "isis", "rpki"] as const) {
            if (routing?.[field]) found.push(`routing.${field}`);
        }
        if (routing?.mpls) found.push("routing.mpls, not built yet");
        for (const where of Derive.l3vpn(device)) found.push(`${where}, L3VPN, not built yet`);
        for (const where of Derive.vpls(device)) found.push(`${where}, a VPLS by BGP, not built yet`);

        const ospf = routing?.ospf;
        if (routing?.router_id && !ospf) found.push("routing.router_id without routing.ospf, only OSPF uses it here");
        if (ospf?.address_families?.includes("ipv6")) found.push("routing.ospf.address_families ipv6, OSPF runs for IPv4 here");
        // See TRAPS.md: the switch restarted minutes after a plan removed an OSPF process in a VRF.
        if (ospf?.vrf)
            found.push("routing.ospf.vrf, not built: a RAX721 restarted minutes after one was removed, and the cause is not known");

        for (const [areaId, area] of Object.entries(ospf?.areas ?? {})) {
            const where = `routing.ospf.areas.${areaId}`;
            (area.ranges ?? []).forEach((range, index) => {
                if (Address.family(range.prefix) === "ipv6") found.push(`${where}.ranges[${index}], only IPv4 here`);
                if (range.cost !== undefined) found.push(`${where}.ranges[${index}].cost, the switch has no cost for a range`);
            });
            if (area.virtual_links) found.push(`${where}.virtual_links, ROS 6.5.2 has no virtual link`);

            for (const [name, settings] of Object.entries(area.interfaces)) {
                if (!settings) continue;
                const at = `${where}.interfaces.${name}`;

                if (!RaisecomRosUnsupported.routesHere(device, name))
                    found.push(`${at}, OSPF runs on routed ports, loopbacks, and VLAN interfaces here`);
                if (device.interfaces?.loopback?.[name] && Object.keys(settings).length)
                    found.push(`${at}, a loopback forms no adjacency and takes no OSPF setting here: write {}`);
                if (settings.network === "point-to-multipoint") found.push(`${at}.network point-to-multipoint, the switch has none`);

                const auth = settings.authentication;
                if (auth && auth.algorithm !== "md5")
                    found.push(`${at}.authentication.algorithm ${auth.algorithm}, the switch signs with MD5 alone`);
                if (auth && (auth.key_id < RaisecomRosOspf.KEY_ID.min || auth.key_id > RaisecomRosOspf.KEY_ID.max))
                    found.push(
                        `${at}.authentication.key_id ${auth.key_id}, the switch takes ${RaisecomRosOspf.KEY_ID.min} to ${RaisecomRosOspf.KEY_ID.max}`
                    );
            }
        }

        for (const [name, vrf] of Object.entries(routing?.vrfs ?? {}))
            if (vrf?.description) found.push(`routing.vrfs.${name}.description, the switch has no description for a VRF`);

        for (const route of routing?.static_routes ?? []) {
            const where = `routing.static_routes ${route.prefix}`;

            if (!route.next_hop || Address.family(route.prefix) === "ipv6") {
                found.push(`${where}, only an IPv4 next_hop`);
            }

            if (route.next_hop && route.interface && !RaisecomRosUnsupported.routesThrough(device, route.interface))
                found.push(`${where} interface ${route.interface}, a route here names a routed port or a VLAN interface`);

            if (route.description || route.distance) found.push(`${where} description and distance`);

            if (route.bfd && route.vrf) found.push(`${where} bfd in a VRF, tested in the main table alone`);
            else if (route.bfd && route.next_hop && !RaisecomRosRouting.bfdSessions(device).has(route.next_hop)) {
                found.push(`${where} bfd, the next hop must be on a VLAN interface's network`);
            }
        }

        return found;
    }

    /** Whether an interface routes: a routed port, a loopback, or a VLAN interface. */
    private static routesHere(device: Device, name: string): boolean {
        const port = device.interfaces?.ethernet?.[name];
        return port
            ? RaisecomRosRouting.routes(port)
            : Boolean(device.interfaces?.loopback?.[name] || device.interfaces?.vlan_interface?.[name]);
    }

    /** Whether a route may name the interface after its next hop: a routed port or a VLAN interface. */
    private static routesThrough(device: Device, name: string): boolean {
        const port = device.interfaces?.ethernet?.[name];
        if (port) return RaisecomRosRouting.routes(port);
        return RaisecomRosRouting.routeInterface(device, name) !== undefined;
    }

    private static switching(device: Device): string[] {
        const found: string[] = [];
        const switching = device.switching;

        for (const [name, vlan] of Object.entries(switching?.vlans ?? {})) {
            if (vlan?.description) found.push(`switching.vlans.${name}.description`);
        }

        const lldp = switching?.lldp;
        if (lldp && lldp !== true) {
            const ports = new Set([...Object.keys(device.interfaces?.ethernet ?? {}), ...Object.keys(device.interfaces?.lag ?? {})]);
            for (const name of lldp.interfaces)
                if (!ports.has(name)) found.push(`switching.lldp.interfaces ${name}, LLDP runs on ports and LAGs here`);
        }

        if (switching?.stp?.mode && switching.stp.mode !== "mstp") found.push("switching.stp.mode other than mstp");
        if (switching?.ra_guard) found.push(`switching.ra_guard, ${RaisecomRosUnsupported.RA_GUARD}`);
        for (const { where, settings } of Derive.switchedHolders(device)) {
            if (settings.ra_trusted) found.push(`${where}.ra_trusted, ${RaisecomRosUnsupported.RA_GUARD}`);
            if (settings.bound_to) found.push(`${where}.bound_to, ${RaisecomRosUnsupported.SOURCE_GUARD}`);
        }

        return [...found, ...RaisecomRosSwitching.unsupported(device), ...RaisecomRosAcls.unsupported(device)];
    }

    private static services(device: Device): string[] {
        const found: string[] = [];
        const routing = device.routing;

        // Address sets alone build nothing: `management.allow` may name one, and the project has put its addresses there.
        const { address_sets: _addressSets, ...firewall } = device.firewall ?? {};

        const refusedGroups: [string, unknown][] = [
            ["firewall", Object.keys(firewall).length ? firewall : undefined],
            ["routing.policies", routing?.policies],
            ["routing.prefix_sets", routing?.prefix_sets],
            ["system.hardware_offload", device.system?.hardware_offload],
        ];

        for (const [path, value] of refusedGroups) {
            if (value !== undefined) found.push(path);
        }
        if (device.services?.pppoe_server)
            found.push("services.pppoe_server, Raisecom ROS has no PPPoE server: it only adds PPPoE+ tags as an intermediate agent");
        if (device.firewall?.ipsec) found.push("firewall.ipsec, IPsec: the switch does not encrypt the traffic it forwards");
        if (device.services?.ipsec_remote_access)
            found.push("services.ipsec_remote_access, IPsec: the switch does not encrypt the traffic it forwards");

        // ROS 6.5.2 has no `ip http`, `https`, `web`, `pki`, `crypto`, or `ssl`, and no sFlow, NetFlow, or IPFIX.
        if (device.system?.certificates) found.push("system.certificates, ROS 6.5.2 has no certificate store");
        if (device.monitoring?.flow_export) found.push("monitoring.flow_export, ROS 6.5.2 has no sFlow, NetFlow, or IPFIX");
        found.push(...RaisecomRosServices.unsupported(device));

        const management = device.management ?? {};

        for (const field of ["http", "https"] as const)
            if (management[field]) found.push(`management.${field}, ROS 6.5.2 has no web interface`);
        // NETCONF answers over SSH on port 830, which is neither of these.
        for (const field of ["api", "api_tls"] as const)
            if (management[field])
                found.push(`management.${field}, the switch's API is NETCONF over SSH, which Circuit does not manage yet`);
        for (const field of ["ftp", "native_protocol", "console"] as const) {
            if (management[field]) found.push(`management.${field}`);
        }
        for (const { where } of Derive.serviceVrfs(device)) found.push(where);

        const snmp = device.monitoring?.snmp;

        for (const [name, user] of Object.entries(snmp?.users ?? {})) {
            if (!RaisecomRosRender.SNMP_AUTH[user.auth])
                found.push(`monitoring.snmp.users.${name}.auth ${user.auth}, the platform authenticates with SHA1 or MD5`);
        }

        if (snmp?.contact || snmp?.location) found.push("monitoring.snmp.contact and location");
        if (management.ssh?.weak_crypto) found.push("management.ssh.weak_crypto");

        for (const [name, user] of Object.entries(device.system?.users ?? {})) {
            if (user && user.role !== "admin") found.push(`system.users.${name}.role other than admin`);
            // Raisecom's guide gives a client key a name of its own and no user, and one setting picks password or key logins for every user.
            if (user?.ssh_keys?.length)
                found.push(
                    `system.users.${name}.ssh_keys, a key here belongs to no user, and one setting turns password logins off for all`
                );
        }
        // `user login` picks local users or the servers for every way in at once, at the # prompt, and the guide gives no level for a user a server accepts.
        if (device.system?.aaa)
            found.push(
                "system.aaa, the platform has no setting for the role of a user a server accepts, and its one login setting for every way in was not tried on a switch in service"
            );

        const system = device.system ?? {};
        const services = device.services ?? {};

        if (system.dns || system.logging?.local || system.release_channel || system.banner || services.dns_server) {
            found.push("system.dns, system.logging.local, system.release_channel, system.banner and services.dns_server");
        }
        if (services.dns64) found.push("services.dns64, which needs services.dns_server");
        // The switch answers time queries while it takes time from servers. Its one other way, `ntp refclock-master`, serves its own clock and refuses servers beside it.
        if (services.ntp_server && !system.ntp?.servers.length)
            found.push("services.ntp_server without system.ntp, the switch answers time queries only while it takes time from servers");

        // SNMP takes its own access-list, and SSH and telnet share the management one. A user's keys are refused above, with why.
        found.push(...Derive.switchUnsupported(device, ["snmp"], true));
        // A port bound to hosts is refused in `switching()`, with why.
        found.push(...Derive.untested(device, ["mac-limit", "ethertype-filter", "static-route-bfd", "port-binding"]));
        // A range's cost and virtual links are refused in `routing()`, with why.
        const ospf = ["ospf-ranges", "ospf-range-cost", "ospf-priority", "ospf-unicast-links", "ospf-virtual-links"] as const;
        found.push(...Derive.unbuilt(device, ["rate-limit", "urpf", ...ospf]));
        // Trap receivers are built, in `RaisecomRosServices`.
        found.push(...Derive.unbuiltMonitoring(device).filter((message) => !message.startsWith("monitoring.snmp.traps")));
        // `show sla` lists operations of Ethernet (Y.1731), MPLS, and TWAMP alone.
        for (const name of Object.keys(device.monitoring?.probes ?? {}))
            found.push(
                `monitoring.probes.${name}, ROS 6.5.2 has no ICMP probe: its SLA operations measure Ethernet (Y.1731), MPLS, and TWAMP`
            );

        return found;
    }

    private static inRange(value: number, range: { min: number; max: number }): boolean {
        return Number.isInteger(value) && value >= range.min && value <= range.max;
    }
}
