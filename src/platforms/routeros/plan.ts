// What the device holds and the render does not is removed or reset. A plan has two phases. Additions and changes go first, in dependency order, so nothing points at what does not exist yet. Removals go last, in reverse order, so nothing is removed while still in use.

import type { ApplyOptions, Plan, Step } from "../platform";
import { RouterOsExport } from "./export";
import type { Command, Parsed } from "./export";
import { RouterOsSyntax } from "./syntax";

/** What is planned for one menu: changes for the first phase, removals for the last. */
type MenuPlan = { first: Step[]; last: Step[] };

export class RouterOsPlan {
    /** A plan line the apply handles itself: upload a certificate and its key, and import them. */
    static readonly INSTALL_CERTIFICATE = "#install-certificate ";

    private static readonly ETHERNET = "/interface ethernet";

    /** Dependency order. A menu not listed sorts after all of these. The longest matching prefix decides. */
    private static readonly ORDER = [
        // Certificates depend on nothing, and services name them.
        "/certificate",
        // A PPP client names its profile, and an interface kind not listed below goes before what names it, such as an interface list. An unlisted menu is removed first, which left a list member naming a removed PPPoE client (RB5009, 7.24.6).
        "/ppp",
        "/interface",
        "/interface bridge",
        "/interface ethernet",
        // A bonding interface names its EoIP slaves, so they exist first.
        "/interface eoip",
        "/interface bonding",
        "/interface vlan",
        "/interface macvlan",
        "/interface gre",
        "/interface vxlan",
        "/interface wireguard",
        "/interface vrrp",
        "/interface bridge port",
        "/interface bridge vlan",
        "/interface bridge filter",
        "/interface list",
        // A queue tree names its queue type and the interface it shapes.
        "/queue type",
        "/queue tree",
        "/ip vrf",
        // Routes, rules and BGP connections name a table, so it exists first.
        "/routing table",
        "/routing rule",
        "/ip address",
        "/ipv6 address",
        "/ip pool",
        "/ip dhcp-server",
        // A DHCPv6 server names its pools and its options.
        "/ipv6 pool",
        "/ipv6 dhcp-server option",
        "/ipv6 dhcp-server",
        "/ip firewall address-list",
        "/ipv6 firewall address-list",
        "/ip firewall",
        "/ipv6 firewall",
        "/routing rpki",
        "/routing filter rule",
        "/routing bgp instance",
        "/routing bgp connection",
        "/routing ospf instance",
        "/routing ospf area",
        "/routing ospf interface-template",
        "/ip",
        "/ipv6",
        "/routing",
        "/interface ethernet switch",
        // `/snmp` names a community to send traps with, so it exists first.
        "/snmp community",
        "/snmp",
        "/tool",
        "/radius",
        "/user",
        // A logging rule names its action, so the action exists first.
        "/system logging action",
        "/system",
    ];

    /** Menus that also hold entries the device learned rather than was told. A selector must not match those. */
    private static readonly DYNAMIC = new Set([
        "/ip route",
        "/ipv6 route",
        "/ip address",
        "/ipv6 address",
        "/ip firewall address-list",
        "/ipv6 firewall address-list",
        "/ip firewall filter",
        "/ipv6 firewall filter",
        "/ip firewall nat",
        "/ipv6 firewall nat",
        "/ip firewall mangle",
        "/ipv6 firewall mangle",
        "/ip firewall raw",
        "/ipv6 firewall raw",
        "/ip dhcp-server lease",
        "/interface bridge vlan",
        // An address that advertises its network makes its prefix's entry.
        "/ipv6 nd prefix",
    ]);

    /**
     * Menus where an entry that keeps its name, but changes what it is known by, is changed with a `set`. What points at it by name, such as an address on a VLAN interface, stays attached. Elsewhere it is removed and added again.
     */
    private static readonly CHANGED_IN_PLACE = new Set(["/interface vlan"]);

    /** Menus whose flags a `set` changes in place: `set <entry> passive` and `set <entry> !passive`. Elsewhere, as with a route's `blackhole`, the entry is replaced. */
    private static readonly FLAGS_SET = new Set(["/routing ospf area", "/routing ospf interface-template"]);

