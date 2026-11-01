// What it takes to turn the configuration a FortiGate prints into the one the render holds.
//
// A setting the render holds is set; one only the device holds is unset, which returns it to its default. A table entry only the device holds is deleted, except one the factory put there. Deletions of whole entries run last, in the reverse of the render's order, so an address goes only after the policies that named it.

import type { ApplyOptions, Plan, Step } from "../platform";
import { FortiOsRouting } from "./routing";
import { type Entry, FortiOsBlock, FortiOsTree } from "./tree";

/** How the plan treats the entries of one table. */
type Table = {
    /** Entries the factory holds. The plan neither reads nor removes them. */
    factory?: readonly string[];
    /** The device keeps the entries in an order of their own, which `move` changes. */
    ordered?: true;
    /**
     * The render numbers the entries by their place, but on the device each keeps the number it was created with. An entry is known by what it holds, or else by the settings of the first of `keys` that only it holds, such as its description. A new entry takes a number the device does not use, after `prefix` when the render names entries so.
     */
    numbered?: { keys: readonly (readonly string[])[]; prefix?: string };
    /** An entry is known by what it holds, not by its number. */
    byContent?: true;
    /** Settings the device gives an entry it creates. They are unset when the render does not hold them. */
    created?: (entry: FortiOsBlock) => readonly string[];
    /** Settings an entry keeps for life. A change deletes the entry and creates it again. */
    fixed?: readonly string[];
    /** Every entry that changes or goes is deleted before any is created. The device refuses a static route the same as another, `Duplicated entry`, even for a moment. */
    distinct?: true;
};

/** What a comparison needs to know beyond the blocks: the section it is in, and whether to send every secret. */
type Context = { section: string; secrets: boolean };

/** What one block's comparison sends and what a reviewer reads, then the entries it deletes and their lines for the reviewer. */
type Diff = { send: string[]; show: string[]; removals: string[]; removed: string[] };

/** What changes before anything else: interfaces freed, LAGs that let some ports go, and the ports of LAGs that go, changed after everything else. */
type Release = { freed: Set<string>; gone: Set<string>; trims: { id: string; members: string[] }[]; deferred: Set<string> };

export class FortiOsPlan {
    /** Objects every FortiGate running 6.2 is shipped with, which policies and profiles of the factory name. */
    private static readonly FACTORY_ADDRESSES = [
        "none",
        "login.microsoftonline.com",
        "login.microsoft.com",
        "login.windows.net",
        "gmail.com",
        "wildcard.google.com",
        "wildcard.dropbox.com",
        "all",
        "FIREWALL_AUTH_PORTAL_ADDRESS",
        "FABRIC_DEVICE",
        "SSLVPN_TUNNEL_ADDR1",
    ];

    private static readonly FACTORY_SERVICES = [
        "ALL",
        "ALL_TCP",
        "ALL_UDP",
        "ALL_ICMP",
        "ALL_ICMP6",
        "GRE",
        "AH",
        "ESP",
        "AOL",
        "BGP",
        "DHCP",
        "DNS",
        "FINGER",
        "FTP",
        "FTP_GET",
        "FTP_PUT",
        "GOPHER",
        "H323",
        "HTTP",
        "HTTPS",
        "IKE",
        "IMAP",
        "IMAPS",
        "Internet-Locator-Service",
        "IRC",
        "L2TP",
        "LDAP",
        "NetMeeting",
        "NFS",
        "NNTP",
        "NTP",
        "OSPF",
        "PC-Anywhere",
        "PING",
        "TIMESTAMP",
        "INFO_REQUEST",
        "INFO_ADDRESS",
        "ONC-RPC",
        "DCE-RPC",
        "POP3",
        "POP3S",
        "PPTP",
        "QUAKE",
        "RAUDIO",
        "REXEC",
        "RIP",
        "RLOGIN",
        "RSH",
        "SCCP",
        "SIP",
        "SIP-MSNmessenger",
        "SAMBA",
        "SMTP",
        "SMTPS",
        "SNMP",
        "SSH",
        "SYSLOG",
        "TALK",
        "TELNET",
        "TFTP",
        "MGCP",
        "UUCP",
        "VDOLIVE",
        "WAIS",
        "WINFRAME",
        "X-WINDOWS",
        "PING6",
        "MS-SQL",
        "MYSQL",
        "RDP",
        "VNC",
        "DHCP6",
        "SQUID",
        "SOCKS",
        "WINS",
        "RADIUS",
        "RADIUS-OLD",
        "CVSPSERVER",
        "AFS3",
        "TRACEROUTE",
        "RTSP",
        "MMS",
        "KERBEROS",
        "LDAP_UDP",
        "SMB",
        "NONE",
        "webproxy",
    ];

    /** The device's own certificates, which the factory makes for each device. */
    private static readonly FACTORY_CERTIFICATES = [
        "Fortinet_CA_SSL",
        "Fortinet_CA_Untrusted",
        "Fortinet_SSL",
        "Fortinet_SSL_RSA1024",
        "Fortinet_SSL_RSA2048",
        "Fortinet_SSL_RSA4096",
        "Fortinet_SSL_DSA1024",
        "Fortinet_SSL_DSA2048",
        "Fortinet_SSL_ECDSA256",
        "Fortinet_SSL_ECDSA384",
        "Fortinet_SSL_ECDSA521",
        "Fortinet_SSL_ED25519",
        "Fortinet_SSL_ED448",
    ];

