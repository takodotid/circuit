import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device, PppoeServer } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** PPPoE servers for subscribers and PPPoE clients toward a provider, added to one device's render. Each server's address pools and PPP profile are named after it, and so is the pool of each client's delegated prefix. */
export class RouterOsPppoe {
    /** PPP profiles every RouterOS has, which a server's profile can't be named. */
    private static readonly BUILT_IN_PROFILES = ["default", "default-encryption"];

    /** The RADIUS servers' service for PPP logins. */
    private static readonly SERVICE = "ppp";

    /** A server's pool of delegated prefixes is named after the server, with this after it, as a DHCPv6 server's is. */
    private static readonly PD_POOL_SUFFIX = "-pd";

    /** A server's pool of the /64s its sessions make their addresses in is named after the server, with this after it. */
    private static readonly SLAAC_POOL_SUFFIX = "-slaac";

    /** The length of a prefix hosts make their own addresses in (RFC 4862, with RFC 4291's 64-bit interface IDs). */
    private static readonly SLAAC_PREFIX_LENGTH = 64;

    /** The interface list of the clients that take router advertisements. */
    static readonly SLAAC_LIST = "slaac";

    /** Each client's session, added disabled unless told otherwise (CHR, 7.24.6). It takes no DNS servers from the provider and adds no default route: a static route through it does. */
    static clients(render: RouterOsRender, device: Device): void {
        const clients = RouterOsSyntax.entries(device.interfaces?.pppoe_client);
        for (const [name, client] of clients)
            render.add("/interface pppoe-client", "add", {
                comment: client.description,
                disabled: "no",
                interface: render.name(client.interface),
                "max-mru": client.mtu,
                "max-mtu": client.mtu,
                name,
                password: Secrets.marker(client.password),
                "service-name": client.service_name,
                user: client.user,
            });

        // A router forwards, so it takes router advertisements only with `yes`, and only on the interfaces of a list. A session takes the change when it next comes up (CHR, 7.24.6).
        const slaac = clients.filter(([, client]) => client.slaac).map(([name]) => name);
        if (!slaac.length) return;
        render.add("/interface list", "add", { name: RouterOsPppoe.SLAAC_LIST });
        for (const name of slaac) render.add("/interface list member", "add", { interface: name, list: RouterOsPppoe.SLAAC_LIST });
        render.add("/ipv6 settings", "set", {
            "accept-router-advertisements": "yes",
            "accept-router-advertisements-on": RouterOsPppoe.SLAAC_LIST,
        });
    }

    static render(render: RouterOsRender, device: Device): void {
        RouterOsPppoe.delegation(render, device);

        const servers = RouterOsSyntax.entries(device.services?.pppoe_server);
        const [first] = servers;
        if (!first) return;

        for (const [name, server] of servers) {
            const [low, high] = server.pool;
            const delegation = server.prefix_delegation;
            const pdPool = `${name}${RouterOsPppoe.PD_POOL_SUFFIX}`;
            const slaacPool = `${name}${RouterOsPppoe.SLAAC_POOL_SUFFIX}`;
            render.add("/ip pool", "add", { name, ranges: `${low}-${high}` });
            if (delegation)
                render.add("/ipv6 pool", "add", { name: pdPool, prefix: delegation.pool, "prefix-length": delegation.prefix_length });
            if (server.slaac)
                render.add("/ipv6 pool", "add", {
                    name: slaacPool,
                    prefix: server.slaac.pool,
                    "prefix-length": RouterOsPppoe.SLAAC_PREFIX_LENGTH,
                });
            // A subscriber that asks for a prefix gets one from a DHCPv6 server that each session runs. A session's /64 is a prefix the default ND entry announces on it (CHR, 7.24.6).
            render.add("/ppp profile", "add", {
                "dhcpv6-pd-pool": delegation && pdPool,
                "dns-server": server.dns?.join(","),
                // Each session's interface joins the list while it is up.
                "interface-list": server.interface_set,
                "local-address": server.local_address,
                name,
                "remote-address": name,
                "remote-ipv6-prefix-pool": server.slaac && slaacPool,
            });
            // A server is added disabled unless told otherwise (CHR, 7.24.6).
            for (const iface of server.interfaces)
                render.add("/interface pppoe-server server", "add", {
                    "default-profile": name,
                    disabled: "no",
                    interface: render.name(iface),
                    "max-mru": server.mtu,
                    "max-mtu": server.mtu,
                    "service-name": server.service_name,
                });
        }

        // One setting for every PPP service of the router: unsupported() refuses servers that differ.
        const [, shared] = first;
        render.radius(shared.radius, RouterOsPppoe.SERVICE);
        render.add("/ppp aaa", "set", {
            "interim-update": shared.acct_interim_interval !== undefined && RouterOsSyntax.duration(shared.acct_interim_interval),
            "use-radius": "yes",
        });
        if (shared.dynamic_authorization) render.add("/radius incoming", "set", { accept: "yes", vrf: shared.radius[0]?.vrf });
    }

