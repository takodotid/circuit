// Logins through RADIUS or TACACS+ servers on VRP. The administrators' domain uses schemes of Circuit's own, which check the device's own users first.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, RadiusServer, User } from "../../model";
import { LineDiff } from "../line-diff";
import type { Dialect, Group } from "../line-diff";

/** `system.aaa` on VRP: the servers in a RADIUS server group or an HWTACACS server template, and schemes the administrators' domain uses. Each of them is named `circuit`. */
export class VrpAaa {
    /** The name of Circuit's server group or template, and its schemes. */
    private static readonly NAME = "circuit";

    /** The domain an administrator logs in through when the name has none. It is the switch's own: the switch refuses to remove the administrators' domain while one is online, as Circuit is. */
    private static readonly ADMIN_DOMAIN = "default_admin";

    /** The ports of a RADIUS server when the config sets none, as decision 126 has them. */
    private static readonly RADIUS_PORTS = { auth: 1812, acct: 1813 };

    /** A line of the AAA view that points at the recording scheme: sent after it, and undone first. */
    private static readonly POINTERS = /^cmd recording-scheme /;

    /** The schemes: removed after the domain lets go of them. */
    private static readonly SCHEMES = /^(authentication|authorization|accounting|recording)-scheme /;

    /** The blocks that hold the servers. */
    private static readonly SERVER_BLOCK = /^(radius server group|hwtacacs server template) /;

    /** A server's own line in its block. */
    private static readonly SERVER = /^(radius server (authentication|accounting) |hwtacacs server \d)/;

    /** The servers' block, with the line that turns their protocol on before it. */
    static serverLines(device: Device): string[] {
        const aaa = device.system?.aaa;
        if (!aaa) return [];

        if (aaa.tacacs) {
            const [source] = aaa.tacacs.map((server) => server.source_address).filter(Boolean);
            const servers = aaa.tacacs.map(
                (server, index) =>
                    `hwtacacs server ${server.address} shared-key cipher ${Secrets.marker(server.secret_key)}${VrpAaa.backup(index)}`
            );

            // The template has one source address, which `unsupported()` holds every server to.
            return [
                "hwtacacs enable",
                "#",
                `hwtacacs server template ${VrpAaa.NAME}`,
                ...[
                    ...servers,
                    ...(source ? [`hwtacacs server source-ip ${source}`] : []),
                    "hwtacacs server user-name domain-excluded",
                ].map((line) => ` ${line}`),
                "#",
            ];
        }

        const servers = aaa.radius ?? [];
        const accounting = aaa.accounting_events?.includes("login") ?? false;
        const lines = [
            ...servers.map((server, index) =>
                VrpAaa.radiusLine("authentication", server, server.auth_port ?? VrpAaa.RADIUS_PORTS.auth, index)
            ),
            ...(accounting
                ? servers.map((server, index) =>
                      VrpAaa.radiusLine("accounting", server, server.acct_port ?? VrpAaa.RADIUS_PORTS.acct, index)
                  )
                : []),
            // The server is sent the name the user typed, without the domain the switch would add.
            "radius server user-name domain-excluded",
        ];

        return ["radius enable", "#", `radius server group ${VrpAaa.NAME}`, ...lines.map((line) => ` ${line}`), "#"];
    }

    /**
     * The schemes and the administrators' domain, as lines of the AAA view. Authentication checks the device's own users first: a name it has logs in with its password, and any other goes to the servers.
     */
    static schemeLines(device: Device, levels: Readonly<Record<User["role"], number>>): string[] {
        const aaa = device.system?.aaa;
        if (!aaa) return [];

        const name = VrpAaa.NAME;
        const method = aaa.tacacs ? "hwtacacs" : "radius";
        const events = aaa.accounting_events ?? [];
        const commands = method === "hwtacacs" && events.includes("command");
        const lines = [`authentication-scheme ${name}`, ` authentication-mode local ${method}`];

        // A user a TACACS+ server accepts is authorized by it. A user the switch has is authorized by the switch, and when the server does not answer, a user it accepted keeps the domain's level.
        if (method === "hwtacacs") lines.push(`authorization-scheme ${name}`, " authorization-mode local hwtacacs if-authenticated");
        if (events.includes("login")) lines.push(`accounting-scheme ${name}`, ` accounting-mode ${method}`);
        if (commands) lines.push(`recording-scheme ${name}`, ` recording-mode hwtacacs ${name}`);

        lines.push(
            `domain ${VrpAaa.ADMIN_DOMAIN}`,
            ` authentication-scheme ${name}`,
            ...(method === "hwtacacs" ? [` authorization-scheme ${name}`] : []),
            ...(events.includes("login") ? [` accounting-scheme ${name}`] : []),
            method === "hwtacacs" ? ` hwtacacs server ${name}` : ` radius server group ${name}`,
            // The level of a user a server accepts, unless the server sends one.
            ` adminuser-priority ${levels[aaa.remote_role]}`
        );

        if (commands) lines.push(`cmd recording-scheme ${name}`);
        return lines;
    }

