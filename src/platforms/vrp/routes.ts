// Static routes on VRP: what they can't do, and where a plan sends the ones through an interface. A CE6855 on V200R005C00SPC800 refused a route through an interface that did not exist yet (TRAPS.md).

import { Address } from "../../core/address";
import type { Device } from "../../model";
import type { Group } from "../line-diff";
import type { Step } from "../platform";
import { VrpRender } from "./render";

export class VrpRoutes {
    /** A static route through an interface, `ip route-static 198.51.100.0 255.255.255.0 Vlanif10 192.0.2.1`. */
    private static readonly THROUGH_INTERFACE =
        /^ip(?:v6)? route-static (?:vpn-instance \S+ )?\S+ \S+ (?:Vlanif|LoopBack|Tunnel|Eth-Trunk|\d+GE)\S+/;

    /** What a static route can't do here. A watched route needs a BFD template for its next hop, from an address of the device's own. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const routes = device.routing?.static_routes ?? [];

        for (const route of routes) {
            if (!route.bfd) continue;

            const where = `routing.static_routes ${route.prefix} bfd`;
            const nextHop = route.next_hop && Address.host(route.next_hop);
            if (route.vrf) found.push(`${where} in a VRF, not tested`);
            else if (route.interface) found.push(`${where} beside interface, not tested`);
            else if (!nextHop || Address.family(nextHop) !== "ipv4") found.push(`${where}, needs an IPv4 next_hop`);
            else if (!VrpRender.localAddressTo(device, nextHop))
                found.push(`${where}, the device has no address on the network of ${nextHop}`);
        }

        for (const [index, route] of routes.entries()) {
            if (route.description && Address.family(Address.split(route.prefix).addr) === "ipv6")
                found.push(`routing.static_routes[${index}].description for IPv6`);
        }

        return found;
    }

    /** The routes through an interface that the top level adds and removes, taken out of it: the switch refuses one until its interface exists. */
    static throughInterfaces(top: Group | undefined): { add: string[]; remove: string[] } {
        if (!top) return { add: [], remove: [] };

        const through = (line: string) => VrpRoutes.THROUGH_INTERFACE.test(line);
        const taken = { add: top.add.filter(through), remove: top.remove.filter(through) };
        top.add = top.add.filter((line) => !through(line));
        top.remove = top.remove.filter((line) => !through(line));
        return taken;
    }

    /** The routes through an interface go once the interfaces exist, and go away before anything else. */
    static place(planned: Step[], through: { add: string[]; remove: string[] }, undo: (line: string) => string): void {
        if (through.remove.length)
            planned.unshift({
                title: "Static routes through interfaces, removed",
                show: through.remove.map((line) => `- ${line}`),
                send: through.remove.map((line) => undo(line)),
            });

        if (!through.add.length) return;

        const interfaces = planned.findLastIndex((step) => step.title.startsWith("interface "));
        const after = interfaces === -1 ? planned.findIndex((step) => step.title === "(top level)") : interfaces;
        const show = through.add.map((line) => `+ ${line}`);
        planned.splice(after + 1, 0, { title: "Static routes through interfaces", show, send: through.add });
    }
}