    /**
     * Properties a running entry takes only when it restarts. A BGP session given a new `routing-table` stops announcing at once, and keeps its routes in the old table until it restarts (TRAPS.md). So the plan disables the connection, changes it, waits until its session closes, and enables it again.
     */
    private static readonly RESTART_ON: Record<string, string[]> = { "/routing bgp connection": ["routing-table"] };

    /** How long the plan waits for the session of a disabled BGP connection to close. */
    private static readonly SESSION_CLOSE_SECONDS = 30;
    /**
     * Menus where the device makes an entry of its own from another menu, and keeps it a moment after it should go. An address that stops advertising keeps its dynamic `/ipv6 nd prefix` entry for about a second, and an entry added for the same prefix meanwhile is refused (TRAPS.md). An `add` there first waits, at most this many seconds, for that entry to go.
     */
    private static readonly LINGERING: Record<string, number> = { "/ipv6 nd prefix": 30 };

    /**
     * Menus where a new entry makes an entry of the device's own, named after it, in another menu, a moment later. A VRF makes its routing table, and a BGP connection that uses the table before it is there is refused (TRAPS.md). After such an `add`, the plan waits, at most `seconds`, for that entry.
     */
    private static readonly MAKES: Record<string, { menu: string; seconds: number }> = {
        "/ip vrf": { menu: "/routing table", seconds: 30 },
    };

    /** Menus of routes, whose table a selector names. */
    private static readonly ROUTES = new Set(["/ip route", "/ipv6 route"]);

    /** Properties holding a list, which a selector writes as one. */
    private static readonly LISTS = new Set(["topics"]);

    /** The variable holding the old rules of an ordered menu while the new ones are added. Removed when the rewrite ends. */
    private static readonly OLD_RULES = "frameworkOldRules";

    /** What blocks an apply: something this plan cannot converge. */
    private readonly problems: string[] = [];

    /** Also send every secret, so a rotated value reaches the device. */
    private constructor(private readonly sendSecrets: boolean) {}

    static of(desired: string, current: string, options: Pick<ApplyOptions, "secrets">): Plan {
        const want = RouterOsExport.parse(desired);
        const have = RouterOsExport.parse(current);
        const planner = new RouterOsPlan(options.secrets);

        // Entries of lists filled by `refresh` belong to it, not to the render.
        const owned = (command: Command) => !(command.menu.endsWith("address-list") && want.generated.has(command.attrs.list ?? ""));
        const wantedByMenu = RouterOsPlan.byMenu([...want.commands.filter(owned), ...RouterOsPlan.unnamedPorts(want, have)]);
        const existingByMenu = RouterOsPlan.byMenu(have.commands.filter(owned));

        const menus = [...new Set([...wantedByMenu.keys(), ...existingByMenu.keys()])].sort(
            (a, b) => RouterOsPlan.rank(a) - RouterOsPlan.rank(b) || a.localeCompare(b)
        );
        const first: Step[] = [];
        const last: Step[] = [];

        for (const menu of menus) {
            const wanted = wantedByMenu.get(menu) ?? [];
            const existing = existingByMenu.get(menu) ?? [];

            let menuPlan: MenuPlan;
            if (menu === "/certificate") menuPlan = RouterOsPlan.certificates(wanted, existing);
            else if (RouterOsExport.ORDERED.has(menu)) menuPlan = planner.ordered(menu, wanted, existing);
            else {
                menuPlan = planner.entries(menu, wanted, existing);
                const settings = planner.settings(menu, wanted, existing);
                if (settings) menuPlan.first.unshift(settings);
            }

            first.push(...menuPlan.first);
            // Removals run in reverse dependency order, so a menu's are prepended.
            last.unshift(...menuPlan.last);
        }

        return { steps: [...first, ...last], problems: planner.problems };
    }

