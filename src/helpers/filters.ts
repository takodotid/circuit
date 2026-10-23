import { Address } from "../core/address";
import type { AclRule, FilterRule, Prefix, TcpFlag } from "../schema";

/** What `Filters.antiAmplification` leaves alone. */
export type AntiAmplificationOptions = {
    /** Prefixes inside the destinations whose UDP fragments pass: for a host that receives UDP too large for one packet, such as SIP or some VPNs. Every fragment after the first is dropped when absent. */
    keep_fragments?: readonly Prefix[];
};

/** Address lists and edge filters: hardware ACL rules and firewall rules for traffic from outside. */
export class Filters {
    /** IPv4 sources that never arrive from the internet: loopback, link-local and "this network", after RFC 6890. */
    static readonly MARTIANS = ["127.0.0.0/8", "169.254.0.0/16", "0.0.0.0/8"] as const satisfies readonly Prefix[];

    /** IPv4 private space, RFC 1918. */
    static readonly PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"] as const satisfies readonly Prefix[];

    /** UDP ports of services that answer a small request with a much larger reply, which attackers use to reflect floods at a victim. A reflected flood arrives from these ports. */
    static readonly AMPLIFIERS = {
        qotd: 17,
        chargen: 19,
        dns: 53,
        portmap: 111,
        ntp: 123,
        netbios: 137,
        snmp: 161,
        cldap: 389,
        slp: 427,
        rip: 520,
        "ms-sql": 1434,
        ssdp: 1900,
        ard: 3283,
        "ws-discovery": 3702,
        mdns: 5353,
        coap: 5683,
        ubiquiti: 10001,
        memcached: 11211,
        dvr: 37810,
    } as const satisfies Record<string, number>;

    /** Of the amplifiers, the services hosts do ask across the internet: resolvers, time servers, monitoring. A reply to a real request goes back to the asking port, 1024 or above, or to the service's own port when two servers talk. */
    private static readonly ASKED: ReadonlySet<number> = new Set([Filters.AMPLIFIERS.dns, Filters.AMPLIFIERS.ntp, Filters.AMPLIFIERS.snmp]);

    /** TCP flag combinations no legitimate packet carries: name, flags set, flags unset. */
    private static readonly BAD_TCP_FLAGS = [
        ["FIN+SYN", ["fin", "syn"], []],
        ["SYN+RST", ["syn", "rst"], []],
        ["FIN+RST", ["fin", "rst"], []],
        ["FIN without ACK", ["fin"], ["ack"]],
        ["FIN+URG", ["fin", "urg"], []],
        ["Xmas scan", ["fin", "syn", "psh", "urg"], []],
    ] as const satisfies readonly (readonly [string, readonly TcpFlag[], readonly TcpFlag[]])[];

    /** Hardware ACL rules dropping traffic arriving on a VLAN from sources that cannot be there: your own space, martians, private ranges. One rule per source. */
    static antiSpoofing<V extends string>(vlan: V, sources: readonly Prefix[]): AclRule<V>[] {
        return sources.map((src) => ({
            description: `${vlan}: drop source ${src}`,
            match: { vlan, src },
            action: "drop",
        }));
    }

    /**
     * Hardware ACL rules dropping reflected UDP floods toward `destinations`, in the switch chip, without limiting anything else.
     *
     * - Replies from an amplifier no host asks across the internet are dropped.
     * - Replies from DNS, NTP and SNMP are dropped only toward a port below 1024 that is not the service's own. A host that runs its own resolver, time server or monitoring keeps its answers. The service's own port passes first, so every drop takes the one range 0 to 1023: a switch chip has few port-range checkers, and on RouterOS a rule past them is invalid with every rule after it.
     * - The fragments after the first carry no port, and a switch chip reads them as port 0. They are dropped, but toward `keep_fragments`.
     */
    static antiAmplification(destinations: readonly Prefix[], options: AntiAmplificationOptions = {}): AclRule<never>[] {
        return destinations.flatMap((dst) => [
            ...(options.keep_fragments ?? [])
                .filter((prefix) => Address.contains(dst, prefix))
                .map((prefix): AclRule<never> => ({
                    description: `UDP fragments to ${prefix} kept`,
                    match: { protocol: "udp", dst: prefix, src_port: 0 },
                    action: "accept",
                })),
            { description: `UDP fragments to ${dst}`, match: { protocol: "udp", dst, src_port: 0 }, action: "drop" },
            ...Object.entries(Filters.AMPLIFIERS).flatMap(([name, port]): AclRule<never>[] =>
                Filters.ASKED.has(port)
                    ? [
                          {
                              description: `UDP to ${dst} from ${name}, between two servers`,
                              match: { protocol: "udp", dst, src_port: port, dst_port: port },
                              action: "accept",
                          },
                          {
                              description: `UDP to ${dst} from ${name}, to a port below 1024`,
                              match: { protocol: "udp", dst, src_port: port, dst_port: { min: 0, max: 1023 } },
                              action: "drop",
                          },
                      ]
                    : [{ description: `UDP to ${dst} from ${name}`, match: { protocol: "udp", dst, src_port: port }, action: "drop" }]
            ),
        ]);
    }

    /** Firewall rules dropping packets with a TCP flag combination no legitimate packet carries, for a forward chain. */
    static badTcpFlags(): FilterRule<never, never>[] {
        return Filters.BAD_TCP_FLAGS.map(([name, set, unset]) => ({
            description: `Bad flags ${name}`,
            match: { protocol: "tcp", tcp_flags: { set, unset } },
            action: "drop",
        }));
    }
}