    /** An entry known by what it holds, or else by its description. */
    private static readonly BY_COMMENTS: Table["numbered"] = { keys: [["comments"]] };

    private static readonly ORDERED: Table = { ordered: true, numbered: FortiOsPlan.BY_COMMENTS };

    /** A static route known by what it holds, or else by its description. Many routes share a destination, so that is no key. */
    private static readonly ROUTES: Table = { numbered: { keys: [["comment"]] }, distinct: true };

    /** Tables whose entries need more than a plain comparison, by section. */
    private static readonly TABLES: Record<string, Table> = {
        // A new aggregate comes with device identification and LLDP of its own, a new VLAN interface, which names no type, with device identification and a role.
        "system interface": {
            factory: ["modem", "ssl.root"],
            created: (entry) => {
                if (entry.settings.get("type") === "aggregate") return ["device-identification", "lldp-transmission"];
                if (entry.settings.has("interface") && !entry.settings.has("type")) return ["device-identification", "role"];
                return [];
            },
            fixed: ["type", "interface"],
        },
        "system accprofile": { factory: ["prof_admin"] },
        "vpn certificate local": { factory: FortiOsPlan.FACTORY_CERTIFICATES },
        "system session-helper": { byContent: true },
        "firewall address": { factory: FortiOsPlan.FACTORY_ADDRESSES },
        "firewall address6": { factory: ["SSLVPN_TUNNEL_IPv6_ADDR1", "all", "none"] },
        "firewall addrgrp": { factory: ["G Suite", "Microsoft Office 365"] },
        "firewall service custom": { factory: FortiOsPlan.FACTORY_SERVICES },
        "firewall policy": FortiOsPlan.ORDERED,
        "firewall policy6": FortiOsPlan.ORDERED,
        "firewall local-in-policy": FortiOsPlan.ORDERED,
        "firewall local-in-policy6": FortiOsPlan.ORDERED,
        "firewall central-snat-map": FortiOsPlan.ORDERED,
        "firewall acl": { numbered: FortiOsPlan.BY_COMMENTS },
        "firewall acl6": { numbered: FortiOsPlan.BY_COMMENTS },
        // A virtual IP that changes is also known by the address it answers on.
        "firewall vip": { numbered: { keys: [["comment"], ["extintf", "extip", "protocol", "extport"]], prefix: "dnat-" } },
        "router static": FortiOsPlan.ROUTES,
        "router static6": FortiOsPlan.ROUTES,
    };

    /** Settings the device keeps for itself: an object's UUID and an interface's SNMP index. */
    private static readonly IGNORED = new Set(["uuid", "snmp-index"]);

    /** Settings of one section the device keeps for itself: how changes are saved, which `apply` sets while it works, and the alias it gives itself at every start. */
    private static readonly IGNORED_IN: Record<string, readonly string[]> = {
        "system global": ["cfg-save", "cfg-revert-timeout", "alias"],
    };

    /** In a certificate's entry, the settings that matter: its text and its key. The device prints others it decides for itself. */
    private static readonly KEPT: Record<string, readonly string[]> = {
        "vpn certificate local": ["certificate", "private-key"],
        "vpn certificate ca": ["ca"],
    };

    /** A policy denies unless told otherwise. */
    private static readonly DENY = { action: "deny" };

    /** Defaults the device does not print, by section. A config may state one, such as SSH on port 22, and the render states some because other settings appear only once they hold: a DHCP server's resolvers show only while it names them itself, and a policy answers a denied sender only while it denies. */
    private static readonly DEFAULTS: Record<string, Record<string, string>> = {
        "system global": {
            "admin-ssh-port": "22",
            "admin-sport": "443",
            "admin-port": "80",
            "admin-telnet-port": "23",
            "admin-ssh-grace-time": "120",
        },
        "system settings": { "bfd-desired-min-tx": "250", "bfd-required-min-rx": "250", "bfd-detect-mult": "3" },
        "system interface": { mtu: "1500" },
        "system snmp community": { "query-v2c-port": "161" },
        "system snmp user": { "query-port": "161" },
        "system dhcp server": { "dns-service": "specify" },
        "firewall policy": FortiOsPlan.DENY,
        "firewall policy6": FortiOsPlan.DENY,
        "firewall local-in-policy": FortiOsPlan.DENY,
        "firewall local-in-policy6": FortiOsPlan.DENY,
    };

    /** Settings whose value is a secret wherever they appear, such as a certificate's key, which the device prints encrypted. */
    private static readonly SECRET_KEYS = new Set(["private-key"]);

    /** Settings holding a certificate's text, compared without its line breaks. */
    private static readonly CERTIFICATES = new Set(["certificate", "ca"]);

    /** Settings undone before a nested list is deleted. Any other goes after it. */
    private static readonly FIRST = new Set(["ntpsync"]);

    /** Settings holding a list in no particular order. */
    private static readonly LISTS = new Set([
        "allowaccess",
        "ip6-allowaccess",
        "member",
        "srcintf",
        "dstintf",
        "srcaddr",
        "dstaddr",
        "service",
        "src-filter",
        "dhcp-relay-ip",
    ]);

    /** Settings that name an interface: an entry's own, or a list a section holds, such as OSPF's passive interfaces or the interfaces NTP answers on. */
    private static readonly NAMES_INTERFACE = new Set([
        "device",
        "interface",
        "srcintf",
        "dstintf",
        "intf",
        "extintf",
        "update-source",
        "passive-interface",
    ]);

    /** Tables whose entries are named after an interface, so that releasing the interface deletes its entry: `The vxlan device is currently used` otherwise. */
    private static readonly KEYED_BY_INTERFACE = new Set(["system dns-server"]);

