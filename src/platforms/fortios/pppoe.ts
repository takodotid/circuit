// A PPPoE client is an entry of its VDOM's `system pppoe-interface`, over the port, aggregate, or VLAN interface it runs on. The entry makes a global interface of its own name, `mode pppoe` and `type tunnel`, as a tunnel's table does (TRAPS.md).

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, PppoeClient } from "../../model";
import { FortiOsNames } from "./names";
import type { FortiOsNode } from "./tree";
import { FortiOsTree } from "./tree";
import { FortiOsVdoms } from "./vdoms";

export class FortiOsPppoe {
    /** The table of PPPoE clients, one per VDOM. */
    static readonly SECTION = "system pppoe-interface";

    static clients(device: Device): [string, PppoeClient][] {
        return Object.entries(device.interfaces?.pppoe_client ?? {}).flatMap(([name, client]) => (client ? [[name, client]] : []));
    }

    /**
     * Each client's entry, and the interface it makes, which takes no default route from the server: a static route does. IPv6 runs on the session only with `ipv6 enable`, and SLAAC is the interface's `autoconf`. Returns the interfaces, for the settings every interface takes.
     */
    static render(sessions: FortiOsNode, interfaces: FortiOsNode, device: Device): FortiOsNode[] {
        return FortiOsPppoe.clients(device).map(([name, client]) => {
            const carrier = FortiOsTree.quote(FortiOsNames.of(device, client.interface));
            const session = sessions.entry(name);
            if (client.slaac) session.set("ipv6", "enable");
            session
                .set("device", carrier)
                .set("username", FortiOsTree.quote(client.user))
                .set("password", FortiOsTree.quote(Secrets.marker(client.password)));
            if (client.service_name) session.set("service-name", FortiOsTree.quote(client.service_name));

            const entry = interfaces.entry(name).set("vdom", FortiOsTree.quote(FortiOsVdoms.of(device, name)));
            const vrf = FortiOsNames.vrfNumber(device, client.vrf);
            if (vrf) entry.set("vrf", vrf);
            entry.set("mode", "pppoe").set("type", "tunnel");
            if (client.description) entry.set("description", FortiOsTree.quote(client.description));
            if (client.slaac) entry.block("ipv6").set("autoconf", "enable");
            return entry.set("defaultgw", "disable").set("interface", carrier);
        });
    }

    /**
     * A PPPoE interface's IPv6 settings exist only while its entry has `ipv6 enable`. Without it, `config ipv6` is `command parse error`, and `show` hides them though the device keeps them (TRAPS.md). So where the config has no IPv6 on a session, the plan leaves them alone, and turns IPv6 off on the entry alone. The entry is a VDOM's and the interface global, so this sees the whole device.
     */
    static hideIpv6(want: FortiOsNode, have: FortiOsNode): void {
        const interfaces = have.blocks.get("system interface");
        if (!interfaces) return;

        for (const [key, sessions] of want.blocks) {
            if (FortiOsVdoms.scopeOf(key).section !== FortiOsPppoe.SECTION) continue;
            for (const [name, { block }] of sessions.entries)
                if (block.settings.get("ipv6") !== "enable") interfaces.entries.get(name)?.block.blocks.delete("ipv6");
        }
    }

    static gaps(device: Device): string[] {
        const found: string[] = [];
        const management = FortiOsVdoms.managementOf(device);

        for (const [name, client] of FortiOsPppoe.clients(device)) {
            const where = `interfaces.pppoe_client.${name}`;
            if (client.mtu !== undefined)
                found.push(`${where}.mtu, FortiOS's PPPoE interface takes no MTU: \`set mtu\` is \`command parse error\``);
            if (client.prefix_delegation)
                found.push(
                    `${where}.prefix_delegation, not built for FortiOS: it gives an interface a /64 of a delegated prefix only by the /64's place in the prefix, \`ip6-subnet\`, which the config doesn't write`
                );
            for (const carrier of [name, client.interface])
                if (management && FortiOsVdoms.of(device, carrier) === management)
                    found.push(`${where}, ${carrier} in system.vdoms.management: a PPPoE client goes in root`);
        }

        // The device takes no IPv6 route through a PPPoE interface, with IPv6 on the session or without: `entry not found in datasource` (TRAPS.md).
        for (const route of device.routing?.static_routes ?? [])
            if (
                route.interface &&
                device.interfaces?.pppoe_client?.[route.interface] &&
                Address.family(Address.split(route.prefix).addr) === "ipv6"
            )
                found.push(
                    `routing.static_routes ${route.prefix}, through interfaces.pppoe_client.${route.interface}: FortiOS 6.2 takes no IPv6 route through a PPPoE interface`
                );

        return found;
    }
}
