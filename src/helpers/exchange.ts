import { Address } from "../core/address";
import type { Check, Finding } from "../core/define";
import type { Ethertype, IP, Port, Prefix } from "../schema";
import { Checks } from "./checks";
import { RouteServerConfig, type RouteServer } from "./route-server";

/** A member of an internet exchange: a network with a port on the fabric and an address on the peering LAN. */
export type ExchangeMember = {
    /** Lowercase, and never reused. */
    name: string;
    asn: number;
    /** The member's port on each fabric switch, by switch name. */
    ports: Readonly<Record<string, string>>;
    /** Its addresses on the peering LAN. The route servers peer with these. */
    ipv4?: IP;
    ipv6?: IP;
};

/** An internet exchange's peering LAN, as its fabric carries it. */
export type InternetExchange<V extends string> = {
    /** The peering VLAN, by the name the fabric switches give it. */
    vlan: V;
    /** The peering LAN's subnets. */
    lan: { ipv4?: Prefix; ipv6?: Prefix };
    /** Addresses on the peering LAN no member may take, such as the route servers'. */
    reserved?: readonly IP[];
    /** How much broadcast, multicast and unknown unicast a member port lets through, in percent of its speed. 1 when absent. */
    storm_percent?: number;
    /** The most MAC addresses a member port learns, usually 1. No limit when absent. No platform renders it yet, so `validate` refuses it. */
    mac_limit?: number;
    /** The only kinds of frame a member port takes in, usually `ipv4`, `ipv6` and `arp`. Every kind when absent. No platform renders it yet, so `validate` refuses it. */
    ethertypes?: readonly Ethertype[];
};

/** An internet exchange's fabric: its member ports, a check of its members, and its route servers' config. */
export class Exchange {
    /**
     * Member ports and a check for an internet exchange's fabric.
     *
     * - `ports(device)`: every member's port on one switch. A member port is in the peering VLAN and nothing else, takes no part in spanning tree or LLDP, and lets only a trickle of broadcast, multicast and unknown unicast through. With `mac_limit` and `ethertypes`, it also learns that many MAC addresses at most and takes in only those kinds of frame.
     * - `check`: members never share a name, an AS, an address or a port; every address is inside the peering LAN and not reserved; every member port carries the peering VLAN alone.
     * - `bird(server)`: one route server's BIRD 2 config, with a session to every member. Write it to a file for the server; Circuit never logs in to a route server.
     */
    static build<const V extends string>(exchange: InternetExchange<V>, members: readonly ExchangeMember[]) {
        const percent = exchange.storm_percent ?? 1;

        const ports = (device: string) => {
            const result: Record<string, Port<V, string, string, string>> = {};

            for (const member of members) {
                const port = member.ports[device];
                if (!port) continue;

                result[port] = {
                    description: `${member.name}, AS${member.asn}`,
                    access_vlan: exchange.vlan,
                    stp: false,
                    lldp: false,
                    storm_control: { broadcast: { percent }, multicast: { percent }, unknown_unicast: { percent } },
                    ...(exchange.mac_limit !== undefined ? { mac_limit: exchange.mac_limit } : {}),
                    ...(exchange.ethertypes ? { ethertypes: exchange.ethertypes } : {}),
                };
            }

            return result;
        };

        const check: Check = (devices) => {
            const findings: Finding[] = [];
            const error = (message: string, device?: string) => findings.push({ level: "error", ...(device ? { device } : {}), message });
            const taken = new Map<string, string>((exchange.reserved ?? []).map((address) => [address, "reserved"]));
            // `ports()` writes one port per name, so a second member on a port would silently replace the first.
            const portHolders = new Map<string, string>();

            members.forEach((member, index) => {
                for (const other of members.slice(index + 1)) {
                    if (other.name === member.name) error(`member ${member.name} is declared twice`);
                    if (other.asn === member.asn) error(`members ${member.name} and ${other.name} share AS${member.asn}`);
                }

                for (const [address, lan] of [
                    [member.ipv4, exchange.lan.ipv4],
                    [member.ipv6, exchange.lan.ipv6],
                ] as const) {
                    if (!address) continue;
                    if (!lan || !Address.contains(lan, address)) error(`${address} of ${member.name} is outside the peering LAN`);

                    const holder = taken.get(address);
                    if (holder) error(`${address} of ${member.name} is already ${holder === "reserved" ? "reserved" : `${holder}'s`}`);
                    taken.set(address, member.name);
                }

                for (const [deviceName, portName] of Object.entries(member.ports)) {
                    const holder = portHolders.get(`${deviceName} ${portName}`);
                    if (holder) error(`port ${portName} is given to both ${holder} and ${member.name}`, deviceName);
                    portHolders.set(`${deviceName} ${portName}`, member.name);

                    const device = devices.find((candidate) => candidate.name === deviceName);
                    const port = device?.ports?.[portName as keyof typeof device.ports];
                    const carried = port ? Checks.vlansOf(port) : [];

                    if (carried.length !== 1 || carried[0] !== exchange.vlan) {
                        error(`port ${portName} of ${member.name} does not carry the peering VLAN alone`, deviceName);
                    }
                }
            });

            return findings;
        };

        const bird = (server: RouteServer) => RouteServerConfig.bird(server, exchange.lan, members);

        return { ports, check, bird };
    }
}