    /** The tables whose entries are interfaces, so that releasing one frees what names it. */
    private static readonly INTERFACE_TABLES = new Set(["system interface", "system gre-tunnel", "system vxlan"]);

    /**
     * Lists of interfaces that exist only while a setting is on, by the list. NTP serves only on interfaces it names, so its list cannot be emptied while it serves, `There aren't any interfaces with NTP server enabled`; turning it off hides the list and lets go of them.
     */
    private static readonly HELD_BY: Record<string, string> = { interface: "server-mode" };

    /** The interfaces of tunnels, which their own tables create, compared after those tables as a section of their own. */
    private static readonly TUNNELS = "system interface, tunnels";

    /** A value that is a secret: a marker in the render, a cipher or a redaction in the read. */
    private static isSecret(value: string): boolean {
        return /<secret:|<redacted>/.test(value) || value.startsWith("ENC ");
    }

    /** A value in the form both sides compare in: words without quotes, a secret as one word, a list sorted. */
    private static canonical(key: string, value: string): string {
        if (value === FortiOsTree.UNSET) return FortiOsTree.UNSET;
        if (FortiOsPlan.isSecret(value) || FortiOsPlan.SECRET_KEYS.has(key)) return "<secret>";
        if (FortiOsPlan.CERTIFICATES.has(key)) return FortiOsTree.bare(value).replace(/\s+/g, "");

        const words = FortiOsTree.words(value).map(FortiOsTree.bare);
        return (FortiOsPlan.LISTS.has(key) ? words.sort() : words).join(" ");
    }

    /** Whether an entry changes a setting it keeps for life, so it must be created again. */
    private static changesFixed(table: Table | undefined, before: FortiOsBlock, after: FortiOsBlock): boolean {
        const value = (block: FortiOsBlock, key: string) => FortiOsPlan.canonical(key, block.settings.get(key) ?? "");
        return (table?.fixed ?? []).some((key) => value(before, key) !== value(after, key));
    }

    /** Whether the device holds an entry the plan leaves alone. */
    private static isFactory(table: Table | undefined, entry: Entry): boolean {
        return table?.factory?.includes(FortiOsTree.bare(entry.id)) ?? false;
    }

    /** The configuration as the plan reads it: factory entries and the device's own settings left out. */
    static clean(text: string): string {
        const root = FortiOsTree.parse(text);

        for (const [section, block] of root.blocks) {
            const table = FortiOsPlan.TABLES[section];

            for (const [key, entry] of block.entries) if (FortiOsPlan.isFactory(table, entry)) block.entries.delete(key);
            for (const key of FortiOsPlan.IGNORED_IN[section] ?? []) block.settings.delete(key);
            FortiOsPlan.dropIgnored(block);

            const kept = FortiOsPlan.KEPT[section];
            if (!kept) continue;

            for (const { block: entry } of block.entries.values()) {
                for (const key of entry.settings.keys()) if (!kept.includes(key)) entry.settings.delete(key);
                entry.blocks.clear();
            }
        }

        return FortiOsTree.print(root);
    }

    private static dropIgnored(block: FortiOsBlock): void {
        for (const key of block.settings.keys()) if (FortiOsPlan.IGNORED.has(key)) block.settings.delete(key);
        for (const child of block.blocks.values()) FortiOsPlan.dropIgnored(child);
        for (const { block: entry } of block.entries.values()) FortiOsPlan.dropIgnored(entry);
    }

    /** The words before a line a reviewer reads, naming the entry and block it sits in. */
    private static labelOf(path: string[]): string {
        return path.length ? `${path.join(" ")}: ` : "";
    }

    /** A block's lines as reviewer lines, each with its place. An entry that holds nothing, such as an extra IPv6 address, is its own line. */
    private static shown(sign: "+" | "-", path: string[], block: FortiOsBlock): string[] {
        const label = FortiOsPlan.labelOf(path);
        const lines = FortiOsTree.lines(block).map((line) => `${sign} ${label}${line.trim()}`);
        return lines.length ? lines : [`${sign} ${path.join(" ")}`];
    }

    /** The lines that create an entry, with the settings the device adds unset when the render does not hold them. */
    private static creation(entry: Entry, table: Table | undefined, id = entry.id): string[] {
        const unset = (table?.created?.(entry.block) ?? []).filter((key) => !entry.block.settings.has(key)).map((key) => `unset ${key}`);
        return [`edit ${id}`, ...FortiOsTree.lines(entry.block).map((line) => line.trim()), ...unset, "next"];
    }

