import { Address } from "../core/address";
import type { Family, IPv4, IPv6, Prefix } from "../schema";
import type { ExchangeMember } from "./exchange";

/** A route server on an exchange's peering LAN: a server running BIRD 2 that passes every member's routes to every other member. */
export type RouteServer = {
    /** Its name, such as `rs1`, written at the top of its config. */
    name: string;
    /** Its own AS. Members peer with it, but it never adds itself to a path, so members see each other's paths as they were sent. */
    asn: number;
    /** BIRD's router ID, an IPv4 address of the server. Its address on the peering LAN is the usual pick. */
    router_id: IPv4;
    /** Its IPv4 address on the peering LAN. Every member with an IPv4 address gets an IPv4 session from it. */
    ipv4?: IPv4;
    /** Its IPv6 address on the peering LAN. Every member with an IPv6 address gets an IPv6 session from it. */
    ipv6?: IPv6;
};

/** A route server's config, written from an exchange's member list. Circuit writes the file; it never logs in to the server. */
export class RouteServerConfig {
    /** The shortest and longest prefix a member may send, by family. */
    static readonly LENGTHS: Readonly<Record<Family, { shortest: number; longest: number }>> = {
        ipv4: { shortest: 8, longest: 24 },
        ipv6: { shortest: 12, longest: 48 },
    };

    /**
     * The BIRD 2 config of one route server: one session per member and family, each passing on only the routes the member may send.
     *
     * Throws when the server has no address on the peering LAN, has one outside it, or two members would get sessions of one name.
     */
    static bird(server: RouteServer, lan: { ipv4?: Prefix; ipv6?: Prefix }, members: readonly ExchangeMember[]): string {
        const families = (["ipv4", "ipv6"] as const).filter((family) => server[family]);
        if (!families.length) throw new Error(`route server ${server.name} has no address on the peering LAN`);

        for (const family of families) {
            const prefix = lan[family];
            const address = server[family]!;
            if (!prefix || !Address.contains(prefix, address))
                throw new Error(`${address} of route server ${server.name} is outside the peering LAN`);
        }

        const sessions: string[] = [];
        const names = new Map<string, string>();

        for (const member of members) {
            for (const family of families) {
                const neighbor = member[family];
                if (!neighbor) continue;

                const name = RouteServerConfig.protocolName(member.name, family);
                const holder = names.get(name);
                if (holder) throw new Error(`members ${holder} and ${member.name} would both have session ${name}`);
                names.set(name, member.name);

                sessions.push(RouteServerConfig.session(name, server, member, family, neighbor, lan[family]!));
            }
        }

        const { ipv4, ipv6 } = RouteServerConfig.LENGTHS;
        const header = [
            `# ${server.name}, a route server of the exchange, for BIRD 2.`,
            "# Circuit wrote it from the member list: change the list, not this file.",
            "",
            `router id ${server.router_id};`,
            "",
            "# Learns the server's interfaces and addresses. It sends no route anywhere.",
            "protocol device {",
            "}",
            "",
            "# One session per member and family. A route a member sends is kept only when:",
            "# 1. the first AS in its path is the member's own,",
            "# 2. its next hop is the member's own address on the peering LAN,",
            "# 3. it is not inside the peering LAN,",
            `# 4. it is /${ipv4.shortest} to /${ipv4.longest} long for IPv4, /${ipv6.shortest} to /${ipv6.longest} for IPv6.`,
            "# Every member gets every route the others sent, as they sent it.",
            "# A route that is not kept stays visible: birdc show route filtered.",
        ];

        return [...header, ...sessions.flatMap((session) => ["", session])].join("\n") + "\n";
    }

    /** A BIRD symbol: letters, digits and underscores, starting with a letter. */
    private static protocolName(member: string, family: Family): string {
        const name = `${member.toLowerCase().replace(/[^a-z0-9_]/g, "_")}_${family}`;
        return /^[a-z]/.test(name) ? name : `m_${name}`;
    }

    private static session(
        name: string,
        server: RouteServer,
        member: ExchangeMember,
        family: Family,
        neighbor: string,
        lan: Prefix
    ): string {
        const { shortest, longest } = RouteServerConfig.LENGTHS[family];

        return [
            `protocol bgp ${name} {`,
            `    description "${member.name.replace(/["\\]/g, "")}, AS${member.asn}";`,
            `    local ${server[family]} as ${server.asn};`,
            `    neighbor ${neighbor} as ${member.asn};`,
            "    rs client;",
            `    ${family} {`,
            "        import keep filtered on;",
            "        import filter {",
            `            if bgp_path.first != ${member.asn} then reject;`,
            `            if bgp_next_hop != ${neighbor} then reject;`,
            `            if net ~ [ ${Address.prefixOf(lan)}+ ] then reject;`,
            `            if net.len < ${shortest} || net.len > ${longest} then reject;`,
            "            accept;",
            "        };",
            "        export all;",
            "    };",
            "}",
        ].join("\n");
    }
}
