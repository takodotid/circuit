import type { Device, PppoeServer, RadiusServer } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** PPPoE servers for subscribers, added to one device's render. Each server's address pool and PPP profile are named after it. */
export class RouterOsPppoe {
    /** PPP profiles every RouterOS has, which a server's profile can't be named. */
    private static readonly BUILT_IN_PROFILES = ["default", "default-encryption"];

    /** The RADIUS servers' service for PPP logins. */
    private static readonly SERVICE = "ppp";

    static render(render: RouterOsRender, device: Device): void {
        const servers = RouterOsSyntax.entries(device.services?.pppoe_server);
        const [first] = servers;
        if (!first) return;

        for (const [name, server] of servers) {
            const [low, high] = server.pool;
            render.add("/ip pool", "add", { name, ranges: `${low}-${high}` });
            render.add("/ppp profile", "add", {
                "dns-server": server.dns?.join(","),
                "local-address": server.local_address,
                name,
                "remote-address": name,
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
        const servers = RouterOsSyntax.entries(device.services?.pppoe_server);
        const found: string[] = [];
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
            if (device.services?.dhcp_server?.[name])
                found.push(
                    `services.pppoe_server.${name}, named as services.dhcp_server.${name}: RouterOS names the address pool of each after it. Give each its own name`
                );
            if (RouterOsPppoe.BUILT_IN_PROFILES.includes(name))
                found.push(`services.pppoe_server.${name}, the name of a PPP profile RouterOS has itself: give it another name`);
        }

        return found;
    }

    /** What all PPPoE servers of a router share, in one form for comparing. */
    private static shared(server: PppoeServer): string {
        const radius = (entry: RadiusServer) => [
            entry.address,
            entry.vrf,
            entry.auth_port,
            entry.acct_port,
            entry.source_address,
            "secret" in entry.secret_key ? entry.secret_key.secret : entry.secret_key.secret_file,
        ];
        return JSON.stringify([server.radius.map(radius), server.acct_interim_interval, server.dynamic_authorization ?? false]);
    }
}