    /**
     * Compare one block. `table` applies to its entries; `top` sends their removal to the end of the plan.
     *
     * What goes is undone before what comes is set, since a setting can hide another: `send-deny-packet` exists only while a policy denies. A nested list that goes is deleted before the settings, since one can hide the list and keep its entries hidden, such as `secondary-IP`; NTP refuses to delete its last server while it synchronises, so `ntpsync` goes before its list.
     */
    private static compare(
        path: string[],
        want: FortiOsBlock,
        have: FortiOsBlock,
        table: Table | undefined,
        top: boolean,
        context: Context
    ): Diff {
        const send: string[] = [];
        const show: string[] = [];
        const removals: string[] = [];
        const removed: string[] = [];
        const label = FortiOsPlan.labelOf(path);

        const nested = (header: string, wanted: FortiOsBlock, held: FortiOsBlock) => {
            const diff = FortiOsPlan.compare([...path, header], wanted, held, undefined, false, context);
            if (!diff.send.length) return;

            send.push(`config ${header}`, ...diff.send, "end");
            show.push(...diff.show);
        };

        const unset = (key: string, old: string) => {
            send.push(`unset ${key}`);
            show.push(`- ${label}set ${key} ${old}`);
        };

        const gone = [...have.settings].filter(([key]) => !want.settings.has(key) && !FortiOsPlan.IGNORED.has(key));
        for (const [key, old] of gone) if (FortiOsPlan.FIRST.has(key)) unset(key, old);

        // In reverse, so a list that names another, such as OSPF's networks naming its areas, goes first.
        for (const [header, child] of [...have.blocks].reverse()) if (!want.blocks.has(header)) nested(header, new FortiOsBlock(), child);

        // In reverse, so a setting that shows others, such as port forwarding, goes after them.
        for (const [key, old] of gone.reverse()) if (!FortiOsPlan.FIRST.has(key)) unset(key, old);

        for (const [key, value] of want.settings) {
            const old = have.settings.get(key);
            const current = old ?? FortiOsPlan.DEFAULTS[context.section]?.[key];
            const same = current !== undefined && FortiOsPlan.canonical(key, current) === FortiOsPlan.canonical(key, value);
            if (same && !(context.secrets && value.includes("<secret:"))) continue;

            send.push(value === FortiOsTree.UNSET ? `unset ${key}` : `set ${key} ${value}`);
            if (old !== undefined) show.push(`- ${label}set ${key} ${old}`);
            show.push(`+ ${label}set ${key} ${value}`);
        }

        for (const [header, child] of want.blocks) nested(header, child, have.blocks.get(header) ?? new FortiOsBlock());

        const entries = table?.byContent
            ? FortiOsPlan.byContent(path, want, have)
            : table?.numbered
              ? FortiOsPlan.numbered(path, want, have, table, table.numbered, context)
              : FortiOsPlan.byId(path, want, have, table, context);
        send.push(...entries.send);
        show.push(...entries.show);

        if (top) {
            removals.push(...entries.removals);
            removed.push(...entries.removed);
        } else {
            send.push(...entries.removals);
            show.push(...entries.removed);
        }

        return { send, show, removals, removed };
    }

    /** Entries matched by name: new ones created, changed ones edited, gone ones deleted. */
    private static byId(path: string[], want: FortiOsBlock, have: FortiOsBlock, table: Table | undefined, context: Context): Diff {
        const send: string[] = [];
        const show: string[] = [];
        const removals: string[] = [];
        const removed: string[] = [];

        for (const [key, entry] of want.entries) {
            const old = have.entries.get(key);
            const where = [...path, FortiOsTree.bare(entry.id)];

            const replaced = old && FortiOsPlan.changesFixed(table, old.block, entry.block);

            if (!old || replaced) {
                if (old) {
                    send.push(`delete ${old.id}`);
                    show.push(...FortiOsPlan.shown("-", where, old.block));
                }

                send.push(...FortiOsPlan.creation(entry, table));
                show.push(...FortiOsPlan.shown("+", where, entry.block));
                continue;
            }

            const diff = FortiOsPlan.compare(where, entry.block, old.block, undefined, false, context);
            if (!diff.send.length) continue;

            send.push(`edit ${entry.id}`, ...diff.send, "next");
            show.push(...diff.show);
        }

        // An interface on another goes before the one it sits on.
        const gone = [...have.entries].filter(([key, entry]) => !want.entries.has(key) && !FortiOsPlan.isFactory(table, entry));
        gone.sort(([, a], [, b]) => Number(b.block.settings.has("interface")) - Number(a.block.settings.has("interface")));

        for (const [, entry] of gone) {
            removals.push(`delete ${entry.id}`);
            removed.push(...FortiOsPlan.shown("-", [...path, FortiOsTree.bare(entry.id)], entry.block));
        }

        return { send, show, removals, removed };
    }