    /** A port the read lists and the render does not state is disabled, as the render disables a model's ports the config leaves out. Only a virtual router's read lists its ports. */
    private static unnamedPorts(want: Parsed, have: Parsed): Command[] {
        const stated = new Set(
            want.commands.filter((command) => command.menu === RouterOsPlan.ETHERNET).map((command) => command.selector)
        );

        return have.ports
            .map((port) => RouterOsSyntax.port(port))
            .filter((selector) => !stated.has(selector))
            .map((selector): Command => ({ menu: RouterOsPlan.ETHERNET, verb: "set", selector, flags: [], attrs: { disabled: "yes" } }));
    }

    private static rank(menu: string): number {
        let best = RouterOsPlan.ORDER.length;
        let bestLength = 0;
        RouterOsPlan.ORDER.forEach((prefix, index) => {
            const matches = menu === prefix || menu.startsWith(`${prefix} `);
            if (matches && prefix.length > bestLength) {
                best = index;
                bestLength = prefix.length;
            }
        });
        return best;
    }

    private static quote(value: string): string {
        return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$")}"`;
    }

    /** A value as a command takes it: bare when plain, quoted otherwise. A bare value is checked by `:parse` against the values the property takes; a quoted one is not (TRAPS.md). */
    private static value(raw: string): string {
        return /^[\w.:/@,!-]+$/.test(raw) ? raw : RouterOsPlan.quote(raw);
    }

    /** In a `find`, a quoted `yes` is a string and matches no boolean, while an unquoted slash matches nothing. Plain words go bare, anything else quoted. */
    private static findValue(property: string, raw: string): string {
        // A list matches quoted with `;` between its items, even with one: `topics="warning"`. Bare, or with commas, it matches nothing (RB5009, 7.24.6).
        if (RouterOsPlan.LISTS.has(property)) return RouterOsPlan.quote(raw.split(",").join(";"));

        return /^[\w.:-]+$/.test(raw) ? raw : RouterOsPlan.quote(raw);
    }

    /** A selector for the entry with this identity. */
    private static find(menu: string, id: Record<string, string>): string {
        const conditions = Object.entries(id).map(([property, raw]) => {
            const route = RouterOsPlan.ROUTES.has(menu);
            // A disabled route in the main table has no table at all, so `routing-table=main` misses it (RB5009, 7.24.6).
            if (route && property === "routing-table" && raw === "main") return "(routing-table=main or !routing-table)";
            // A connection added without a VRF has none at all, so `vrf=main` misses it (CHR, 7.24.6).
            if (property === "vrf" && raw === "main") return "(vrf=main or !vrf)";
            // A blackhole route has no gateway.
            if (route && property === "gateway" && raw === "") return "!gateway";
            return `${property}=${RouterOsPlan.findValue(property, raw)}`;
        });
        if (RouterOsPlan.DYNAMIC.has(menu)) conditions.push("!dynamic");
        return `[ find ${conditions.join(" and ")} ]`;
    }

    /** In a menu with `LINGERING` entries, a script that waits until the device's own entry with the identity of `entry` is gone. */
    private static waitForDynamic(menu: string, entry: Command): string | undefined {
        const seconds = RouterOsPlan.LINGERING[menu];
        if (seconds === undefined) return undefined;

        const conditions = Object.entries(RouterOsExport.selector(entry)).map(
            ([property, raw]) => `${property}=${RouterOsPlan.findValue(property, raw)}`
        );
        const dynamic = `[:len [${menu} find ${["dynamic", ...conditions].join(" and ")}]] > 0`;
        return `:local waited 0; :while (${dynamic} && $waited < ${seconds}) do={ :delay 1s; :set waited ($waited + 1) }`;
    }

    /** The `add` of an entry, then, in a menu that `MAKES` another entry, a script that waits until that entry is there. */
    private static adding(menu: string, entry: Command): string[] {
        const add = RouterOsPlan.line(menu, "add", "", entry.flags, entry.attrs);
        const made = RouterOsPlan.MAKES[menu];
        const name = entry.attrs.name;
        if (!made || name === undefined) return [add];

        const missing = `[:len [${made.menu} find name=${RouterOsPlan.findValue("name", name)}]] = 0`;
        return [add, `:local waited 0; :while (${missing} && $waited < ${made.seconds}) do={ :delay 1s; :set waited ($waited + 1) }`];
    }

    /** A whole command as sent: menu, verb, selector, flags, then properties. */
    private static line(menu: string, verb: string, selector: string, flags: string[], attrs: Record<string, string>): string {
        const properties = Object.entries(attrs).map(([property, raw]) => `${property}=${RouterOsPlan.value(raw)}`);
        return [menu, verb, selector, ...flags, ...properties].filter(Boolean).join(" ");
    }

    /** An `unset` of each property the device clears only that way, then a `set` of the flags and properties that change. The unsets go first: an area's `default-cost` keeps it from becoming a normal area (TRAPS.md). */
    private static setLines(menu: string, selector: string, update: Record<string, string>, flags: string[] = []): string[] {
        const cleared = (RouterOsExport.UNSET[menu] ?? []).filter((property) => update[property] === "");
        const values = Object.fromEntries(Object.entries(update).filter(([property]) => !cleared.includes(property)));
        const set = Object.keys(values).length || flags.length ? [RouterOsPlan.line(menu, "set", selector, flags, values)] : [];

        return [...cleared.map((property) => `${menu} unset ${selector} ${property}`), ...set];
    }

    /**
     * Waits, for up to `SESSION_CLOSE_SECONDS`, until the session of a disabled BGP connection is gone from `/routing bgp session`. An enable sent right after the disable leaves the session running (TRAPS.md). A session's `remote.address` has no prefix length.
     */
    private static untilSessionCloses(connection: Command): string {
        const [address = ""] = (connection.attrs["remote.address"] ?? "").split("/");
        const open = `[:len [/routing bgp session find where remote.address=${RouterOsPlan.findValue("remote.address", address)}]] > 0`;
        return `:local waited 0; :while (${open} and $waited < ${RouterOsPlan.SESSION_CLOSE_SECONDS}) do={ :delay 1s; :set waited ($waited + 1) }`;
    }

    private static describe(attrs: Record<string, string>): string {
        return Object.entries(attrs)
            .map(([property, raw]) => `${property}=${raw}`)
            .join(" ");
    }

    private static byMenu(commands: Command[]): Map<string, Command[]> {
        const groups = new Map<string, Command[]>();

        for (const command of commands) {
            const group = groups.get(command.menu) ?? [];
            group.push(command);
            groups.set(command.menu, group);
        }

        return groups;
    }

    /** The properties to send so that the device's entry matches the rendered one. A property the device holds and the render does not state is reset to its default. */
    private changes(wanted: Command, existing: Command | undefined, label: string): Record<string, string> {
        const want = RouterOsExport.normal(wanted);
        const have = existing ? RouterOsExport.normal(existing) : {};
        const result: Record<string, string> = {};

        for (const [property, desired] of Object.entries(want)) {
            if (have[property] !== desired) result[property] = desired;
        }

        for (const property of Object.keys(have)) {
            if (property in want) continue;
            // A secret, such as a community named by its value, is compared only when secrets are sent.
            if (RouterOsExport.isSecretMarker(wanted.attrs[property] ?? "")) continue;

            const clearedWith = RouterOsExport.CLEARED_WITH[wanted.menu]?.[property];
            if (clearedWith && !(clearedWith in want)) continue;
            if (RouterOsExport.GENERATED[wanted.menu]?.includes(property)) continue;

            const fallback = RouterOsExport.defaultOf(wanted, property);
            if (fallback === undefined) {
                this.problems.push(
                    `${label}: ${property}=${have[property]} is set on the device and its default is unknown; add it to DEFAULTS`
                );
            } else {
                result[property] = fallback;
            }
        }

        if (this.sendSecrets) {
            for (const [property, raw] of Object.entries(wanted.attrs)) {
                if (RouterOsExport.SECRET_KEYS.has(property) || RouterOsExport.isSecretMarker(raw)) result[property] = raw;
            }
        }

        for (const [property, secret] of Object.entries(RouterOsExport.SECRET_WITH[wanted.menu] ?? {})) {
            const raw = wanted.attrs[secret];
            if (result[property] && raw !== undefined) result[secret] = raw;
        }

        return result;
    }

    /** Settings addressed by a selector: `set ftp ...`, `set [ find default=yes ] ...`. They are changed, never added or removed. */
    private settings(menu: string, wanted: Command[], existing: Command[]): Step | undefined {
        const step: Step = { title: menu, show: [], send: [] };
        const wantedBySelector = new Map(wanted.filter((item) => item.verb === "set").map((item) => [item.selector, item]));
        const existingBySelector = new Map(existing.filter((item) => item.verb === "set").map((item) => [item.selector, item]));

        for (const selector of new Set([...wantedBySelector.keys(), ...existingBySelector.keys()])) {
            const want = wantedBySelector.get(selector);
            const have = existingBySelector.get(selector);
            // A setting only the device states is reset by comparing it with nothing.
            const target = want ?? { ...have!, attrs: {} };
            const update = this.changes(target, have, `${menu} ${selector}`);
            if (!Object.keys(update).length) continue;

            step.show.push(`~ set ${selector} ${RouterOsPlan.describe(update)}`.replace(/\s+/g, " "));
            step.send.push(RouterOsPlan.line(menu, "set", selector, [], update));
        }

        return step.send.length ? step : undefined;
    }

    /** Entries, told apart by identity. New ones are added, changed ones set, and ones the render does not hold removed in the last phase. */
    private entries(menu: string, wanted: Command[], existing: Command[]): MenuPlan {
        const result: MenuPlan = { first: [], last: [] };
        const changeStep: Step = { title: menu, show: [], send: [] };
        const removeStep: Step = { title: menu, show: [], send: [] };
        const key = (c: Command) => JSON.stringify(RouterOsExport.identity(c));

        const wantedEntries = wanted.filter((item) => item.verb === "add");
        const existingEntries = existing.filter((item) => item.verb === "add");

        const existingByKey = new Map<string, Command>();

        for (const entry of existingEntries) {
            const entryKey = key(entry);
            if (existingByKey.has(entryKey))
                this.problems.push(`${menu}: two entries share ${entryKey}, so neither can be addressed alone`);
            existingByKey.set(entryKey, entry);
        }

        const kept = new Set<string>();

        // An entry known by something other than its name keeps its name when that something changes, and the device refuses a second entry of that name. The old entry of the same name is changed in place, or removed before the new one is added.
        const wantedKeys = new Set(wantedEntries.map(key));
        const sameName = new Map(
            existingEntries
                .filter((entry) => entry.attrs.name !== undefined && !wantedKeys.has(key(entry)))
                .map((entry) => [entry.attrs.name!, entry])
        );

        for (const entry of wantedEntries) {
            const entryKey = key(entry);
            kept.add(entryKey);
            let current = existingByKey.get(entryKey);

            const namesake = !current && entry.attrs.name !== undefined ? sameName.get(entry.attrs.name) : undefined;
            if (namesake) {
                kept.add(key(namesake));

                if (RouterOsPlan.CHANGED_IN_PLACE.has(menu)) {
                    current = namesake;
                } else {
                    changeStep.show.push(`~ replace ${RouterOsExport.canonical(entry)}`);
                    changeStep.send.push(`${menu} remove ${RouterOsPlan.find(menu, RouterOsExport.selector(namesake))}`);
                    changeStep.send.push(...RouterOsPlan.adding(menu, entry));
                    continue;
                }
            }

            if (!current) {
                changeStep.show.push(`+ ${RouterOsExport.canonical(entry)}`);
                const wait = RouterOsPlan.waitForDynamic(menu, entry);
                if (wait) changeStep.send.push(wait);
                changeStep.send.push(...RouterOsPlan.adding(menu, entry));
                continue;
            }

            // A flag such as `blackhole` cannot be changed on an existing entry. It is replaced.
            const flagsDiffer = [...entry.flags].sort().join() !== [...current.flags].sort().join();
            if (flagsDiffer && !RouterOsPlan.FLAGS_SET.has(menu)) {
                changeStep.show.push(`~ replace ${RouterOsExport.canonical(entry)}`);
                removeStep.send.push(`${menu} remove ${RouterOsPlan.find(menu, RouterOsExport.selector(current))}`);
                changeStep.send.push(RouterOsPlan.line(menu, "add", "", entry.flags, entry.attrs));
                continue;
            }

            const update = this.changes(entry, current, `${menu} ${entryKey}`);
            const flags = [
                ...entry.flags.filter((flag) => !current.flags.includes(flag)),
                ...current.flags.filter((flag) => !entry.flags.includes(flag)).map((flag) => `!${flag}`),
            ];
            if (!Object.keys(update).length && !flags.length) continue;

            const selector = RouterOsPlan.find(menu, RouterOsExport.selector(current));
            const restartsOn = (RouterOsPlan.RESTART_ON[menu] ?? []).filter((property) => property in update);
            if (restartsOn.length) {
                changeStep.show.push(
                    `~ ${entryKey} ${RouterOsPlan.describe(update)}, restarting the session: it takes a new ${restartsOn.join(" and ")} only when it restarts`
                );
                changeStep.send.push(...RouterOsPlan.setLines(menu, selector, { disabled: "yes", ...update }));
                changeStep.send.push(RouterOsPlan.untilSessionCloses(current));
                changeStep.send.push(RouterOsPlan.line(menu, "set", selector, [], { disabled: "no" }));
                continue;
            }

            changeStep.show.push(`~ ${entryKey} ${[...flags, RouterOsPlan.describe(update)].join(" ").trim()}`);
            changeStep.send.push(...RouterOsPlan.setLines(menu, selector, update, flags));
        }

        const removed = existingEntries.filter((entry) => !kept.has(key(entry)));
        // An address list that goes entirely goes in one command, not one per entry.
        const wholeLists = new Set<string>();
        if (menu.endsWith("address-list")) {
            for (const entry of removed) {
                const list = entry.attrs.list!;
                if (!wantedEntries.some((candidate) => candidate.attrs.list === list)) wholeLists.add(list);
            }
        }

        for (const list of wholeLists) {
            const count = removed.filter((entry) => entry.attrs.list === list).length;
            removeStep.show.push(`- list ${list}, ${count} entr${count === 1 ? "y" : "ies"}`);
            removeStep.send.push(`${menu} remove [ find list=${RouterOsPlan.quote(list)} and !dynamic ]`);
        }

        for (const entry of removed) {
            if (wholeLists.has(entry.attrs.list ?? "")) continue;

            removeStep.show.push(`- ${RouterOsExport.canonical(entry)}`);
            removeStep.send.push(`${menu} remove ${RouterOsPlan.find(menu, RouterOsExport.selector(entry))}`);
        }

        if (changeStep.send.length) result.first.push(changeStep);
        if (removeStep.send.length) result.last.push(removeStep);
        return result;
    }

    /**
     * A certificate missing or different is installed from the config, after the old one of that name is removed. One the device holds under another name, with the same fingerprint and key, is renamed. One the config does not hold is removed in the last phase.
     */
    private static certificates(wanted: Command[], existing: Command[]): MenuPlan {
        const menu = "/certificate";
        const result: MenuPlan = { first: [], last: [] };
        const install: Step = { title: menu, show: [], send: [] };
        const remove: Step = { title: menu, show: [], send: [] };
        const existingByName = new Map(existing.map((item) => [item.attrs.name, item]));
        const wantedNames = new Set(wanted.map((item) => item.attrs.name));
        const renamed = new Set<string>();

        for (const entry of wanted) {
            const name = entry.attrs.name!;
            const current = existingByName.get(name);
            if (current && RouterOsExport.canonical(current) === RouterOsExport.canonical(entry)) continue;

            const sameCertificate = existing.find(
                (item) =>
                    !wantedNames.has(item.attrs.name) &&
                    !renamed.has(item.attrs.name!) &&
                    item.attrs.fingerprint === entry.attrs.fingerprint &&
                    item.attrs["private-key"] === entry.attrs["private-key"]
            );

            if (!current && sameCertificate) {
                const oldName = sameCertificate.attrs.name!;
                renamed.add(oldName);
                install.show.push(`~ rename ${oldName} to ${name}`);
                install.send.push(`${menu} set [ find name=${RouterOsPlan.quote(oldName)} ] name=${RouterOsPlan.quote(name)}`);
                continue;
            }

            install.show.push(`${current ? "~" : "+"} install ${name}`);
            if (current) install.send.push(`${menu} remove [ find name=${RouterOsPlan.quote(name)} ]`);
            install.send.push(RouterOsPlan.INSTALL_CERTIFICATE + name);
        }

        for (const entry of existing) {
            if (wantedNames.has(entry.attrs.name) || renamed.has(entry.attrs.name!)) continue;

            remove.show.push(`- ${entry.attrs.name}`);
            remove.send.push(`${menu} remove [ find name=${RouterOsPlan.quote(entry.attrs.name!)} ]`);
        }

        if (install.send.length) result.first.push(install);
        if (remove.send.length) result.last.push(remove);
        return result;
    }

    /**
     * An ordered menu that differs is rewritten whole, in the render's order. The old rules are captured, the new ones added after them, and then the old ones removed, so no chain is ever empty or half new. A chain no longer wanted is removed in the last phase, after what pointed at it has changed. One that holds a secret is rewritten whenever every secret is sent.
     */
    private ordered(menu: string, wanted: Command[], existing: Command[]): MenuPlan {
        const result: MenuPlan = { first: [], last: [] };
        const secret = (item: Command) =>
            Object.entries(item.attrs).some(
                ([property, raw]) => RouterOsExport.SECRET_KEYS.has(property) || RouterOsExport.isSecretMarker(raw)
            );
        const same =
            wanted.map((item) => RouterOsExport.canonical(item)).join("\n") ===
            existing.map((item) => RouterOsExport.canonical(item)).join("\n");
        if (same && !(this.sendSecrets && wanted.some(secret))) return result;

        const oldRules = RouterOsPlan.OLD_RULES;
        const where = RouterOsPlan.DYNAMIC.has(menu) ? " where !dynamic" : "";
        const hasChains = [...wanted, ...existing].some((item) => item.attrs.chain !== undefined);
        const keptChains = new Set(wanted.map((item) => item.attrs.chain ?? ""));
        const droppedChains = [...new Set(existing.map((item) => item.attrs.chain ?? ""))].filter((chain) => !keptChains.has(chain));
        const chainStep = (chain: string, show: string[]): Step => {
            const selector = `[ find chain=${RouterOsPlan.quote(chain)}${RouterOsPlan.DYNAMIC.has(menu) ? " and !dynamic" : ""} ]`;
            return { title: `${menu} chain ${chain}`, show, send: [`${menu} remove ${selector}`] };
        };

        // Nothing kept: each chain goes whole in the last phase. An empty array, `{}`, is a syntax error (RB5009, 7.24.6).
        if (hasChains && !wanted.length) {
            for (const chain of droppedChains) {
                const rules = existing.filter((item) => (item.attrs.chain ?? "") === chain);
                result.last.push(
                    chainStep(
                        chain,
                        rules.map((item) => `- ${RouterOsExport.canonical(item)}`)
                    )
                );
            }
            return result;
        }

        let removeOld = `${menu} remove $${oldRules}`;
        if (hasChains) {
            const keep = [...keptChains].map((chain) => RouterOsPlan.quote(chain)).join(";");
            const inKeptChain = `[:typeof [:find $keep [${menu} get $id chain]]] != "nil"`;
            removeOld = `:local keep {${keep}}; :foreach id in=$${oldRules} do={ :if (${inKeptChain}) do={ ${menu} remove $id } }`;
        }

        const send = [
            // A global survives between the commands of one run, so the rules captured here are the ones removed below.
            `:global ${oldRules} [${menu} find${where}]`,
            ...wanted.map((item) => RouterOsPlan.line(menu, "add", "", item.flags, item.attrs)),
            `:global ${oldRules}; ${removeOld}; /system script environment remove [find name="${oldRules}"]`,
        ];
        const show = [
            ...existing.map((item) => `- ${RouterOsExport.canonical(item)}`),
            ...wanted.map((item) => `+ ${RouterOsExport.canonical(item)}`),
        ];
        result.first.push({ title: `${menu}, in the order of the config`, show, send });

        if (hasChains) {
            for (const chain of droppedChains) result.last.push(chainStep(chain, [`- chain ${chain}`]));
        }

        return result;
    }
}
