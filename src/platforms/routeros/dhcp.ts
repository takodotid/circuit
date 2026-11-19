import { Address } from "../../core/address";
import type { Device } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** DHCP and DHCPv6 servers and relays, added to one device's render. */
export class RouterOsDhcp {
    /** A DHCPv6 server's pool of delegated prefixes is named after the server, with this after it. */
    private static readonly PD_POOL_SUFFIX = "-pd";

    /** A DHCPv6 server's DNS servers are an option named after the server, with this after it. */
    private static readonly DNS_OPTION_SUFFIX = "-dns";

    /** The DHCPv6 option that lists DNS servers (RFC 3646). */
    private static readonly DNS_SERVERS_OPTION = 23;

    static render(render: RouterOsRender, device: Device): void {
        RouterOsDhcp.servers(render, device);
        RouterOsDhcp.relays(render, device);
        RouterOsDhcp.ipv6Servers(render, device);
    }

    /** The one prefix that holds exactly the addresses from the first of `pool` to its last, if there is one. */
    static poolPrefix(pool: readonly [string, string]): string | undefined {
        const [first, last] = pool.map((address) => Address.toNumber(address));
        if (first === null || last === null || first === undefined || last === undefined) return undefined;
        const prefixes = Address.prefixesBetween(first, last, "ipv6");
        return prefixes.length === 1 ? prefixes[0] : undefined;
    }

    private static servers(render: RouterOsRender, device: Device): void {
        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
            const [first, last] = server.pool;
            render.add("/ip pool", "add", { name, ranges: `${first}-${last}` });
            render.add("/ip dhcp-server", "add", {
                "address-pool": name,
                interface: render.name(server.interface),
                "lease-time": server.lease_time ? RouterOsSyntax.duration(server.lease_time) : undefined,
                name,
            });
            render.add("/ip dhcp-server network", "add", {
                address: server.network,
                "dns-server": server.dns?.join(","),
                gateway: server.gateway,
            });

            for (const reservation of server.reservations ?? []) {
                render.add("/ip dhcp-server lease", "add", {
                    address: reservation.address,
                    comment: reservation.description,
                    "mac-address": reservation.mac,
                    server: name,
                });
            }
        }
    }

    /** A relay with servers of both families is a relay in each menu, by one name. */
    private static relays(render: RouterOsRender, device: Device): void {
        for (const [name, relay] of Object.entries(device.services?.dhcp_relay ?? {})) {
            const interfaceName = render.name(relay.interface);
            const ipv4 = relay.servers.filter((server) => Address.family(server) === "ipv4");
            const ipv6 = relay.servers.filter((server) => Address.family(server) === "ipv6");
            if (ipv4.length) render.add("/ip dhcp-relay", "add", { "dhcp-server": ipv4.join(","), interface: interfaceName, name });
            if (ipv6.length) render.add("/ipv6 dhcp-relay", "add", { "dhcp-server": ipv6.join(","), interface: interfaceName, name });
        }
    }

    /** Each server's addresses and delegated prefixes are pools of its own: `<server>` and `<server>-pd`. Its DNS servers are option 23, `<server>-dns`. */
    private static ipv6Servers(render: RouterOsRender, device: Device): void {
        for (const [name, server] of Object.entries(device.services?.dhcpv6_server ?? {})) {
            const delegation = server.prefix_delegation;
            const pdPool = `${name}${RouterOsDhcp.PD_POOL_SUFFIX}`;
            const dnsOption = `${name}${RouterOsDhcp.DNS_OPTION_SUFFIX}`;

            // The platform's pool is one prefix; unsupported() refuses a range that is not.
            const prefix = server.pool && RouterOsDhcp.poolPrefix(server.pool);
            if (prefix) render.add("/ipv6 pool", "add", { name, prefix, "prefix-length": Address.bits("ipv6") });
            if (delegation)
                render.add("/ipv6 pool", "add", { name: pdPool, prefix: delegation.pool, "prefix-length": delegation.prefix_length });
            if (server.dns?.length)
                render.add("/ipv6 dhcp-server option", "add", {
                    code: RouterOsDhcp.DNS_SERVERS_OPTION,
                    name: dnsOption,
                    value: server.dns.map((address) => `'${address}'`).join(""),
                });

            render.add("/ipv6 dhcp-server", "add", {
                "address-pool": prefix && name,
                "dhcp-option": server.dns?.length && dnsOption,
                interface: render.name(server.interface),
                "lease-time": server.lease_time !== undefined && RouterOsSyntax.duration(server.lease_time),
                name,
                "prefix-pool": delegation && pdPool,
            });
        }
    }
}