    /**
     * Entries the render numbers by their place, while on the device each keeps the number it was created with, so they are matched by what they are.
     *
     * An entry that holds the same as one on the device is kept. One that changes is found by the first of the table's keys that no other entry left to match shares, such as its description, and edited under its own number. Any other is new and takes a number the device does not use; in a table the device keeps in order, it is created at the end and moved into place. An entry on the device that nothing matched is deleted last, so every entry the render keeps stays on the device through the whole change.
     *
     * In a `distinct` table, an entry that changes is deleted and created again under its own number, and every deletion comes before any creation.
     */
    private static numbered(
        path: string[],
        want: FortiOsBlock,
        have: FortiOsBlock,
        table: Table,
        numbered: NonNullable<Table["numbered"]>,
        context: Context
    ): Diff {
        const send: string[] = [];
        const show: string[] = [];

        // The number in a name the render gives, such as 7 in `dnat-7`. An entry named otherwise is never kept.
        const pattern = new RegExp(`^${numbered.prefix ?? ""}(\\d+)$`);
        const numberOf = (entry: Entry) => Number(pattern.exec(FortiOsTree.bare(entry.id))?.[1] ?? NaN);

        const held = [...have.entries.values()].filter((entry) => !FortiOsPlan.isFactory(table, entry));
        const kept = new Map<string, Entry>();
        const unmatched = new Set(held.filter((entry) => Number.isInteger(numberOf(entry))));

        const keep = (key: string, old: Entry) => {
            kept.set(key, old);
            unmatched.delete(old);
        };

        // Only entries with the same signature can hold the same, so an entry is compared with those alone.
        const alike = Map.groupBy(unmatched, (old) => FortiOsPlan.signature(old.block, context.section));
        const same = (entry: Entry, old: Entry) => !FortiOsPlan.compare([], entry.block, old.block, undefined, false, context).send.length;

        for (const [key, entry] of want.entries) {
            const candidates = alike.get(FortiOsPlan.signature(entry.block, context.section)) ?? [];
            const index = candidates.findIndex((old) => same(entry, old));
            if (index >= 0) keep(key, candidates.splice(index, 1)[0]!);
        }

        for (const settings of numbered.keys) {
            const valueOf = (entry: Entry) => {
                const parts = settings.map((setting) => FortiOsPlan.canonical(setting, entry.block.settings.get(setting) ?? ""));
                return parts.some(Boolean) ? parts.join("\n") : undefined;
            };

            const changed = Map.groupBy(
                [...want.entries].filter(([key]) => !kept.has(key)),
                ([, entry]) => valueOf(entry)
            );
            const left = Map.groupBy(unmatched, valueOf);

            for (const [value, entries] of changed) {
                const old = left.get(value);
                if (value !== undefined && entries.length === 1 && old?.length === 1) keep(entries[0]![0], old[0]!);
            }
        }

        // A number no entry on the device holds, not even one deleted at the end.
        let next = Math.max(0, ...[...have.entries.values()].map(numberOf).filter(Number.isInteger)) + 1;
        const wanted: string[] = [];
        const replaced: string[] = [];

        for (const [key, entry] of want.entries) {
            const old = kept.get(key);

            if (!old) {
                const name = `${numbered.prefix ?? ""}${next++}`;
                const id = numbered.prefix ? FortiOsTree.quote(name) : name;
                wanted.push(id);
                send.push(...FortiOsPlan.creation(entry, table, id));
                show.push(...FortiOsPlan.shown("+", [...path, name], entry.block));
                continue;
            }

            wanted.push(old.id);

            const where = [...path, FortiOsTree.bare(old.id)];
            const diff = FortiOsPlan.compare(where, entry.block, old.block, undefined, false, context);
            if (!diff.send.length) continue;

            if (table.distinct) {
                replaced.push(`delete ${old.id}`);
                send.push(...FortiOsPlan.creation(entry, table, old.id));
                show.push(...FortiOsPlan.shown("-", where, old.block), ...FortiOsPlan.shown("+", where, entry.block));
                continue;
            }

            send.push(`edit ${old.id}`, ...diff.send, "next");
            show.push(...diff.show);
        }

        const keptEntries = new Set(kept.values());

        if (table.ordered) {
            const order = held.filter((entry) => keptEntries.has(entry)).map((entry) => entry.id);
            const moved = FortiOsPlan.moves(wanted, order);
            send.push(...moved);
            show.push(...moved.map((line) => `+ ${FortiOsPlan.labelOf(path)}${line}`));
        }

        const gone = held.filter((entry) => !keptEntries.has(entry));
        const removals = gone.map((entry) => `delete ${entry.id}`);
        const removed = gone.flatMap((entry) => FortiOsPlan.shown("-", [...path, FortiOsTree.bare(entry.id)], entry.block));

        if (table.distinct) return { send: [...replaced, ...removals, ...send], show: [...removed, ...show], removals: [], removed: [] };
        return { send, show, removals, removed };
    }

    /** The `move` commands that put a table's entries in the render's order, by the device's numbers: `wanted` in the render's order, `held` the kept ones in the device's. Kept entries hold their place on the device and new ones are added at the end. */
    private static moves(wanted: readonly string[], held: readonly string[]): string[] {
        const order = [...held, ...wanted.filter((id) => !held.includes(id))];
        const send: string[] = [];

        for (let index = 0; index < wanted.length; index++) {
            const id = wanted[index]!;
            if (order[index] === id) continue;

            send.push(index === 0 ? `move ${id} before ${order[0]}` : `move ${id} after ${wanted[index - 1]}`);
            order.splice(order.indexOf(id), 1);
            order.splice(index, 0, id);
        }

        return send;
    }

    /** An entry's settings in the form two entries compare in, whatever their numbers. A setting at its section's default is left out, as the device does not print it. */
    private static signature(block: FortiOsBlock, section = ""): string {
        const defaults = FortiOsPlan.DEFAULTS[section] ?? {};
        const isDefault = (key: string, value: string) =>
            defaults[key] !== undefined && FortiOsPlan.canonical(key, defaults[key]) === FortiOsPlan.canonical(key, value);

        return [...block.settings]
            .filter(([key, value]) => !isDefault(key, value))
            .map(([key, value]) => `${key} ${FortiOsPlan.canonical(key, value)}`)
            .sort()
            .join("\n");
    }

    /** Entries matched by what they hold. One the device holds and the render does not is deleted; one the render adds takes a number the device does not use. */
    private static byContent(path: string[], want: FortiOsBlock, have: FortiOsBlock): Diff {
        const send: string[] = [];
        const show: string[] = [];
        const removals: string[] = [];
        const removed: string[] = [];

        const unmatched = [...have.entries.values()];
        const added: Entry[] = [];

        for (const entry of want.entries.values()) {
            const index = unmatched.findIndex((old) => FortiOsPlan.signature(old.block) === FortiOsPlan.signature(entry.block));
            if (index >= 0) unmatched.splice(index, 1);
            else added.push(entry);
        }

        let next = Math.max(0, ...[...have.entries.keys()].map(Number).filter(Number.isInteger)) + 1;

        for (const entry of added) {
            const id = String(next++);
            send.push(...FortiOsPlan.creation(entry, undefined, id));
            show.push(...FortiOsPlan.shown("+", [...path, id], entry.block));
        }

        for (const entry of unmatched) {
            removals.push(`delete ${entry.id}`);
            removed.push(...FortiOsPlan.shown("-", [...path, FortiOsTree.bare(entry.id)], entry.block));
        }

        return { send, show, removals, removed };
    }

