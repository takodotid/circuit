// @ts-check
/// <reference lib="dom" />
// Studio's tables, for reading the config without reading TypeScript: every device and everything it holds, and the network's VLANs, addresses, BGP sessions and cables.

import { Compare } from "./compare.js";
import { Diff } from "./diff.js";
import { Dom } from "./dom.js";
import { Export } from "./export.js";
import { Graph } from "./graph.js";

/** @typedef {import("../../schema").Device} Device */
/** @typedef {import("../data").StudioData} StudioData */
/** @typedef {import("./dom.js").Child} Child */
/** A column named after a field shows the name as code. A table with `csv` can be saved under that name. @typedef {{ head: { label: string, title?: string, field?: boolean }[], rows: { cells: Child[], muted?: boolean, id?: string }[], csv?: string }} Table */
/** @typedef {{ id: string, title: string, has: (device: Device) => boolean, render: (device: Device) => Child[] }} Section */
/** How a port is used. @typedef {"shut" | "lag" | "access" | "trunk" | "routed" | "plain"} PortUse */

export class Tables {
    /** What the tables show, set each time they are drawn. @type {StudioData} */
    static #data;

    /**
     * @param {unknown} value
     * @returns {value is Record<string, unknown>}
     */
    static #isObject(value) {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    /** @param {unknown} value */
    static #isSecret(value) {
        return (
            Tables.#isObject(value) &&
            Object.keys(value).length === 1 &&
            (typeof value.secret === "string" || typeof value.secret_file === "string")
        );
    }

    /** @param {Record<string, unknown>} value */
    static #secretText(value) {
        return typeof value.secret === "string" ? `secret("${value.secret}")` : `secretFile("${value.secret_file}")`;
    }

    /**
     * What a field is, from the schema's comments: looked up in these types, and the types they take fields from.
     *
     * @param {readonly string[]} types
     * @param {string} field
     * @returns {string | undefined}
     */
    static #describe(types, field) {
        const seen = new Set();
        const queue = [...types];

        for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
            if (seen.has(name)) continue;
            seen.add(name);

            const type = Tables.#data.docs[name];
            if (!type) continue;

            const found = type.fields[field] ?? Object.entries(type.fields).find(([path]) => path.endsWith(`.${field}`))?.[1];
            if (found?.description) return found.description;

            queue.push(...type.includes);
        }

        return undefined;
    }

    /**
     * A value in one line of text.
     *
     * @param {unknown} value
     * @returns {string}
     */
    static #compact(value) {
        if (value === undefined || value === null) return "";
        if (Tables.#isSecret(value)) return Tables.#secretText(/** @type {Record<string, unknown>} */ (value));
        if (Array.isArray(value)) return value.map(Tables.#compact).join(value.every((item) => !Tables.#isObject(item)) ? ", " : " / ");

        // A field written as `{}`, such as `ssh: {}`, is on with its defaults.
        if (Tables.#isObject(value) && !Object.keys(value).length) return "on";
        if (Tables.#isObject(value)) {
            return Object.entries(value)
                .map(([key, inner]) => (inner === true ? key : `${key} ${Tables.#compact(inner)}`))
                .join(", ");
        }

        return String(value);
    }

    /**
     * @param {Table} table
     * @returns {Node}
     */
    static of({ head, rows, csv }) {
        /** @param {Table["rows"][number]} row */
        const attributesOf = (row) => ({ ...(row.muted ? { class: "muted" } : {}), ...(row.id ? { id: row.id } : {}) });

        const element = Dom.h(
            "table",
            { class: "data" },
            Dom.h(
                "thead",
                {},
                Dom.h(
                    "tr",
                    {},
                    ...head.map((column) =>
                        Dom.h(
                            "th",
                            column.title ? { title: column.title } : {},
                            column.field ? Dom.h("code", {}, column.label) : column.label
                        )
                    )
                )
            ),
            Dom.h("tbody", {}, ...rows.map((row) => Dom.h("tr", attributesOf(row), ...row.cells.map((cell) => Dom.h("td", {}, cell)))))
        );

        if (!csv) return element;

        const download = Dom.link("Save as CSV", () => Export.save(`${csv}.csv`, new Blob([Export.csv(element)], { type: "text/csv" })));
        return Dom.h("div", { class: "table-block" }, Dom.h("p", { class: "table-actions" }, download), element);
    }

    /**
     * The fields any of the items hold, in the order first seen, with a chosen few first.
     *
     * @param {Record<string, unknown>[]} items
     * @param {readonly string[]} [first]
     */
    static #columnsOf(items, first = []) {
        const seen = new Set(first.filter((key) => items.some((item) => key in item)));
        for (const item of items) for (const key of Object.keys(item)) seen.add(key);
        return [...seen];
    }

    /**
     * Named items, such as ports or neighbors, as a table: a row per name, a column per field.
     *
     * @param {object} record
     * @param {readonly string[]} types
     * @param {string} [nameLabel]
     * @param {readonly string[]} [first]
     * @returns {Node}
     */
    static #recordTable(record, types, nameLabel = "Name", first = []) {
        const entries = Object.entries(record).filter(([, value]) => value !== undefined);
        if (!entries.length) return Tables.empty("None.");

        /** @type {Record<string, unknown>[]} */
        const items = entries.map(([, value]) => (Tables.#isObject(value) && !Tables.#isSecret(value) ? value : { value }));
        const columns = Tables.#columnsOf(items, first);

        return Tables.of({
            head: [
                { label: nameLabel },
                ...columns.map((column) => ({ label: column, title: Tables.#describe(types, column), field: true })),
            ],
            rows: entries.map(([name], index) => ({
                cells: [Dom.h("strong", {}, name), ...columns.map((column) => Tables.#compact(items[index]?.[column]))],
            })),
        });
    }

    /**
     * A list of items, such as rules or routes, as a table, in order.
     *
     * @param {readonly unknown[]} list
     * @param {readonly string[]} types
     * @param {readonly string[]} [first]
     * @returns {Node}
     */
    static #listTable(list, types, first = []) {
        if (!list.length) return Tables.empty("None.");

        const items = list.map((value) => (Tables.#isObject(value) ? value : { value }));
        const columns = Tables.#columnsOf(items, first);

        return Tables.of({
            head: [{ label: "#" }, ...columns.map((column) => ({ label: column, title: Tables.#describe(types, column), field: true }))],
            rows: items.map((item, index) => ({ cells: [String(index + 1), ...columns.map((column) => Tables.#compact(item[column]))] })),
        });
    }

    /**
     * Settings as a table of field and value. A value that holds more is shown inside, the same way.
     *
     * @param {object} object
     * @param {readonly string[]} types
     * @returns {Node}
     */
    static #settings(object, types) {
        const entries = Object.entries(object).filter(([, value]) => value !== undefined);
        if (!entries.length) return Tables.empty("None.");

        /**
         * @param {unknown} value
         * @returns {Child}
         */
        const valueOf = (value) => {
            if (Tables.#isObject(value) && !Object.keys(value).length) return Tables.#compact(value);
            if (Tables.#isObject(value) && !Tables.#isSecret(value)) {
                const allObjects = Object.values(value).every((inner) => Tables.#isObject(inner) && !Tables.#isSecret(inner));
                return allObjects ? Tables.#recordTable(value, types) : Tables.#settings(value, types);
            }

            if (Array.isArray(value) && value.some(Tables.#isObject)) return Tables.#listTable(value, types);
            return Tables.#compact(value);
        };

        return Dom.h(
            "table",
            { class: "data settings" },
            Dom.h(
                "tbody",
                {},
                ...entries.map(([key, value]) => {
                    const title = Tables.#describe(types, key);
                    return Dom.h("tr", {}, Dom.h("th", title ? { title } : {}, Dom.h("code", {}, key)), Dom.h("td", {}, valueOf(value)));
                })
            )
        );
    }

    /**
     * @param {string} text
     * @param {"h2" | "h3" | "h4"} [level]
     */
    static heading(text, level = "h3") {
        return Dom.h(level, {}, text);
    }

    /** @param {string} text */
    static empty(text) {
        return Dom.h("p", { class: "muted" }, text);
    }

    /**
     * A muted paragraph of several parts, such as text with a command in it.
     *
     * @param {...import("./dom.js").Child} parts
     */
    static prose(...parts) {
        return Dom.h("p", { class: "muted" }, ...parts);
    }

    /** @param {string} name */
    static deviceLink(name) {
        return Dom.link(name, () => Dom.go(`devices/${encodeURIComponent(name)}`));
    }

    /** @param {string} name */
    static #deviceRoute(name) {
        return `devices/${encodeURIComponent(name)}`;
    }

    /**
     * @param {string} device
     * @returns {Child[]}
     */
    static #findingBadges(device) {
        const findings = Tables.#data.graph.findings.filter((finding) => finding.device === device);
        const errors = findings.filter((finding) => finding.level === "error").length;
        const warnings = findings.length - errors;

        return [
            errors ? Dom.h("span", { class: "badge error" }, `${errors} ${errors === 1 ? "error" : "errors"}`) : undefined,
            warnings ? Dom.h("span", { class: "badge warning" }, `${warnings} ${warnings === 1 ? "warning" : "warnings"}`) : undefined,
        ];
    }

    /** @type {Record<string, string>} */
    static #SNAPSHOT_TEXT = {
        matches: "matches its snapshot",
        differs: "differs from its snapshot",
        "no snapshot": "no snapshot yet",
        "cannot plan": "cannot be planned",
    };

    /**
     * How a port is used, for its square on the faceplate.
     *
     * @param {Record<string, unknown> | undefined} port
     * @returns {PortUse}
     */
    static #portUse(port) {
        if (!port) return "shut";
        if (port.lag) return "lag";
        if (port.access_vlan) return "access";
        if (port.trunk_vlans) return "trunk";
        if (port.addresses) return "routed";
        return "plain";
    }

    /** @type {Record<PortUse, string>} */
    static #PORT_USES = {
        shut: "shut down",
        lag: "in a LAG",
        access: "access",
        trunk: "trunk",
        routed: "routed",
        plain: "up, nothing on it",
    };

    /**
     * The device's ports as its front panel: one square per port, by speed, colored by how the port is used. A square points to its row.
     *
     * @param {Device} device
     * @param {string[]} ports
     * @param {Record<string, Record<string, unknown> | undefined>} declared
     */
    static #faceplate(device, ports, declared) {
        /** @type {Map<string, string[]>} */
        const bySpeed = new Map();
        for (const name of ports) {
            const speed = name.split("-")[0] ?? name;
            bySpeed.set(speed, [...(bySpeed.get(speed) ?? []), name]);
        }

        const panel = Dom.h("div", { class: "faceplate", role: "group", "aria-label": `${device.name}'s ports` });

        for (const [speed, names] of bySpeed) {
            const squares = Dom.h("div", { class: "ports" });

            for (const name of names) {
                const port = declared[name];
                const use = Tables.#portUse(port);
                const far = /** @type {{ device: string, port: string } | undefined} */ (port?.link);
                const label = [name, Tables.#PORT_USES[use], Tables.#compact(port?.description), far ? `to ${far.device} ${far.port}` : ""]
                    .filter(Boolean)
                    .join(", ");

                const square = Dom.h(
                    "button",
                    { class: `port ${use}${far ? " linked" : ""}`, title: label, "aria-label": label },
                    name.split("-")[1] ?? name
                );
                square.addEventListener("click", () => {
                    const row = document.getElementById(`port-${name}`);
                    row?.scrollIntoView({ block: "center", behavior: "smooth" });
                    row?.classList.add("flash");
                    setTimeout(() => row?.classList.remove("flash"), 1600);
                });
                squares.append(square);
            }

            panel.append(Dom.h("div", { class: "speed" }, Dom.h("span", { class: "speed-name" }, speed), squares));
        }

        const legend = Dom.h(
            "ul",
            { class: "faceplate-legend" },
            ...Object.entries(Tables.#PORT_USES).map(([use, text]) => Dom.h("li", {}, Dom.h("span", { class: `port ${use}` }), text)),
            Dom.h("li", {}, Dom.h("span", { class: "port plain linked" }), "linked to another device")
        );

        return Dom.h("div", {}, panel, legend);
    }

    /**
     * Two texts compared line by line: what is the same is folded away, except a few lines around each change.
     *
     * @param {string} before
     * @param {string} after
     * @returns {Child}
     */
    static lineDiff(before, after) {
        const lines = Diff.lines(before.trimEnd().split("\n"), after.trimEnd().split("\n"));
        if (!lines) return Tables.empty("They differ in too many lines to compare one by one. The plan shows what would be sent.");

        const changed = lines.filter((line) => line.kind !== "same").length;
        if (!changed) return Tables.empty("They are the same, line for line.");

        const context = 3;
        const near = lines.map((_, index) =>
            lines.slice(Math.max(0, index - context), index + context + 1).some((line) => line.kind !== "same")
        );

        const code = Dom.h("pre", { class: "code diff" });
        let folded = 0;

        const fold = () => {
            if (folded) code.append(Dom.h("span", { class: "fold" }, `${folded} ${folded === 1 ? "line" : "lines"} the same\n`));
            folded = 0;
        };

        for (const [index, line] of lines.entries()) {
            if (!near[index]) {
                folded++;
                continue;
            }

            fold();
            const mark = line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  ";
            code.append(Dom.h("span", { class: line.kind }, `${mark}${line.text}\n`));
        }

        fold();
        return Dom.h("div", {}, Tables.empty(`${changed} ${changed === 1 ? "line differs" : "lines differ"}.`), code);
    }

    /** The fields the Ports table has columns of its own for. */
    static #PORT_FIELDS = ["description", "access_vlan", "trunk_vlans", "native_vlan", "addresses", "lag", "link"];

    /**
     * How a port is switched. A LAG member carries what its LAG carries.
     *
     * @param {Device} device
     * @param {Record<string, unknown>} port
     * @returns {string}
     */
    static #switching(device, port) {
        const lag = typeof port.lag === "string" ? device.interfaces?.[port.lag] : undefined;
        if (lag) {
            const carried = Tables.#switching(device, { ...lag, lag: undefined });
            return carried ? `${carried}, on LAG ${port.lag}` : "";
        }

        if (port.access_vlan) return `access ${port.access_vlan}`;
        if (Array.isArray(port.trunk_vlans))
            return `trunk ${port.trunk_vlans.join(", ")}${port.native_vlan ? `, native ${port.native_vlan}` : ""}`;
        return "";
    }

    // A device's sections. Each lists the schema types its fields come from, for their descriptions.
    /** @type {Section[]} */
    static #SECTIONS = [
        {
            id: "overview",
            title: "Overview",
            has: () => true,
            render(device) {
                const findings = Tables.#data.graph.findings.filter((finding) => finding.device === device.name);
                const drift = Tables.#data.graph.drift[device.name];

                const { platform, model, connection, system, hardware_offload, lldp, stp, vrfs } = device;
                const shown = { platform, model, connection, hardware_offload, lldp, stp, vrfs, system };
                const differs = drift?.status === "differs";

                return [
                    findings.length ? Dom.h("h3", {}, "Found by ", Dom.h("code", {}, "circuit validate")) : undefined,
                    findings.length
                        ? Dom.h(
                              "ul",
                              { class: "findings" },
                              ...findings.map((finding) =>
                                  Dom.h("li", {}, Dom.h("span", { class: `badge ${finding.level}` }, finding.level), finding.message)
                              )
                          )
                        : undefined,
                    Tables.heading("Against its snapshot"),
                    Dom.h(
                        "p",
                        {},
                        drift ? (Tables.#SNAPSHOT_TEXT[drift.status] ?? "") : "not compared",
                        differs ? " · " : "",
                        differs ? Dom.link("see the plan", () => Dom.go(`${Tables.#deviceRoute(device.name)}/plan`)) : undefined
                    ),
                    Tables.heading("Device"),
                    Tables.#settings(shown, ["Device", "Connection", "System", "Vrf"]),
                ];
            },
        },
        {
            id: "ports",
            title: "Ports",
            has: () => true,
            render(device) {
                const declared = /** @type {Record<string, Record<string, unknown> | undefined>} */ (device.ports ?? {});
                const all = [...new Set([...(Tables.#data.ports[device.name] ?? []), ...Object.keys(declared)])];
                const types = ["Port", "Routed", "Switched", "Link", "PortStp", "Vrrp", "Exchange"];

                const rows = all.map((name) => {
                    const port = declared[name];
                    const id = `port-${name}`;
                    if (!port) return { id, cells: [name, "not declared, so shut down", "", "", "", "", ""], muted: true };

                    const far = /** @type {{ device: string, port: string } | undefined} */ (port.link);
                    const other = Object.fromEntries(Object.entries(port).filter(([key]) => !Tables.#PORT_FIELDS.includes(key)));

                    return {
                        id,
                        cells: [
                            Dom.h("strong", {}, name),
                            Tables.#compact(port.description),
                            Tables.#switching(device, port),
                            Tables.#compact(port.addresses),
                            Tables.#compact(port.lag),
                            far ? Dom.h("span", {}, Tables.deviceLink(far.device), ` ${far.port}`) : "",
                            Object.keys(other).length ? Tables.#compact(other) : "",
                        ],
                    };
                });

                /**
                 * @param {string} label
                 * @param {string} [field]
                 */
                const column = (label, field) => ({ label, title: field ? Tables.#describe(types, field) : undefined });
                const used = Object.keys(declared).length;

                return [
                    Dom.h(
                        "p",
                        { class: "muted" },
                        `${used} of ${all.length} ports declared. A port the config does not declare is shut down.`
                    ),
                    Tables.#faceplate(device, all, declared),
                    Tables.of({
                        csv: `${device.name}-ports`,
                        head: [
                            column("Port"),
                            column("Description", "description"),
                            column("VLANs", "trunk_vlans"),
                            column("Addresses", "addresses"),
                            column("LAG", "lag"),
                            column("Link", "link"),
                            column("Other"),
                        ],
                        rows,
                    }),
                ];
            },
        },
        {
            id: "interfaces",
            title: "Interfaces",
            has: (device) => Object.keys(device.interfaces ?? {}).length > 0,
            render: (device) => [
                Tables.#recordTable(
                    device.interfaces ?? {},
                    [
                        "VlanInterface",
                        "Loopback",
                        "Lag",
                        "Gre",
                        "Vxlan",
                        "WireGuard",
                        "Base",
                        "Routed",
                        "Switched",
                        "Vrrp",
                        "WireGuardPeer",
                        "Exchange",
                    ],
                    "Interface",
                    ["type", "description", "vlan", "addresses"]
                ),
            ],
        },
        {
            id: "vlans",
            title: "VLANs",
            has: (device) => Object.keys(device.vlans ?? {}).length > 0,
            render: (device) => [Tables.#recordTable(device.vlans ?? {}, ["Vlan"], "VLAN", ["id", "description"])],
        },
        {
            id: "routing",
            title: "Routing",
            has: (device) => device.routing !== undefined,
            render(device) {
                const routing = device.routing ?? {};
                const types = ["Routing", "StaticRoute", "Bgp", "Neighbor", "NeighborSettings", "Ospf", "OspfInterface", "RpkiServer"];
                /** @type {Child[]} */
                const parts = [];

                if (routing.router_id) parts.push(Tables.#settings({ router_id: routing.router_id }, types));
                if (routing.static?.length)
                    parts.push(Tables.heading("Static routes"), Tables.#listTable(routing.static, types, ["prefix", "via", "interface"]));

                if (routing.bgp) {
                    const { asn, networks, groups, neighbors } = routing.bgp;
                    parts.push(Tables.heading("BGP"), Tables.#settings({ asn, networks }, types));
                    if (groups) parts.push(Tables.heading("BGP groups"), Tables.#recordTable(groups, types, "Group"));
                    if (neighbors)
                        parts.push(
                            Tables.heading("BGP neighbors"),
                            Tables.#recordTable(neighbors, types, "Neighbor", ["address", "group", "remote_as", "role"])
                        );
                }

                if (routing.ospf) {
                    const { families, redistribute } = routing.ospf;
                    parts.push(Tables.heading("OSPF"));
                    if (families || redistribute) parts.push(Tables.#settings({ families, redistribute }, types));
                    for (const [area, { interfaces }] of Object.entries(routing.ospf.areas)) {
                        parts.push(Tables.heading(`Area ${area}`, "h4"), Tables.#recordTable(interfaces, types, "Interface"));
                    }
                }

                if (routing.rpki?.length) parts.push(Tables.heading("RPKI"), Tables.#listTable(routing.rpki, types));
                return parts;
            },
        },
        {
            id: "policies",
            title: "Policies",
            has: (device) => Object.keys({ ...device.policies, ...device.prefix_sets }).length > 0,
            render(device) {
                const types = ["PolicyRule", "Match", "Sets", "PrefixSet"];
                /** @type {Child[]} */
                const parts = [];

                for (const [name, rules] of Object.entries(device.policies ?? {})) {
                    parts.push(
                        Tables.heading(`Policy ${name}`),
                        Tables.#listTable(rules, types, ["description", "match", "set", "action"])
                    );
                }

                if (device.prefix_sets)
                    parts.push(Tables.heading("Prefix sets"), Tables.#recordTable(device.prefix_sets, types, "Prefix set"));
                return parts;
            },
        },
        {
            id: "firewall",
            title: "Firewall",
            has: (device) => device.firewall !== undefined || Object.keys(device.acls ?? {}).length > 0,
            render(device) {
                const types = ["Firewall", "Chain", "FilterRule", "FilterMatch", "NatRule", "AclRule"];
                const firewall = device.firewall;
                /** @type {Child[]} */
                const parts = [];

                if (firewall?.address_sets) {
                    parts.push(
                        Tables.heading("Address sets"),
                        Tables.of({
                            head: [{ label: "Set" }, { label: "Members" }],
                            rows: Object.entries(firewall.address_sets).map(([name, members]) => ({
                                cells: [Dom.h("strong", {}, name), Tables.#compact(members)],
                            })),
                        })
                    );
                }

                // A filter chain has a default and rules; a NAT chain is its rules.
                for (const [chain, settingsOfChain] of Object.entries(firewall?.filter ?? {})) {
                    if (!settingsOfChain) continue;
                    const fallback = settingsOfChain.default ? `, default ${settingsOfChain.default}` : "";
                    parts.push(
                        Tables.heading(`Filter ${chain}${fallback}`),
                        Tables.#listTable(settingsOfChain.rules ?? [], types, ["description", "match", "action"])
                    );
                }

                for (const [chain, rules] of Object.entries(firewall?.nat ?? {})) {
                    if (rules)
                        parts.push(Tables.heading(`NAT ${chain}`), Tables.#listTable(rules, types, ["description", "match", "action"]));
                }

                const { helpers, untracked } = firewall ?? {};
                if (helpers || untracked) parts.push(Tables.heading("Other"), Tables.#settings({ helpers, untracked }, types));

                for (const [name, rules] of Object.entries(device.acls ?? {})) {
                    parts.push(Tables.heading(`ACL ${name}`), Tables.#listTable(rules, types, ["description", "match", "action"]));
                }

                return parts;
            },
        },
        {
            id: "management",
            title: "Management",
            has: () => true,
            render(device) {
                const types = ["Management", "Service", "SnmpUser", "User", "Certificate"];

                // A certificate is shown by its size; it is public, but a page of PEM helps no one here.
                const certificates = Object.fromEntries(
                    Object.entries(device.certificates ?? {}).map(([name, certificate]) => [
                        name,
                        { ...certificate, certificate: `PEM, ${certificate.certificate.trim().split("\n").length} lines` },
                    ])
                );
                const hasCertificates = Object.keys(certificates).length > 0;

                return [
                    Tables.heading("Users"),
                    Tables.#recordTable(device.users ?? {}, types, "User", ["role", "description"]),
                    Tables.heading("Ways in"),
                    Tables.#settings(device.management ?? {}, types),
                    hasCertificates ? Tables.heading("Certificates") : undefined,
                    hasCertificates ? Tables.#recordTable(certificates, types, "Certificate") : undefined,
                ];
            },
        },
        {
            id: "services",
            title: "Services",
            has: (device) => Boolean(device.dhcp || device.dhcp_relay || device.flow_export),
            render(device) {
                const types = ["DhcpServer", "DhcpRelay", "FlowExport"];

                return [
                    device.dhcp ? Tables.heading("DHCP servers") : undefined,
                    device.dhcp
                        ? Tables.#recordTable(device.dhcp, types, "Server", ["interface", "network", "gateway", "pool"])
                        : undefined,
                    device.dhcp_relay ? Tables.heading("DHCP relays") : undefined,
                    device.dhcp_relay ? Tables.#recordTable(device.dhcp_relay, types, "Relay") : undefined,
                    device.flow_export ? Tables.heading("Flow export") : undefined,
                    device.flow_export ? Tables.#settings(device.flow_export, types) : undefined,
                ];
            },
        },
        {
            id: "config",
            title: "Config",
            has: () => true,
            render: (device) => [
                Tables.prose(
                    "What the device should run, in its vendor's commands, as ",
                    Dom.h("code", {}, "circuit build"),
                    " prints it. Secrets are markers, never values."
                ),
                Dom.h("pre", { class: "code" }, Tables.#data.rendered[device.name] ?? ""),
            ],
        },
        {
            id: "running",
            title: "Running",
            has: () => true,
            render(device) {
                const snapshot = Tables.#data.snapshots[device.name];
                if (snapshot === undefined)
                    return [Tables.prose("No snapshot yet, so nothing to compare with: run ", Dom.h("code", {}, "circuit snapshot"), ".")];

                return [
                    Tables.prose(
                        "What the device ran when Circuit last read it, ",
                        Dom.h("span", { class: "removed" }, "marked -"),
                        ", beside what the config would have it run, ",
                        Dom.h("span", { class: "added" }, "marked +"),
                        ". Lines can differ only in order or form; the plan shows what would be sent."
                    ),
                    Tables.lineDiff(snapshot, Tables.#data.rendered[device.name] ?? ""),
                ];
            },
        },
        {
            id: "history",
            title: "History",
            has: () => true,
            render(device) {
                const area = Dom.h("div", {}, Tables.empty("Reading the history…"));
                const files = Tables.#data.files[device.name] ?? {};

                void Compare.fetchJson(`history?device=${encodeURIComponent(device.name)}`).then((found) => {
                    area.replaceChildren();
                    if (!Array.isArray(found))
                        return area.append(Tables.empty(`No history: ${"error" in found ? found.error : "git has none"}.`));
                    if (!found.length) return area.append(Tables.empty("No commit has changed it yet."));

                    area.append(
                        Tables.prose(
                            "The commits that changed ",
                            files.source ? Dom.h("code", {}, files.source) : "its file",
                            files.snapshot ? Dom.h("span", {}, " or its snapshot, ", Dom.h("code", {}, files.snapshot)) : "",
                            ", newest first."
                        ),
                        Tables.of({
                            csv: `${device.name}-history`,
                            head: ["When", "Who", "What", "Commit", ""].map((label) => ({ label })),
                            rows: /** @type {import("../git").Commit[]} */ (found).map((commit) => ({
                                cells: [
                                    new Date(commit.date).toLocaleString(),
                                    commit.author,
                                    commit.subject,
                                    Dom.h("code", {}, commit.short),
                                    Dom.link("compare with now", () => Dom.go(`compare/${commit.commit}`)),
                                ],
                            })),
                        })
                    );
                });

                return [area];
            },
        },
        {
            id: "plan",
            title: "Plan",
            has: () => true,
            render(device) {
                const drift = Tables.#data.graph.drift[device.name];
                if (!drift || drift.status === "no snapshot")
                    return [Tables.prose("No snapshot yet, so nothing to compare with: run ", Dom.h("code", {}, "circuit snapshot"), ".")];
                if (drift.status === "matches")
                    return [
                        Tables.prose("The device matches its last snapshot: ", Dom.h("code", {}, "circuit diff"), " would send nothing."),
                    ];

                return [
                    drift.status === "differs"
                        ? Tables.prose("What ", Dom.h("code", {}, "circuit diff"), " would send, against the last snapshot:")
                        : Tables.empty("It could not be planned:"),
                    Dom.h("pre", { class: "code" }, drift.lines.join("\n")),
                ];
            },
        },
    ];

    /** @param {HTMLElement} container */
    static #devicesView(container) {
        container.append(
            Tables.heading("Devices", "h2"),
            Tables.of({
                csv: "devices",
                head: ["Name", "Platform", "Model", "Reached at", "Ports declared", "Snapshot", "Found"].map((label) => ({ label })),
                rows: Tables.#data.devices.map((device) => {
                    const badges = Tables.#findingBadges(device.name);

                    return {
                        cells: [
                            Dom.h("strong", {}, Tables.deviceLink(device.name)),
                            device.platform,
                            device.model,
                            device.connection.host,
                            `${Object.keys(device.ports ?? {}).length} of ${Tables.#data.ports[device.name]?.length ?? "?"}`,
                            Tables.#SNAPSHOT_TEXT[Tables.#data.graph.drift[device.name]?.status ?? ""] ?? "",
                            badges.some(Boolean) ? Dom.h("span", {}, ...badges) : Dom.h("span", { class: "muted" }, "nothing"),
                        ],
                    };
                }),
            })
        );
    }

    /**
     * @param {string} name
     * @param {string | undefined} sectionId
     * @param {HTMLElement} container
     */
    static #deviceView(name, sectionId, container) {
        const device = Tables.#data.devices.find((candidate) => candidate.name === name);
        if (!device) {
            container.append(
                Tables.heading("No such device", "h2"),
                Tables.empty(`The config has no device ${name}.`),
                Dom.link("All devices", () => Dom.go("devices"))
            );
            return;
        }

        const sections = Tables.#SECTIONS.filter((section) => section.has(device));
        const section = sections.find((candidate) => candidate.id === sectionId) ?? Tables.#SECTIONS[0];
        if (!section) return;

        const tabs = Dom.h("nav", { class: "tabs", "aria-label": "Sections" });
        for (const candidate of sections) {
            const button = Dom.h("button", { "aria-pressed": String(candidate === section) }, candidate.title);
            button.addEventListener("click", () => Dom.go(`${Tables.#deviceRoute(device.name)}/${candidate.id}`));
            tabs.append(button);
        }

        container.append(
            Dom.h(
                "p",
                { class: "crumbs" },
                Dom.link("Devices", () => Dom.go("devices")),
                " / "
            ),
            Dom.h("h2", {}, device.name, " ", ...Tables.#findingBadges(device.name)),
            Dom.h(
                "p",
                { class: "muted" },
                `${device.platform} ${device.model}, reached at ${device.connection.host} · `,
                Dom.link("show in the graph", () => {
                    Graph.selectDevice(device.name);
                    Dom.go(`graph/${Graph.currentLayer()}`);
                })
            ),
            tabs,
            Dom.h("div", { class: "section" }, ...section.render(device))
        );
    }

    /** @param {HTMLElement} container */
    static #vlansView(container) {
        /** @type {Map<number, { names: Set<string>, declared: string[], gateways: string[], ports: string[] }>} */
        const byId = new Map();

        for (const device of Tables.#data.devices) {
            for (const [name, vlan] of Object.entries(device.vlans ?? {})) {
                const row = byId.get(vlan.id) ?? { names: new Set(), declared: [], gateways: [], ports: [] };
                row.names.add(name);
                row.declared.push(device.name);

                for (const [iface, settingsOfInterface] of Object.entries(device.interfaces ?? {})) {
                    if (settingsOfInterface.type === "vlan" && settingsOfInterface.vlan === name) {
                        row.gateways.push(`${device.name} ${iface} ${Tables.#compact(settingsOfInterface.addresses)}`.trim());
                    }
                }

                const carriers = /** @type {(Record<string, unknown> | undefined)[]} */ (
                    Object.values({ ...device.ports, ...device.interfaces })
                );
                const access = carriers.filter((carrier) => carrier?.access_vlan === name).length;
                const trunk = carriers.filter(
                    (carrier) => Array.isArray(carrier?.trunk_vlans) && carrier.trunk_vlans.includes(name)
                ).length;
                const counts = [access ? `${access} access` : "", trunk ? `${trunk} trunk` : ""].filter(Boolean).join(", ");
                if (counts) row.ports.push(`${device.name}: ${counts}`);

                byId.set(vlan.id, row);
            }
        }

        const rows = [...byId].sort(([a], [b]) => a - b);

        container.append(
            Tables.heading("VLANs", "h2"),
            Tables.empty("Every VLAN any device declares. One id under two names is worth a look."),
            rows.length
                ? Tables.of({
                      csv: "vlans",
                      head: ["VLAN", "Name", "Declared on", "Gateway", "Ports", ""].map((label) => ({ label })),
                      rows: rows.map(([id, row]) => ({
                          cells: [
                              Dom.h("strong", {}, String(id)),
                              [...row.names].join(", "),
                              Dom.h("span", {}, ...row.declared.flatMap((name, index) => [index ? ", " : "", Tables.deviceLink(name)])),
                              row.gateways.join("; "),
                              row.ports.join("; "),
                              Dom.link("cables in the graph", () => {
                                  Graph.lightVlan(id);
                                  Dom.go("graph/l2");
                              }),
                          ],
                      })),
                  })
                : Tables.empty("No device declares a VLAN.")
        );
    }

    /** @param {HTMLElement} container */
    static #addressesView(container) {
        const { spaces, elsewhere } = Tables.#data.addresses;
        container.append(
            Tables.heading("Addresses", "h2"),
            Tables.empty("Every address the config uses, by prefix, and what is still free, as circuit addresses prints it.")
        );

        /**
         * @param {typeof elsewhere.segments} segments
         * @param {typeof elsewhere.blocks} blocks
         */
        const segmentsAndBlocks = (segments, blocks) => {
            for (const segment of segments) {
                const next = segment.next ? `, next ${segment.next}` : "";
                container.append(
                    Tables.heading(`${segment.prefix}, ${segment.free} free${next}`, "h4"),
                    Tables.of({
                        head: [{ label: "Address" }, { label: "Used by" }],
                        rows: segment.uses.map((use) => ({ cells: [use.address, use.what] })),
                    })
                );
            }

            if (blocks.length) {
                container.append(
                    Tables.heading("Blocks", "h4"),
                    Tables.of({
                        head: [{ label: "Prefix" }, { label: "Used by" }],
                        rows: blocks.map((block) => ({ cells: [block.prefix, block.what] })),
                    })
                );
            }
        };

        for (const space of spaces) {
            container.append(Tables.heading(`${space.prefix}, ${space.owner}`));
            segmentsAndBlocks(space.segments, space.blocks);
            container.append(Dom.h("p", {}, Dom.h("strong", {}, "Free: "), space.free.join(", ") || "none"));
        }

        if (elsewhere.segments.length || elsewhere.blocks.length) {
            container.append(Tables.heading("Outside the space the network originates"));
            segmentsAndBlocks(elsewhere.segments, elsewhere.blocks);
        }

        if (!spaces.length && !elsewhere.segments.length && !elsewhere.blocks.length)
            container.append(Tables.empty("The config holds no addresses."));
    }

    /** @param {HTMLElement} container */
    static #sessionsView(container) {
        const ours = new Set(Tables.#data.devices.map((device) => device.name));

        container.append(
            Tables.heading("BGP sessions", "h2"),
            Tables.empty("Every BGP neighbor, with its group's settings filled in. A far end that is one of our devices links to it."),
            Tables.#data.sessions.length
                ? Tables.of({
                      csv: "bgp-sessions",
                      head: ["Device", "Neighbor", "Address", "Remote AS", "Role", "Import", "Export", "Far end", ""].map((label) => ({
                          label,
                      })),
                      rows: Tables.#data.sessions.map((session) => ({
                          cells: [
                              Tables.deviceLink(session.device),
                              Dom.h("strong", {}, session.name),
                              session.address,
                              session.remoteAs ? String(session.remoteAs) : "",
                              session.role ?? "",
                              session.import ?? "imports nothing",
                              session.export ?? "exports nothing",
                              session.far && ours.has(session.far) ? Tables.deviceLink(session.far) : (session.far ?? ""),
                              session.oneSided ? Dom.h("span", { class: "badge warning" }, "no session back") : "",
                          ],
                      })),
                  })
                : Tables.empty("No device runs BGP.")
        );
    }

    /** @param {HTMLElement} container */
    static #cablesView(container) {
        // A carrier column only when a cable runs through one.
        const carried = Tables.#data.cables.some((cable) => cable.through);

        container.append(
            Tables.heading("Cables", "h2"),
            Tables.empty("Every cable a port's link names, once, from the end that names it first."),
            Tables.#data.cables.length
                ? Tables.of({
                      csv: "cables",
                      head: [
                          "Device",
                          "Port",
                          "Far device",
                          "Far port",
                          ...(carried ? ["Through"] : []),
                          "LAG",
                          "VLANs",
                          "Description",
                          "",
                      ].map((label) => ({ label })),
                      rows: Tables.#data.cables.map((cable) => ({
                          cells: [
                              Tables.deviceLink(cable.device),
                              cable.port,
                              Tables.deviceLink(cable.farDevice),
                              cable.farPort,
                              ...(carried ? [cable.through ?? ""] : []),
                              [cable.lag, cable.farLag].filter(Boolean).join(" to "),
                              cable.vlans.join(", "),
                              cable.description ?? "",
                              cable.oneSided ? Dom.h("span", { class: "badge warning" }, "not linked back") : "",
                          ],
                      })),
                  })
                : Tables.empty("No port names a link.")
        );
    }

    /**
     * Everything that needs a look, in one place: what validate found, what only one end declares, and devices unlike their snapshot.
     *
     * @param {HTMLElement} container
     */
    static #problemsView(container) {
        const { graph } = Tables.#data;
        const nameOf = (/** @type {string} */ id) => graph.nodes.find((node) => node.id === id)?.label ?? id;

        const errors = graph.findings.filter((finding) => finding.level === "error");
        const warnings = graph.findings.filter((finding) => finding.level === "warning");
        const oneSided = graph.edges.filter((edge) => edge.oneSided);
        const drifted = Tables.#data.devices.filter((device) => graph.drift[device.name]?.status === "differs");
        const unplanned = Tables.#data.devices.filter((device) => graph.drift[device.name]?.status === "cannot plan");
        const unsnapped = Tables.#data.devices.filter((device) => graph.drift[device.name]?.status === "no snapshot");

        container.append(
            Tables.heading("Problems", "h2"),
            Tables.empty("Everything that needs a look. Studio finds these from the files and the last snapshots alone.")
        );

        if (!errors.length && !warnings.length && !oneSided.length && !drifted.length && !unplanned.length) {
            container.append(
                Tables.empty("Nothing: every check passes, both ends declare everything, and every device with a snapshot matches it.")
            );
        }

        /**
         * @param {string} title
         * @param {import("../../core/define").Finding[]} findings
         */
        const findingTable = (title, findings) => {
            if (!findings.length) return;

            container.append(
                Dom.h("h3", {}, title, " found by ", Dom.h("code", {}, "circuit validate")),
                Tables.of({
                    csv: title.toLowerCase(),
                    head: ["Device", "Message"].map((label) => ({ label })),
                    rows: findings.map((finding) => ({
                        cells: [finding.device ? Tables.deviceLink(finding.device) : "the network", finding.message],
                    })),
                })
            );
        };

        findingTable("Errors", errors);
        findingTable("Warnings", warnings);

        if (oneSided.length) {
            container.append(
                Tables.heading("Declared by one end only"),
                Tables.of({
                    csv: "one-sided",
                    head: ["Layer", "What", "From", "To", ""].map((label) => ({ label })),
                    rows: oneSided.map((edge) => ({
                        cells: [
                            Graph.LAYER_NAMES[edge.layer],
                            edge.label,
                            nameOf(edge.from),
                            nameOf(edge.to),
                            Dom.link("in the graph", () => Dom.go(`graph/${edge.layer}`)),
                        ],
                    })),
                })
            );
        }

        /**
         * @param {string} title
         * @param {Device[]} devices
         * @param {string} section
         * @param {string} action
         */
        const deviceList = (title, devices, section, action) => {
            if (!devices.length) return;

            container.append(
                Tables.heading(title),
                Dom.h(
                    "ul",
                    { class: "findings" },
                    ...devices.map((device) =>
                        Dom.h(
                            "li",
                            {},
                            Tables.deviceLink(device.name),
                            " · ",
                            Dom.link(action, () => Dom.go(`${Tables.#deviceRoute(device.name)}/${section}`))
                        )
                    )
                )
            );
        };

        deviceList("Unlike their last snapshot", drifted, "plan", "see the plan");
        deviceList("Could not be planned against their snapshot", unplanned, "plan", "see why");

        if (unsnapped.length) {
            container.append(
                Tables.heading("No snapshot yet"),
                Tables.prose(
                    unsnapped.map((device) => device.name).join(", "),
                    ". Run ",
                    Dom.h("code", {}, "circuit snapshot"),
                    " to compare them with what they run."
                )
            );
        }
    }

    /** How many problems there are, for the top bar. */
    static problemCount(/** @type {StudioData} */ next) {
        const drifted = Object.values(next.graph.drift).filter(
            (drift) => drift.status === "differs" || drift.status === "cannot plan"
        ).length;
        return next.graph.findings.length + next.graph.edges.filter((edge) => edge.oneSided).length + drifted;
    }

    /** Which section shows each part of a device, for search results. @type {Record<string, string>} */
    static #SECTION_OF = {
        ports: "ports",
        interfaces: "interfaces",
        vlans: "vlans",
        routing: "routing",
        policies: "policies",
        prefix_sets: "policies",
        firewall: "firewall",
        acls: "firewall",
        users: "management",
        management: "management",
        certificates: "management",
        dhcp: "services",
        dhcp_relay: "services",
        flow_export: "services",
    };

    /**
     * @param {string} query
     * @param {HTMLElement} container
     */
    static #searchView(query, container) {
        const needle = query.toLowerCase();
        /** @type {{ device: string, section: string, path: string, text: string }[]} */
        const results = [];

        /**
         * @param {string} device
         * @param {string[]} path
         * @param {string} text
         */
        const check = (device, path, text) => {
            if (!text.toLowerCase().includes(needle) || path.at(-1) === "certificate") return;
            results.push({ device, section: Tables.#SECTION_OF[path[0] ?? ""] ?? "overview", path: path.join(" › "), text });
        };

        /**
         * @param {string} device
         * @param {string[]} path
         * @param {unknown} value
         */
        const walk = (device, path, value) => {
            if (results.length >= 200) return;

            if (Tables.#isSecret(value)) return check(device, path, Tables.#secretText(/** @type {Record<string, unknown>} */ (value)));
            if (Array.isArray(value)) return value.forEach((item, index) => walk(device, [...path, String(index + 1)], item));
            if (Tables.#isObject(value)) {
                for (const [key, inner] of Object.entries(value)) {
                    // A name a device declares, such as a port or a VLAN, is a match too.
                    if (path.length && key.toLowerCase().includes(needle)) check(device, [...path, key], key);
                    walk(device, [...path, key], inner);
                }
                return;
            }

            if (value !== undefined && value !== null) check(device, path, String(value));
        };

        for (const device of Tables.#data.devices) walk(device.name, [], device);

        container.append(Tables.heading(`Search: ${query}`, "h2"));

        if (!results.length) {
            container.append(Tables.empty("Nothing in the config matches."));
            return;
        }

        container.append(
            Tables.empty(
                results.length >= 200 ? "The first 200 matches." : `${results.length} ${results.length === 1 ? "match" : "matches"}.`
            ),
            Tables.of({
                csv: "search",
                head: ["Device", "Where", "Value"].map((label) => ({ label })),
                rows: results.map((result) => ({
                    cells: [
                        Tables.deviceLink(result.device),
                        Dom.link(result.path, () => Dom.go(`${Tables.#deviceRoute(result.device)}/${result.section}`)),
                        result.text.length > 120 ? `${result.text.slice(0, 120)}…` : result.text,
                    ],
                })),
            })
        );
    }

    /**
     * Draw a place in Studio's tables, such as `["devices", "edge-01", "ports"]`, into a container.
     *
     * @param {string[]} route
     * @param {HTMLElement} container
     * @param {StudioData} next
     */
    static show(route, container, next) {
        Tables.#data = next;
        container.replaceChildren();

        const [view, first, second] = route;

        if (view === "devices" && first) Tables.#deviceView(first, second, container);
        else if (view === "devices") Tables.#devicesView(container);
        else if (view === "vlans") Tables.#vlansView(container);
        else if (view === "addresses") Tables.#addressesView(container);
        else if (view === "sessions") Tables.#sessionsView(container);
        else if (view === "cables") Tables.#cablesView(container);
        else if (view === "problems") Tables.#problemsView(container);
        else if (view === "search") Tables.#searchView(first ?? "", container);
    }
}
