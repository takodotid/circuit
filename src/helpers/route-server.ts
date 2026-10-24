import { Address } from "../core/address";
import type { Family, IPv4, IPv6, Prefix } from "../schema";
import type { ExchangeMember } from "./exchange";

/** A route server on an exchange's peering LAN: a server running BIRD 2 or OpenBGPD that passes every member's routes to every other member. */
export type RouteServer = {
    /** Its name, such as `rs1`, written at the top of its config. */
    name: string;
    /** Its own AS. Members peer with it, but it never adds itself to a path, so members see each other's paths as they were sent. */
    asn: number;
    /** Its BGP router ID, an IPv4 address of the server. Its address on the peering LAN is the usual pick. */
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

    /** The rules a route must pass, the same in every config. */
    private static readonly RULES = [
        "# 1. the first AS in its path is the member's own,",
        "# 2. its next hop is the member's own address on the peering LAN,",
        "# 3. it is not inside the peering LAN,",
        `# 4. it is /${RouteServerConfig.LENGTHS.ipv4.shortest} to /${RouteServerConfig.LENGTHS.ipv4.longest} long for IPv4, /${RouteServerConfig.LENGTHS.ipv6.shortest} to /${RouteServerConfig.LENGTHS.ipv6.longest} for IPv6.`,
    ];

    /**
     * The BIRD 2 config of one route server: one session per member and family, each passing on only the routes the member may send.
     *
     * Throws when the server has no address on the peering LAN, has one outside it, or two members would get sessions of one name.
     */
    static bird(server: RouteServer, lan: { ipv4?: Prefix; ipv6?: Prefix }, members: readonly ExchangeMember[]): string {
        const families = RouteServerConfig.families(server, lan);
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

                sessions.push(RouteServerConfig.birdSession(name, server, member, family, neighbor, lan[family]!));
            }
        }

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
            ...RouteServerConfig.RULES,
            "# Every member gets every route the others sent, as they sent it.",
            "# A route that is not kept stays visible: birdc show route filtered.",
        ];

        return [...header, ...sessions.flatMap((session) => ["", session])].join("\n") + "\n";
    }

    /**
     * The OpenBGPD config (`bgpd.conf`) of one route server: one session per member and family, in one group per family, and filter rules that pass on only the routes each member may send.
     *
     * Throws when the server has no address on the peering LAN, or has one outside it.
     */
    static openbgpd(server: RouteServer, lan: { ipv4?: Prefix; ipv6?: Prefix }, members: readonly ExchangeMember[]): string {
        const families = RouteServerConfig.families(server, lan).filter((family) => members.some((member) => member[family]));

        const lines = [
            `# ${server.name}, a route server of the exchange, for OpenBGPD.`,
            "# Circuit wrote it from the member list: change the list, not this file.",
            "",
            `AS ${server.asn}`,
            `router-id ${server.router_id}`,
            "",
            "# The server passes routes on and carries no traffic, so it keeps them out of its own routing table.",
            "fib-update no",
            "",
            "# Members see each other's paths as they were sent: the server never adds its own AS, and passes MED and communities on untouched.",
            "transparent-as yes",
            "",
            "# A route that is not kept stays visible: bgpctl show rib filtered.",
            "rde rib Loc-RIB include filtered",
        ];

        for (const family of families) {
            lines.push("", ...RouteServerConfig.openbgpdGroup(server, family, members));
        }

        lines.push("", "# A route a member sends is kept only when:", ...RouteServerConfig.RULES);
        lines.push("# The last rule a route matches decides, and a route no rule allows is dropped.");

        for (const family of families) {
            const { shortest, longest } = RouteServerConfig.LENGTHS[family];
            const any = family === "ipv4" ? "0.0.0.0/0" : "::/0";

            // `prefixlen 8-24` without spaces is a syntax error in bgpd 9.1, though its manual shows it.
            lines.push(
                `allow from group "${family} members" peer-as neighbor-as nexthop neighbor prefix ${any} prefixlen ${shortest} - ${longest}`
            );
        }

        for (const family of families) {
            lines.push(`deny from any prefix ${Address.prefixOf(lan[family]!)} or-longer`);
        }

        lines.push("", "# Every member gets every route the others sent, as they sent it.", "allow to any");

        return lines.join("\n") + "\n";
    }

    /** The families the server has an address in, each checked to be inside the peering LAN. */
    private static families(server: RouteServer, lan: { ipv4?: Prefix; ipv6?: Prefix }): Family[] {
        const families = (["ipv4", "ipv6"] as const).filter((family) => server[family]);
        if (!families.length) throw new Error(`route server ${server.name} has no address on the peering LAN`);

        for (const family of families) {
            const prefix = lan[family];
            const address = server[family]!;
            if (!prefix || !Address.contains(prefix, address))
                throw new Error(`${address} of route server ${server.name} is outside the peering LAN`);
        }

        return families;
    }

    /** A BIRD symbol: letters, digits and underscores, starting with a letter. */
    private static protocolName(member: string, family: Family): string {
        const name = `${member.toLowerCase().replace(/[^a-z0-9_]/g, "_")}_${family}`;
        return /^[a-z]/.test(name) ? name : `m_${name}`;
    }

    /** A member's name and AS, safe inside double quotes. */
    private static description(member: ExchangeMember): string {
        return `"${member.name.replace(/["\\]/g, "")}, AS${member.asn}"`;
    }

    private static birdSession(
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
            `    description ${RouteServerConfig.description(member)};`,
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

    /** One family's sessions: a group holding every member with an address in that family. */
    private static openbgpdGroup(server: RouteServer, family: Family, members: readonly ExchangeMember[]): string[] {
        const lines = [
            `# One session per member with an ${family === "ipv4" ? "IPv4" : "IPv6"} address.`,
            `group "${family} members" {`,
            `    local-address ${server[family]}`,
            "    # A route whose first AS is not the member's own is dropped by the rules below. The default would close the whole session.",
            "    enforce neighbor-as no",
        ];

        for (const member of members) {
            const neighbor = member[family];
            if (!neighbor) continue;

            lines.push(
                `    neighbor ${neighbor} {`,
                `        remote-as ${member.asn}`,
                `        descr ${RouteServerConfig.description(member)}`,
                "    }"
            );
        }

        lines.push("}");

        return lines;
    }
}