    /** The interface names a block's settings hold. */
    private static interfacesNamed(block: FortiOsBlock): string[] {
        return [...block.settings]
            .filter(([key]) => FortiOsPlan.NAMES_INTERFACE.has(key))
            .flatMap(([, value]) => FortiOsTree.words(value).map(FortiOsTree.bare));
    }

    /**
     * What goes before anything else changes.
     *
     * A port joins a LAG only while nothing names it, and its speed cannot change while it is in one. So a LAG that keeps some of its ports lets the others go first, a port whose speed changes leaves its LAG and joins again later, a LAG whose ports join another goes first, and an interface whose type or parent changes is deleted and created again. Whatever names such an interface on the device is deleted first, or unset when a list names it, and set again later if the render holds it; an interface or tunnel deleted this way frees what names it in turn.
     *
     * A LAG that goes otherwise is deleted with everything else that goes, after what names it; its ports are changed after that.
     */
    private static released(want: FortiOsBlock, have: FortiOsBlock): Release {
        const interfaces = have.blocks.get("system interface") ?? new FortiOsBlock();
        const wanted = want.blocks.get("system interface") ?? new FortiOsBlock();
        const members = (block: FortiOsBlock | undefined) => FortiOsTree.words(block?.settings.get("member") ?? "").map(FortiOsTree.bare);

        const freed = new Set<string>();
        const gone = new Set<string>();
        const trims: Release["trims"] = [];
        const deferred = new Set<string>();

        // A port in a LAG keeps its speed until it leaves.
        const changesSpeed = (port: string) => {
            const speed = (block: FortiOsBlock | undefined) => FortiOsPlan.canonical("speed", block?.settings.get("speed") ?? "");
            return speed(interfaces.entries.get(port)?.block) !== speed(wanted.entries.get(port)?.block);
        };

        for (const [key, entry] of wanted.entries) {
            const before = interfaces.entries.get(key)?.block;
            for (const member of members(entry.block)) if (!members(before).includes(member)) freed.add(member);

            if (before && FortiOsPlan.changesFixed(FortiOsPlan.TABLES["system interface"], before, entry.block)) freed.add(key);
        }

        for (const [key, entry] of interfaces.entries) {
            if (entry.block.settings.get("type") !== "aggregate") continue;

            const kept = members(entry.block).filter(
                (member) => members(wanted.entries.get(key)?.block).includes(member) && !changesSpeed(member)
            );
            if (kept.length === members(entry.block).length) continue;

            if (kept.length && wanted.entries.has(key)) {
                trims.push({ id: entry.id, members: kept });
                continue;
            }

            // A LAG that goes, and whose ports join no other, goes with the rest.
            if (!wanted.entries.has(key) && !members(entry.block).some((member) => freed.has(member))) {
                for (const member of members(entry.block)) deferred.add(member);
                continue;
            }

            freed.add(key);
            gone.add(key);
        }

        let grew = true;

        while (grew) {
            grew = false;

            for (const [section, block] of have.blocks) {
                if (!FortiOsPlan.INTERFACE_TABLES.has(section)) continue;

                for (const [key, entry] of block.entries) {
                    if (freed.has(key) || !FortiOsPlan.interfacesNamed(entry.block).some((name) => freed.has(name))) continue;

                    freed.add(key);
                    grew = true;
                }
            }
        }

        return { freed, gone, trims, deferred };
    }

    /**
     * The lines, inside one block, that release what names a freed interface: an entry that names one is deleted, and a list a block holds that names one is unset. The device's tree loses them too, so the plan creates or sets them again. An interface the release deletes itself is in `gone`.
     */
    private static release(
        block: FortiOsBlock,
        path: string[],
        freed: Set<string>,
        gone: Set<string>,
        isEntry: boolean
    ): { send: string[]; show: string[] } {
        const send: string[] = [];
        const show: string[] = [];
        const label = FortiOsPlan.labelOf(path);

        if (!isEntry) {
            for (const [key, value] of [...block.settings]) {
                if (!FortiOsPlan.NAMES_INTERFACE.has(key) || !FortiOsTree.words(value).some((word) => freed.has(FortiOsTree.bare(word))))
                    continue;

                // A list that exists only while a setting is on goes with it, and lets go of what it names.
                const holder = FortiOsPlan.HELD_BY[key];
                if (holder && block.settings.has(holder)) {
                    send.push(`unset ${holder}`);
                    show.push(`- ${label}set ${holder} ${block.settings.get(holder)}`, `- ${label}set ${key} ${value}`);
                    block.settings.delete(holder);
                    block.settings.delete(key);
                    continue;
                }

                send.push(`unset ${key}`);
                show.push(`- ${label}set ${key} ${value}`);
                block.settings.delete(key);
            }
        }

        for (const [header, child] of block.blocks) {
            const inner = FortiOsPlan.release(child, [...path, header], freed, gone, false);
            if (inner.send.length) send.push(`config ${header}`, ...inner.send, "end");
            show.push(...inner.show);
        }

        // An interface on another goes before the one it sits on.
        const entries = [...block.entries].sort(
            ([, a], [, b]) => Number(b.block.settings.has("interface")) - Number(a.block.settings.has("interface"))
        );

        for (const [key, entry] of entries) {
            const where = [...path, FortiOsTree.bare(entry.id)];
            const named = FortiOsPlan.interfacesNamed(entry.block).some((name) => freed.has(name));

            if (named || gone.has(key)) {
                send.push(`delete ${entry.id}`);
                show.push(...FortiOsPlan.shown("-", where, entry.block));
                block.entries.delete(key);
                continue;
            }

            const inner = FortiOsPlan.release(entry.block, where, freed, gone, true);
            if (inner.send.length) send.push(`edit ${entry.id}`, ...inner.send, "next");
            show.push(...inner.show);
        }

        return { send, show };
    }