    /** What the platform can't express: command accounting over RADIUS, TACACS+ servers sending from different addresses, and IPv6 servers, which are not tested. */
    static unsupported(device: Device): string[] {
        const aaa = device.system?.aaa;
        if (!aaa) return [];

        const found: string[] = [];
        const kind = aaa.tacacs ? "tacacs" : "radius";
        const servers: readonly RadiusServer[] = aaa.tacacs ?? aaa.radius ?? [];

        if (kind === "radius" && aaa.accounting_events?.includes("command"))
            found.push("system.aaa.accounting_events command, the platform records commands through TACACS+ only");
        if (kind === "tacacs" && new Set(servers.map((server) => server.source_address)).size > 1)
            found.push("system.aaa.tacacs source_address, the platform sends to every server from one address: write the same on each");

        servers.forEach((server, index) => {
            if (Address.family(server.address) === "ipv6") found.push(`system.aaa.${kind}[${index}].address, IPv6 is not tested`);
        });

        return found;
    }

    /**
     * A plan that changes AAA: what points at the recording scheme is undone first and sent last, and a scheme goes once the domain lets go of it. The switch keeps its administrators' domain, so what the domain was given is undone instead. A server that changes sends every server of its block again, in order, as the switch asks them in the order they were added.
     */
    static order(groups: Group[], desired: string, current: string, dialect: Dialect): void {
        const aaa = groups.find((group) => group.path.length === 1 && group.path[0] === "aaa");

        if (aaa) {
            const domain = `domain ${VrpAaa.ADMIN_DOMAIN}`;
            const undoneFirst = aaa.remove.filter((line) => VrpAaa.POINTERS.test(line));
            const sentLast = aaa.add.filter((line) => VrpAaa.POINTERS.test(line));
            const removedLast = aaa.remove.filter((line) => VrpAaa.SCHEMES.test(line));
            const given = aaa.remove.includes(domain)
                ? LineDiff.entries(current, dialect)
                      .filter((entry) => entry.path.join(" > ") === `aaa > ${domain}`)
                      .map((entry) => entry.line)
                      .reverse()
                : [];

            aaa.remove = aaa.remove.filter((line) => line !== domain && !undoneFirst.includes(line) && !removedLast.includes(line));
            aaa.add = aaa.add.filter((line) => !sentLast.includes(line));
            if (undoneFirst.length) groups.unshift({ path: ["aaa"], remove: undoneFirst, add: [] });
            if (given.length) groups.push({ path: ["aaa", domain], remove: given, add: [] });
            if (sentLast.length || removedLast.length) groups.push({ path: ["aaa"], remove: removedLast, add: sentLast });
        }

        for (const group of groups) {
            const header = group.path[0] ?? "";
            if (group.path.length !== 1 || !VrpAaa.SERVER_BLOCK.test(header)) continue;
            if (![...group.add, ...group.remove].some((line) => VrpAaa.SERVER.test(line))) continue;

            const servers = (text: string) =>
                LineDiff.entries(text, dialect)
                    .filter((entry) => entry.path.length === 1 && entry.path[0] === header && VrpAaa.SERVER.test(entry.line))
                    .map((entry) => entry.line);
            // A secondary server goes before the primary, whose undo takes no address.
            const had = servers(current).sort((a, b) => Number(b.endsWith(" secondary")) - Number(a.endsWith(" secondary")));

            group.remove = [...group.remove.filter((line) => !VrpAaa.SERVER.test(line)), ...had];
            group.add = [...servers(desired), ...group.add.filter((line) => !VrpAaa.SERVER.test(line))];
        }
    }

    /** A server's undo: a secondary by its address, port, VRF, source, and `secondary`, without its key. A primary RADIUS server by its kind alone. */
    static undo(line: string): string | undefined {
        const radius =
            /^radius server (authentication|accounting) (\S+ \d+(?: vpn-instance \S+)?(?: source ip-address \S+)?) shared-key-cipher \S+( secondary)?$/.exec(
                line
            );
        if (radius) return radius[3] ? `undo radius server ${radius[1]} ${radius[2]} secondary` : `undo radius server ${radius[1]}`;

        const tacacs = /^hwtacacs server (\S+(?: \d+)?) shared-key cipher \S+( secondary)?$/.exec(line);
        if (tacacs) return `undo hwtacacs server ${tacacs[1]}${tacacs[2] ?? ""}`;

        return undefined;
    }

    private static radiusLine(kind: "authentication" | "accounting", server: RadiusServer, port: number, index: number): string {
        const vrf = server.vrf ? ` vpn-instance ${server.vrf}` : "";
        const source = server.source_address ? ` source ip-address ${server.source_address}` : "";
        return `radius server ${kind} ${server.address} ${port}${vrf}${source} shared-key-cipher ${Secrets.marker(server.secret_key)}${VrpAaa.backup(index)}`;
    }

    /** The first server is the primary, and the rest are asked after it, in order. */
    private static backup(index: number): string {
        return index ? " secondary" : "";
    }
}
