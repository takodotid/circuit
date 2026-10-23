// What it takes to make a RouterOS device run exactly what was rendered. Everything the device holds that the render does not is removed or reset.
//
// Two phases. Additions and changes go first, in dependency order, so nothing ever points at something that does not exist yet. Removals go last, in reverse order, so nothing is removed while something still uses it.

import type { ApplyOptions, Plan, Step } from "../platform";
import { type Command, RouterOsExport } from "./export";

/** What is planned for one menu: changes for the first phase, removals for the last. */
type MenuPlan = { first: Step[]; last: Step[] };

export class RouterOsPlan {
    /** A plan line the apply handles itself: upload a certificate and its key, and import them. */
    static readonly INSTALL_CERTIFICATE = "#install-certificate ";

    /** Dependency order. A menu not listed sorts after all of these. The longest matching prefix decides. */
    private static readonly ORDER = [
        // Certificates depend on nothing, and services name them.
        "/certificate",
        "/interface bridge",
        "/interface ethernet",
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
        "/ip vrf",
        "/ip address",
        "/ipv6 address",
        "/ip pool",
        "/ip dhcp-server",
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
        "/snmp",
        "/tool",
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
    ]);

    /** The variable holding the old rules of an ordered menu while the new ones are added. Removed when the rewrite ends. */
    private static readonly OLD_RULES = "frameworkOldRules";

    /** What blocks an apply: something this plan cannot converge. */
    private readonly problems: string[] = [];

    /** Also send every secret, so a rotated value reaches the device. */
    private constructor(private readonly sendSecrets: boolean) {}

    /** What it takes to go from `current` to `desired`. */
    static of(desired: string, current: string, options: Pick<ApplyOptions, "secrets">): Plan {
        const want = RouterOsExport.parse(desired);
        const have = RouterOsExport.parse(current);
        const planner = new RouterOsPlan(options.secrets);

        // Entries of lists filled by `refresh` belong to it, not to the render.
        const owned = (command: Command) => !(command.menu.endsWith("address-list") && want.generated.has(command.attrs.list ?? ""));
        const wantedByMenu = RouterOsPlan.byMenu(want.commands.filter(owned));
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
            else if (RouterOsExport.ORDERED.has(menu)) menuPlan = RouterOsPlan.ordered(menu, wanted, existing);
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

    private static rank(menu: string): number {
        let best = RouterOsPlan.ORDER.length;
        let bestLength = 0;
        RouterOsPlan.ORDER.forEach((prefix, index) => {
            const matches = menu === prefix || menu.startsWith(prefix + " ");
            if (matches && prefix.length > bestLength) {
                best = index;
                bestLength = prefix.length;
            }
        });
        return best;
    }

    /** Quote a value for a command. */
    private static quote(value: string): string {
        return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$")}"`;
    }

    /** A value as a command takes it: bare when plain, quoted otherwise. */
    private static value(raw: string): string {
        return /^[\w.:/@,!-]+$/.test(raw) ? raw : RouterOsPlan.quote(raw);
    }

    /** In a `find`, a quoted `yes` is a string and matches no boolean, while an unquoted slash matches nothing. Plain words go bare, anything else quoted. */
    private static findValue(raw: string): string {
        return /^[\w.:-]+$/.test(raw) ? raw : RouterOsPlan.quote(raw);
    }

    /** A selector for the entry with this identity. */
    private static find(menu: string, id: Record<string, string>): string {
        const conditions = Object.entries(id).map(([property, raw]) => `${property}=${RouterOsPlan.findValue(raw)}`);
        if (RouterOsPlan.DYNAMIC.has(menu)) conditions.push("!dynamic");
        return `[ find ${conditions.join(" and ")} ]`;
    }

    /** A whole command as sent: menu, verb, selector, flags, then properties. */
    private static line(menu: string, verb: string, selector: string, flags: string[], attrs: Record<string, string>): string {
        const properties = Object.entries(attrs).map(([property, raw]) => `${property}=${RouterOsPlan.value(raw)}`);
        return [menu, verb, selector, ...flags, ...properties].filter(Boolean).join(" ");
    }

    private static describe(attrs: Record<string, string>): string {
        return Object.entries(attrs)
            .map(([property, raw]) => `${property}=${raw}`)
            .join(" ");
    }

    /** Group commands by menu. */
    private static byMenu(commands: Command[]): Map<string, Command[]> {
        const groups = new Map<string, Command[]>();

        for (const command of commands) {
            const group = groups.get(command.menu) ?? [];
            group.push(command);
            groups.set(command.menu, group);
        }

        return groups;
    }

    /**
     * The properties to send so that the device's entry matches the rendered one. A property the device holds and the render does not state is reset to its default.
     */
    private changes(wanted: Command, existing: Command | undefined, label: string): Record<string, string> {
        const want = RouterOsExport.normal(wanted);
        const have = existing ? RouterOsExport.normal(existing) : {};
        const result: Record<string, string> = {};

        for (const [property, desired] of Object.entries(want)) {
            if (have[property] !== desired) result[property] = desired;
        }

        for (const property of Object.keys(have)) {
            if (property in want) continue;

            const clearedWith = RouterOsExport.CLEARED_WITH[wanted.menu]?.[property];
            if (clearedWith && !(clearedWith in want)) continue;

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

        for (const entry of wantedEntries) {
            const entryKey = key(entry);
            kept.add(entryKey);
            const current = existingByKey.get(entryKey);

            if (!current) {
                changeStep.show.push(`+ ${RouterOsExport.canonical(entry)}`);
                changeStep.send.push(RouterOsPlan.line(menu, "add", "", entry.flags, entry.attrs));
                continue;
            }

            // A flag such as `blackhole` cannot be changed on an existing entry. It is replaced.
            const flagsDiffer = [...entry.flags].sort().join() !== [...current.flags].sort().join();
            if (flagsDiffer) {
                changeStep.show.push(`~ replace ${RouterOsExport.canonical(entry)}`);
                removeStep.send.push(`${menu} remove ${RouterOsPlan.find(menu, RouterOsExport.identity(current))}`);
                changeStep.send.push(RouterOsPlan.line(menu, "add", "", entry.flags, entry.attrs));
                continue;
            }

            const update = this.changes(entry, current, `${menu} ${entryKey}`);
            if (!Object.keys(update).length) continue;

            changeStep.show.push(`~ ${entryKey} ${RouterOsPlan.describe(update)}`);
            changeStep.send.push(RouterOsPlan.line(menu, "set", RouterOsPlan.find(menu, RouterOsExport.identity(current)), [], update));
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
            removeStep.send.push(`${menu} remove ${RouterOsPlan.find(menu, RouterOsExport.identity(entry))}`);
        }

        if (changeStep.send.length) result.first.push(changeStep);
        if (removeStep.send.length) result.last.push(removeStep);
        return result;
    }

    /**
     * Certificates are installed from the config when missing or different, after the old one of that name is removed. One the device holds under another name, with the same fingerprint and key, is renamed rather than imported a second time. One the config does not hold is removed in the last phase.
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
     * An ordered menu is rewritten whole whenever it differs, so the device lists its rules in the order the render gives.
     *
     * The old rules are captured, the new ones added after them, then the captured ones removed. Until that moment the old rules keep deciding, so no chain is ever empty or half new.
     *
     * In a menu with chains, an old rule is removed in this step only if its chain is still wanted. A chain no longer wanted is removed in the last phase, after whatever pointed at it has been changed.
     */
    private static ordered(menu: string, wanted: Command[], existing: Command[]): MenuPlan {
        const result: MenuPlan = { first: [], last: [] };
        const same =
            wanted.map((item) => RouterOsExport.canonical(item)).join("\n") ===
            existing.map((item) => RouterOsExport.canonical(item)).join("\n");
        if (same) return result;

        const oldRules = RouterOsPlan.OLD_RULES;
        const where = RouterOsPlan.DYNAMIC.has(menu) ? " where !dynamic" : "";
        const hasChains = [...wanted, ...existing].some((item) => item.attrs.chain !== undefined);
        const keptChains = new Set(wanted.map((item) => item.attrs.chain ?? ""));
        const droppedChains = [...new Set(existing.map((item) => item.attrs.chain ?? ""))].filter((chain) => !keptChains.has(chain));

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
            for (const chain of droppedChains) {
                const selector = `[ find chain=${RouterOsPlan.quote(chain)}${RouterOsPlan.DYNAMIC.has(menu) ? " and !dynamic" : ""} ]`;
                result.last.push({ title: `${menu} chain ${chain}`, show: [`- chain ${chain}`], send: [`${menu} remove ${selector}`] });
            }
        }

        return result;
    }
}