    static unsupported(device: Device): string[] {
        const found = RouterOsPppoe.poolNames(device);
        const servers = RouterOsSyntax.entries(device.services?.pppoe_server);
        const [first] = servers;
        if (!first) return found;

        const [firstName, firstServer] = first;
        for (const [name, server] of servers.slice(1))
            if (RouterOsPppoe.shared(server) !== RouterOsPppoe.shared(firstServer))
                found.push(
                    `services.pppoe_server.${name}, RouterOS has one RADIUS setting for all its PPPoE servers: write the radius, acct_interim_interval, and dynamic_authorization of services.pppoe_server.${firstName}`
                );

        const vrfs = new Set(firstServer.radius.map((server) => server.vrf ?? "main"));
        if (firstServer.dynamic_authorization && vrfs.size > 1)
            found.push(
                `services.pppoe_server.${firstName}.dynamic_authorization, with RADIUS servers in different VRFs: RouterOS takes their requests in one VRF`
            );

        for (const [name] of servers) {
            for (const group of ["dhcp_server", "dhcpv6_server"] as const)
                if (device.services?.[group]?.[name])
                    found.push(
                        `services.pppoe_server.${name}, named as services.${group}.${name}: RouterOS names the address pool of each after it. Give each its own name`
                    );
            if (RouterOsPppoe.BUILT_IN_PROFILES.includes(name))
                found.push(`services.pppoe_server.${name}, the name of a PPP profile RouterOS has itself: give it another name`);
        }

        return found;
    }

    /** A client that asks for a prefix runs a DHCPv6 client on its session, which keeps the prefix in a pool named after the session. Each interface it goes to takes a /64 of the pool, the pool's own length. Its address there is the last 64 bits as written, as the device prints them back (CHR, 7.24.6). It announces the /64 when it has `ipv6_ra`. */
    private static delegation(render: RouterOsRender, device: Device): void {
        for (const [name, client] of RouterOsSyntax.entries(device.interfaces?.pppoe_client)) {
            const delegation = client.prefix_delegation;
            if (!delegation) continue;

            render.add("/ipv6 dhcp-client", "add", {
                interface: name,
                "pool-name": name,
                // A prefix hint in RFC 5952's spelling, as the export prints it (TRAPS.md), or a prefix-length hint, with `::` for the prefix (RFC 9915 §18.2.1).
                "prefix-hint": delegation.prefix
                    ? Address.canonical(delegation.prefix)
                    : delegation.prefix_length !== undefined && `::/${delegation.prefix_length}`,
                request: "prefix",
                "use-peer-dns": "no",
            });
            for (const [lan, address] of RouterOsSyntax.entries(delegation.interfaces)) {
                const ra = Derive.routerAdvertisement(Derive.settings(device, lan) ?? {});
                render.add("/ipv6 address", "add", {
                    address,
                    advertise: RouterOsSyntax.yesNo(ra && !ra.prefixes),
                    "from-pool": name,
                    interface: render.name(lan),
                });
            }
        }
    }

    /** A client's pool of delegated prefixes takes the client's name, so no other IPv6 pool may have it. */
    private static poolNames(device: Device): string[] {
        const taken = new Map<string, string>();
        for (const [name, server] of RouterOsSyntax.entries(device.services?.dhcpv6_server)) {
            if (server.pool) taken.set(name, `services.dhcpv6_server.${name}`);
            if (server.prefix_delegation) taken.set(`${name}${RouterOsPppoe.PD_POOL_SUFFIX}`, `services.dhcpv6_server.${name}`);
        }
        for (const [name, server] of RouterOsSyntax.entries(device.services?.pppoe_server)) {
            if (server.prefix_delegation) taken.set(`${name}${RouterOsPppoe.PD_POOL_SUFFIX}`, `services.pppoe_server.${name}`);
            if (server.slaac) taken.set(`${name}${RouterOsPppoe.SLAAC_POOL_SUFFIX}`, `services.pppoe_server.${name}`);
        }

        return RouterOsSyntax.entries(device.interfaces?.pppoe_client).flatMap(([name, client]) => {
            const other = client.prefix_delegation && taken.get(name);
            return other
                ? [
                      `interfaces.pppoe_client.${name}, the name of an IPv6 pool of ${other}: RouterOS keeps the delegated prefix in a pool named after the client. Give it another name`,
                  ]
                : [];
        });
    }

    /** What all PPPoE servers of a router share, in one form for comparing. */
    private static shared(server: PppoeServer): string {
        return JSON.stringify([
            RouterOsSyntax.radiusServers(server.radius),
            server.acct_interim_interval,
            server.dynamic_authorization ?? false,
        ]);
    }
}