    /**
     * Addresses that leave an interface, taken off before any is set: the device refuses an address in a subnet another interface still holds, `Subnets overlap`. A primary address that changes takes the secondary ones with it, since they hang on it.
     */
    private static movedAddresses(want: FortiOsBlock, have: FortiOsBlock): Step | undefined {
        const wanted = want.blocks.get("system interface");
        const held = have.blocks.get("system interface");
        if (!wanted || !held) return undefined;

        const send: string[] = [];
        const show: string[] = [];
        const same = (key: string, a: string | undefined, b: string | undefined) =>
            FortiOsPlan.canonical(key, a ?? "") === FortiOsPlan.canonical(key, b ?? "");

        for (const [key, entry] of held.entries) {
            const after = wanted.entries.get(key)?.block;
            const before = entry.block;
            const lines: string[] = [];
            const label = FortiOsPlan.labelOf([FortiOsTree.bare(entry.id)]);

            const primaryMoves = before.settings.has("ip") && !same("ip", before.settings.get("ip"), after?.settings.get("ip"));
            const secondaries = before.blocks.get("secondaryip");
            const keptSecondaries = after?.blocks.get("secondaryip");
            const goneSecondaries = [...(secondaries?.entries ?? [])].filter(
                ([id, secondary]) =>
                    primaryMoves ||
                    !same("ip", secondary.block.settings.get("ip"), keptSecondaries?.entries.get(id)?.block.settings.get("ip"))
            );

            if (goneSecondaries.length) {
                lines.push("config secondaryip", ...goneSecondaries.map(([, secondary]) => `delete ${secondary.id}`), "end");
                for (const [id, secondary] of goneSecondaries) {
                    show.push(`- ${label}secondaryip ${FortiOsTree.bare(secondary.id)}: set ip ${secondary.block.settings.get("ip")}`);
                    secondaries!.entries.delete(id);
                }
            }

            if (primaryMoves) {
                lines.push("unset ip");
                show.push(`- ${label}set ip ${before.settings.get("ip")}`);
                before.settings.delete("ip");
            }

            const ipv6 = before.blocks.get("ipv6");
            const keptIpv6 = after?.blocks.get("ipv6");
            const extra = ipv6?.blocks.get("ip6-extra-addr");
            const goneExtra = [...(extra?.entries ?? [])].filter(([id]) => !keptIpv6?.blocks.get("ip6-extra-addr")?.entries.has(id));
            const v6Lines: string[] = [];

            if (goneExtra.length) {
                v6Lines.push("config ip6-extra-addr", ...goneExtra.map(([, address]) => `delete ${address.id}`), "end");
                for (const [id, address] of goneExtra) {
                    show.push(`- ${label}ipv6 ip6-extra-addr ${FortiOsTree.bare(address.id)}`);
                    extra!.entries.delete(id);
                }
            }

            if (
                ipv6?.settings.has("ip6-address") &&
                !same("ip6-address", ipv6.settings.get("ip6-address"), keptIpv6?.settings.get("ip6-address"))
            ) {
                v6Lines.push("unset ip6-address");
                show.push(`- ${label}ipv6: set ip6-address ${ipv6.settings.get("ip6-address")}`);
                ipv6.settings.delete("ip6-address");
            }

            if (v6Lines.length) lines.push("config ipv6", ...v6Lines, "end");
            if (lines.length) send.push(`edit ${entry.id}`, ...lines, "next");
        }

        return send.length
            ? { title: "system interface, addresses that move", show, send: ["config system interface", ...send, "end"] }
            : undefined;
    }

    /**
     * What changes, by section, in the order the render lists them. Entries that go are deleted after everything else, in the reverse order, so nothing is deleted while another section still names it.
     *
     * A secret is sent when its entry is new, or with `secrets` set; it cannot be read back to compare.
     */
    static of(desired: string, current: string, options: Pick<ApplyOptions, "secrets">): Plan {
        const want = FortiOsPlan.separateTunnels(FortiOsTree.parse(desired));
        const have = FortiOsPlan.separateTunnels(FortiOsTree.parse(FortiOsPlan.clean(current)));
        FortiOsPlan.keepFilled(want, have);

        const first: Step[] = [];
        const steps: Step[] = [];
        const removals: Step[] = [];

        const { freed, gone, trims, deferred } = FortiOsPlan.released(want, have);
        const late = FortiOsPlan.deferredPorts(want, have, deferred, options.secrets);

        if (freed.size) {
            for (const section of [...have.blocks.keys()].reverse()) {
                const block = have.blocks.get(section)!;

                // A tunnel's interface goes with its tunnel, which the release deletes.
                if (section === FortiOsPlan.TUNNELS) {
                    for (const key of [...block.entries.keys()]) if (freed.has(key)) block.entries.delete(key);
                    continue;
                }

                const { send, show } = FortiOsPlan.release(
                    block,
                    [],
                    freed,
                    FortiOsPlan.KEYED_BY_INTERFACE.has(section) ? freed : section === "system interface" ? gone : new Set(),
                    false
                );
                if (send.length) first.push({ title: `${section}, released`, show, send: [`config ${section}`, ...send, "end"] });
            }
        }

        if (trims.length) {
            const interfaces = have.blocks.get("system interface")!;
            const send = trims.flatMap(({ id, members }) => [`edit ${id}`, `set member ${FortiOsTree.quoteAll(members)}`, "next"]);
            const show = trims.map(({ id, members }) => `+ ${FortiOsTree.bare(id)}: set member ${FortiOsTree.quoteAll(members)}`);
            first.push({ title: "system interface, ports leaving a LAG", show, send: ["config system interface", ...send, "end"] });

            for (const { id, members } of trims)
                interfaces.entries.get(FortiOsTree.bare(id))!.block.settings.set("member", FortiOsTree.quoteAll(members));
        }

        const moved = FortiOsPlan.movedAddresses(want, have);
        if (moved) first.push(moved);

        for (const [section, block] of want.blocks) {
            const header = section === FortiOsPlan.TUNNELS ? "system interface" : section;
            const context = { section: header, secrets: options.secrets };
            const table = section === FortiOsPlan.TUNNELS ? undefined : FortiOsPlan.TABLES[header];
            const diff = FortiOsPlan.compare([], block, have.blocks.get(section) ?? new FortiOsBlock(), table, true, context);

            if (diff.send.length) steps.push({ title: section, show: diff.show, send: [`config ${header}`, ...diff.send, "end"] });

            // A tunnel's interface goes with its tunnel.
            if (diff.removals.length && section !== FortiOsPlan.TUNNELS) {
                removals.unshift({ title: `${section}, removed`, show: diff.removed, send: [`config ${header}`, ...diff.removals, "end"] });
            }
        }

        // Leaving transparent mode needs an address and an interface for it, which the config of a device without a bridge does not say.
        const opmode = (root: FortiOsBlock) => root.blocks.get("system settings")?.settings.get("opmode");
        const problems =
            opmode(have) === "transparent" && opmode(want) !== "transparent"
                ? [
                      "the device runs in transparent mode and the config has no bridge; leave transparent mode by hand, `set opmode nat` with an address and an interface under `config system settings`, then plan again",
                  ]
                : [];

        return { steps: [...first, ...steps, ...removals, ...late], problems };
    }

    /** The tree with each tunnel's interface moved from `system interface` to a section of its own, just after the tunnels' tables. The interface it leaves through is its tunnel's, and is left to the tunnel's table. */
    private static separateTunnels(root: FortiOsBlock): FortiOsBlock {
        const interfaces = root.blocks.get("system interface");
        if (!interfaces) return root;

        const tunnels = new FortiOsBlock();

        for (const [key, entry] of interfaces.entries) {
            const type = entry.block.settings.get("type");
            if (type !== "tunnel" && type !== "vxlan") continue;

            entry.block.settings.delete("interface");
            tunnels.entries.set(key, entry);
            interfaces.entries.delete(key);
        }

        const sections = [...root.blocks];
        root.blocks.clear();

        for (const [section, block] of sections) {
            root.blocks.set(section, block);
            if (section === "system vxlan") root.blocks.set(FortiOsPlan.TUNNELS, tunnels);
        }

        if (!root.blocks.has(FortiOsPlan.TUNNELS)) root.blocks.set(FortiOsPlan.TUNNELS, tunnels);
        return root;
    }

    /** A prefix list `refresh` fills keeps the entries the device holds. */
    private static keepFilled(want: FortiOsBlock, have: FortiOsBlock): void {
        for (const table of Object.values(FortiOsRouting.PREFIX_LIST)) {
            for (const [key, entry] of want.blocks.get(table)?.entries ?? []) {
                if (!FortiOsTree.bare(entry.block.settings.get("comments") ?? "").startsWith(FortiOsRouting.FILLED)) continue;

                const held = have.blocks.get(table)?.entries.get(key)?.block.blocks.get("rule");
                if (held) entry.block.blocks.set("rule", held);
            }
        }
    }

    /** The ports of a LAG that goes, taken out of the main comparison and changed in a step of their own once the LAG is deleted. */
    private static deferredPorts(want: FortiOsBlock, have: FortiOsBlock, ports: Set<string>, secrets: boolean): Step[] {
        const wanted = want.blocks.get("system interface");
        const held = have.blocks.get("system interface");
        if (!ports.size || !wanted || !held) return [];

        const later = { want: new FortiOsBlock(), have: new FortiOsBlock() };

        for (const port of ports) {
            const after = wanted.entries.get(port);
            const before = held.entries.get(port);
            if (!after || !before) continue;

            later.want.entries.set(port, after);
            later.have.entries.set(port, before);
            wanted.entries.delete(port);
            held.entries.delete(port);
        }

        const diff = FortiOsPlan.compare([], later.want, later.have, FortiOsPlan.TABLES["system interface"], true, {
            section: "system interface",
            secrets,
        });
        if (!diff.send.length) return [];

        return [
            {
                title: "system interface, ports of a LAG that went",
                show: diff.show,
                send: ["config system interface", ...diff.send, "end"],
            },
        ];
    }
}
