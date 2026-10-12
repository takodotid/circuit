// @ts-check
/// <reference lib="dom" />
// Studio's tables, for reading the config without reading TypeScript: every device and everything it holds, and the network's VLANs, addresses, BGP sessions and cables.

import { go, h, link } from "./dom.js";
import { currentLayer, LAYER_NAMES, lightVlan, selectDevice } from "./graph.js";

/** @typedef {import("../../schema").Device} Device */
/** @typedef {import("../data").StudioData} StudioData */
/** @typedef {import("./dom.js").Child} Child */
/** A column named after a field shows the name as code. @typedef {{ head: { label: string, title?: string, field?: boolean }[], rows: { cells: Child[], muted?: boolean }[] }} Table */
/** @typedef {{ id: string, title: string, has: (device: Device) => boolean, render: (device: Device) => Child[] }} Section */

/** What the tables show, set each time they are drawn. @type {StudioData} */
let data;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} value */
const isSecret = (value) =>
    isObject(value) && Object.keys(value).length === 1 && (typeof value.secret === "string" || typeof value.secret_file === "string");

/** @param {Record<string, unknown>} value */
const secretText = (value) => (typeof value.secret === "string" ? `secret("${value.secret}")` : `secretFile("${value.secret_file}")`);

/**
 * What a field is, from the schema's comments: looked up in these types, and the types they take fields from.
 *
 * @param {readonly string[]} types
 * @param {string} field
 * @returns {string | undefined}
 */
function describe(types, field) {
    const seen = new Set();
    const queue = [...types];

    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
        if (seen.has(name)) continue;
        seen.add(name);

        const type = data.docs[name];
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
function compact(value) {
    if (value === undefined || value === null) return "";
    if (isSecret(value)) return secretText(/** @type {Record<string, unknown>} */ (value));
    if (Array.isArray(value)) return value.map(compact).join(value.every((item) => !isObject(item)) ? ", " : " / ");

    // A field written as `{}`, such as `ssh: {}`, is on with its defaults.
    if (isObject(value) && !Object.keys(value).length) return "on";
    if (isObject(value)) {
        return Object.entries(value)
            .map(([key, inner]) => (inner === true ? key : `${key} ${compact(inner)}`))
            .join(", ");
    }

    return String(value);
}

/**
 * @param {Table} table
 * @returns {Node}
 */
function table({ head, rows }) {
    /** @param {Table["rows"][number]} row */
    const attributesOf = (row) => ({ ...(row.muted ? { class: "muted" } : {}) });

    const element = h(
        "table",
        { class: "data" },
        h(
            "thead",
            {},
            h(
                "tr",
                {},
                ...head.map((column) =>
                    h("th", column.title ? { title: column.title } : {}, column.field ? h("code", {}, column.label) : column.label)
                )
            )
        ),
        h("tbody", {}, ...rows.map((row) => h("tr", attributesOf(row), ...row.cells.map((cell) => h("td", {}, cell)))))
    );

    return element;
}

/**
 * The fields any of the items hold, in the order first seen, with a chosen few first.
 *
 * @param {Record<string, unknown>[]} items
 * @param {readonly string[]} [first]
 */
function columnsOf(items, first = []) {
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
function recordTable(record, types, nameLabel = "Name", first = []) {
    const entries = Object.entries(record).filter(([, value]) => value !== undefined);
    if (!entries.length) return empty("None.");

    /** @type {Record<string, unknown>[]} */
    const items = entries.map(([, value]) => (isObject(value) && !isSecret(value) ? value : { value }));
    const columns = columnsOf(items, first);

    return table({
        head: [{ label: nameLabel }, ...columns.map((column) => ({ label: column, title: describe(types, column), field: true }))],
        rows: entries.map(([name], index) => ({
            cells: [h("strong", {}, name), ...columns.map((column) => compact(items[index]?.[column]))],
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
function listTable(list, types, first = []) {
    if (!list.length) return empty("None.");

    const items = list.map((value) => (isObject(value) ? value : { value }));
    const columns = columnsOf(items, first);

    return table({
        head: [{ label: "#" }, ...columns.map((column) => ({ label: column, title: describe(types, column), field: true }))],
        rows: items.map((item, index) => ({ cells: [String(index + 1), ...columns.map((column) => compact(item[column]))] })),
    });
}

/**
 * Settings as a table of field and value. A value that holds more is shown inside, the same way.
 *
 * @param {object} object
 * @param {readonly string[]} types
 * @returns {Node}
 */
function settings(object, types) {
    const entries = Object.entries(object).filter(([, value]) => value !== undefined);
    if (!entries.length) return empty("None.");

    /**
     * @param {unknown} value
     * @returns {Child}
     */
    const valueOf = (value) => {
        if (isObject(value) && !Object.keys(value).length) return compact(value);
        if (isObject(value) && !isSecret(value)) {
            const allObjects = Object.values(value).every((inner) => isObject(inner) && !isSecret(inner));
            return allObjects ? recordTable(value, types) : settings(value, types);
        }

        if (Array.isArray(value) && value.some(isObject)) return listTable(value, types);
        return compact(value);
    };

    return h(
        "table",
        { class: "data settings" },
        h(
            "tbody",
            {},
            ...entries.map(([key, value]) => {
                const title = describe(types, key);
                return h("tr", {}, h("th", title ? { title } : {}, h("code", {}, key)), h("td", {}, valueOf(value)));
            })
        )
    );
}

/**
 * @param {string} text
 * @param {"h2" | "h3" | "h4"} [level]
 */
const heading = (text, level = "h3") => h(level, {}, text);

/** @param {string} text */
const empty = (text) => h("p", { class: "muted" }, text);

/**
 * A muted paragraph of several parts, such as text with a command in it.
 *
 * @param {...import("./dom.js").Child} parts
 */
const prose = (...parts) => h("p", { class: "muted" }, ...parts);

/** @param {string} name */
const deviceLink = (name) => link(name, () => go(`devices/${encodeURIComponent(name)}`));

/** @param {string} name */
const deviceRoute = (name) => `devices/${encodeURIComponent(name)}`;

/**
 * @param {string} device
 * @returns {Child[]}
 */
function findingBadges(device) {
    const findings = data.graph.findings.filter((finding) => finding.device === device);
    const errors = findings.filter((finding) => finding.level === "error").length;
    const warnings = findings.length - errors;

    return [
        errors ? h("span", { class: "badge error" }, `${errors} ${errors === 1 ? "error" : "errors"}`) : undefined,
        warnings ? h("span", { class: "badge warning" }, `${warnings} ${warnings === 1 ? "warning" : "warnings"}`) : undefined,
    ];
}

/** @type {Record<string, string>} */
const SNAPSHOT_TEXT = {
    matches: "matches its snapshot",
    differs: "differs from its snapshot",
    "no snapshot": "no snapshot yet",
    "cannot plan": "cannot be planned",
};

/** The fields the Ports table has columns of its own for. */
const PORT_FIELDS = ["description", "access_vlan", "trunk_vlans", "native_vlan", "addresses", "lag", "link"];

/**
 * How a port is switched. A LAG member carries what its LAG carries.
 *
 * @param {Device} device
 * @param {Record<string, unknown>} port
 * @returns {string}
 */
function switching(device, port) {
    const lag = typeof port.lag === "string" ? device.interfaces?.[port.lag] : undefined;
    if (lag) {
        const carried = switching(device, { ...lag, lag: undefined });
        return carried ? `${carried}, on LAG ${port.lag}` : "";
    }

    if (port.access_vlan) return `access ${port.access_vlan}`;
    if (Array.isArray(port.trunk_vlans))
        return `trunk ${port.trunk_vlans.join(", ")}${port.native_vlan ? `, native ${port.native_vlan}` : ""}`;
    return "";
}

// A device's sections. Each lists the schema types its fields come from, for their descriptions.
/** @type {Section[]} */
const SECTIONS = [
    {
        id: "overview",
        title: "Overview",
        has: () => true,
        render(device) {
            const findings = data.graph.findings.filter((finding) => finding.device === device.name);
            const drift = data.graph.drift[device.name];

            const { platform, model, connection, system, hardware_offload, lldp, stp, vrfs } = device;
            const shown = { platform, model, connection, hardware_offload, lldp, stp, vrfs, system };
            const differs = drift?.status === "differs";

            return [
                findings.length ? h("h3", {}, "Found by ", h("code", {}, "circuit validate")) : undefined,
                findings.length
                    ? h(
                          "ul",
                          { class: "findings" },
                          ...findings.map((finding) =>
                              h("li", {}, h("span", { class: `badge ${finding.level}` }, finding.level), finding.message)
                          )
                      )
                    : undefined,
                heading("Against its snapshot"),
                h(
                    "p",
                    {},
                    drift ? (SNAPSHOT_TEXT[drift.status] ?? "") : "not compared",
                    differs ? " · " : "",
                    differs ? link("see the plan", () => go(`${deviceRoute(device.name)}/plan`)) : undefined
                ),
                heading("Device"),
                settings(shown, ["Device", "Connection", "System", "Vrf"]),
            ];
        },
    },
    {
        id: "ports",
        title: "Ports",
        has: () => true,
        render(device) {
            const declared = /** @type {Record<string, Record<string, unknown> | undefined>} */ (device.ports ?? {});
            const all = [...new Set([...(data.ports[device.name] ?? []), ...Object.keys(declared)])];
            const types = ["Port", "Routed", "Switched", "Link", "PortStp", "Vrrp", "Exchange"];

            const rows = all.map((name) => {
                const port = declared[name];
                if (!port) return { cells: [name, "not declared, so shut down", "", "", "", "", ""], muted: true };

                const far = /** @type {{ device: string, port: string } | undefined} */ (port.link);
                const other = Object.fromEntries(Object.entries(port).filter(([key]) => !PORT_FIELDS.includes(key)));

                return {
                    cells: [
                        h("strong", {}, name),
                        compact(port.description),
                        switching(device, port),
                        compact(port.addresses),
                        compact(port.lag),
                        far ? h("span", {}, deviceLink(far.device), ` ${far.port}`) : "",
                        Object.keys(other).length ? compact(other) : "",
                    ],
                };
            });

            /**
             * @param {string} label
             * @param {string} [field]
             */
            const column = (label, field) => ({ label, title: field ? describe(types, field) : undefined });
            const used = Object.keys(declared).length;

            return [
                h("p", { class: "muted" }, `${used} of ${all.length} ports declared. A port the config does not declare is shut down.`),
                table({
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
            recordTable(
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
        render: (device) => [recordTable(device.vlans ?? {}, ["Vlan"], "VLAN", ["id", "description"])],
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

            if (routing.router_id) parts.push(settings({ router_id: routing.router_id }, types));
            if (routing.static?.length)
                parts.push(heading("Static routes"), listTable(routing.static, types, ["prefix", "via", "interface"]));

            if (routing.bgp) {
                const { asn, networks, groups, neighbors } = routing.bgp;
                parts.push(heading("BGP"), settings({ asn, networks }, types));
                if (groups) parts.push(heading("BGP groups"), recordTable(groups, types, "Group"));
                if (neighbors)
                    parts.push(
                        heading("BGP neighbors"),
                        recordTable(neighbors, types, "Neighbor", ["address", "group", "remote_as", "role"])
                    );
            }

            if (routing.ospf) {
                const { families, redistribute } = routing.ospf;
                parts.push(heading("OSPF"));
                if (families || redistribute) parts.push(settings({ families, redistribute }, types));
                for (const [area, { interfaces }] of Object.entries(routing.ospf.areas)) {
                    parts.push(heading(`Area ${area}`, "h4"), recordTable(interfaces, types, "Interface"));
                }
            }

            if (routing.rpki?.length) parts.push(heading("RPKI"), listTable(routing.rpki, types));
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
                parts.push(heading(`Policy ${name}`), listTable(rules, types, ["description", "match", "set", "action"]));
            }

            if (device.prefix_sets) parts.push(heading("Prefix sets"), recordTable(device.prefix_sets, types, "Prefix set"));
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
                    heading("Address sets"),
                    table({
                        head: [{ label: "Set" }, { label: "Members" }],
                        rows: Object.entries(firewall.address_sets).map(([name, members]) => ({
                            cells: [h("strong", {}, name), compact(members)],
                        })),
                    })
                );
            }

            // A filter chain has a default and rules; a NAT chain is its rules.
            for (const [chain, settingsOfChain] of Object.entries(firewall?.filter ?? {})) {
                if (!settingsOfChain) continue;
                const fallback = settingsOfChain.default ? `, default ${settingsOfChain.default}` : "";
                parts.push(
                    heading(`Filter ${chain}${fallback}`),
                    listTable(settingsOfChain.rules ?? [], types, ["description", "match", "action"])
                );
            }

            for (const [chain, rules] of Object.entries(firewall?.nat ?? {})) {
                if (rules) parts.push(heading(`NAT ${chain}`), listTable(rules, types, ["description", "match", "action"]));
            }

            const { helpers, untracked } = firewall ?? {};
            if (helpers || untracked) parts.push(heading("Other"), settings({ helpers, untracked }, types));

            for (const [name, rules] of Object.entries(device.acls ?? {})) {
                parts.push(heading(`ACL ${name}`), listTable(rules, types, ["description", "match", "action"]));
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
                heading("Users"),
                recordTable(device.users ?? {}, types, "User", ["role", "description"]),
                heading("Ways in"),
                settings(device.management ?? {}, types),
                hasCertificates ? heading("Certificates") : undefined,
                hasCertificates ? recordTable(certificates, types, "Certificate") : undefined,
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
                device.dhcp ? heading("DHCP servers") : undefined,
                device.dhcp ? recordTable(device.dhcp, types, "Server", ["interface", "network", "gateway", "pool"]) : undefined,
                device.dhcp_relay ? heading("DHCP relays") : undefined,
                device.dhcp_relay ? recordTable(device.dhcp_relay, types, "Relay") : undefined,
                device.flow_export ? heading("Flow export") : undefined,
                device.flow_export ? settings(device.flow_export, types) : undefined,
            ];
        },
    },
    {
        id: "config",
        title: "Config",
        has: () => true,
        render: (device) => [
            prose(
                "What the device should run, in its vendor's commands, as ",
                h("code", {}, "circuit build"),
                " prints it. Secrets are markers, never values."
            ),
            h("pre", { class: "code" }, data.rendered[device.name] ?? ""),
        ],
    },
    {
        id: "plan",
        title: "Plan",
        has: () => true,
        render(device) {
            const drift = data.graph.drift[device.name];
            if (!drift || drift.status === "no snapshot")
                return [prose("No snapshot yet, so nothing to compare with: run ", h("code", {}, "circuit snapshot"), ".")];
            if (drift.status === "matches")
                return [prose("The device matches its last snapshot: ", h("code", {}, "circuit diff"), " would send nothing.")];

            return [
                drift.status === "differs"
                    ? prose("What ", h("code", {}, "circuit diff"), " would send, against the last snapshot:")
                    : empty("It could not be planned:"),
                h("pre", { class: "code" }, drift.lines.join("\n")),
            ];
        },
    },
];

/** @param {HTMLElement} container */
function devicesView(container) {
    container.append(
        heading("Devices", "h2"),
        table({
            head: ["Name", "Platform", "Model", "Reached at", "Ports declared", "Snapshot", "Found"].map((label) => ({ label })),
            rows: data.devices.map((device) => {
                const badges = findingBadges(device.name);

                return {
                    cells: [
                        h("strong", {}, deviceLink(device.name)),
                        device.platform,
                        device.model,
                        device.connection.host,
                        `${Object.keys(device.ports ?? {}).length} of ${data.ports[device.name]?.length ?? "?"}`,
                        SNAPSHOT_TEXT[data.graph.drift[device.name]?.status ?? ""] ?? "",
                        badges.some(Boolean) ? h("span", {}, ...badges) : h("span", { class: "muted" }, "nothing"),
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
function deviceView(name, sectionId, container) {
    const device = data.devices.find((candidate) => candidate.name === name);
    if (!device) {
        container.append(
            heading("No such device", "h2"),
            empty(`The config has no device ${name}.`),
            link("All devices", () => go("devices"))
        );
        return;
    }

    const sections = SECTIONS.filter((section) => section.has(device));
    const section = sections.find((candidate) => candidate.id === sectionId) ?? SECTIONS[0];
    if (!section) return;

    const tabs = h("nav", { class: "tabs", "aria-label": "Sections" });
    for (const candidate of sections) {
        const button = h("button", { "aria-pressed": String(candidate === section) }, candidate.title);
        button.addEventListener("click", () => go(`${deviceRoute(device.name)}/${candidate.id}`));
        tabs.append(button);
    }

    container.append(
        h(
            "p",
            { class: "crumbs" },
            link("Devices", () => go("devices")),
            " / "
        ),
        h("h2", {}, device.name, " ", ...findingBadges(device.name)),
        h(
            "p",
            { class: "muted" },
            `${device.platform} ${device.model}, reached at ${device.connection.host} · `,
            link("show in the graph", () => {
                selectDevice(device.name);
                go(`graph/${currentLayer()}`);
            })
        ),
        tabs,
        h("div", { class: "section" }, ...section.render(device))
    );
}

/** @param {HTMLElement} container */
function vlansView(container) {
    /** @type {Map<number, { names: Set<string>, declared: string[], gateways: string[], ports: string[] }>} */
    const byId = new Map();

    for (const device of data.devices) {
        for (const [name, vlan] of Object.entries(device.vlans ?? {})) {
            const row = byId.get(vlan.id) ?? { names: new Set(), declared: [], gateways: [], ports: [] };
            row.names.add(name);
            row.declared.push(device.name);

            for (const [iface, settingsOfInterface] of Object.entries(device.interfaces ?? {})) {
                if (settingsOfInterface.type === "vlan" && settingsOfInterface.vlan === name) {
                    row.gateways.push(`${device.name} ${iface} ${compact(settingsOfInterface.addresses)}`.trim());
                }
            }

            const carriers = /** @type {(Record<string, unknown> | undefined)[]} */ (
                Object.values({ ...device.ports, ...device.interfaces })
            );
            const access = carriers.filter((carrier) => carrier?.access_vlan === name).length;
            const trunk = carriers.filter((carrier) => Array.isArray(carrier?.trunk_vlans) && carrier.trunk_vlans.includes(name)).length;
            const counts = [access ? `${access} access` : "", trunk ? `${trunk} trunk` : ""].filter(Boolean).join(", ");
            if (counts) row.ports.push(`${device.name}: ${counts}`);

            byId.set(vlan.id, row);
        }
    }

    const rows = [...byId].sort(([a], [b]) => a - b);

    container.append(
        heading("VLANs", "h2"),
        empty("Every VLAN any device declares. One id under two names is worth a look."),
        rows.length
            ? table({
                  head: ["VLAN", "Name", "Declared on", "Gateway", "Ports", ""].map((label) => ({ label })),
                  rows: rows.map(([id, row]) => ({
                      cells: [
                          h("strong", {}, String(id)),
                          [...row.names].join(", "),
                          h("span", {}, ...row.declared.flatMap((name, index) => [index ? ", " : "", deviceLink(name)])),
                          row.gateways.join("; "),
                          row.ports.join("; "),
                          link("cables in the graph", () => {
                              lightVlan(id);
                              go("graph/l2");
                          }),
                      ],
                  })),
              })
            : empty("No device declares a VLAN.")
    );
}

/** @param {HTMLElement} container */
function addressesView(container) {
    const { spaces, elsewhere } = data.addresses;
    container.append(
        heading("Addresses", "h2"),
        empty("Every address the config uses, by prefix, and what is still free, as circuit addresses prints it.")
    );

    /**
     * @param {typeof elsewhere.segments} segments
     * @param {typeof elsewhere.blocks} blocks
     */
    const segmentsAndBlocks = (segments, blocks) => {
        for (const segment of segments) {
            const next = segment.next ? `, next ${segment.next}` : "";
            container.append(
                heading(`${segment.prefix}, ${segment.free} free${next}`, "h4"),
                table({
                    head: [{ label: "Address" }, { label: "Used by" }],
                    rows: segment.uses.map((use) => ({ cells: [use.address, use.what] })),
                })
            );
        }

        if (blocks.length) {
            container.append(
                heading("Blocks", "h4"),
                table({
                    head: [{ label: "Prefix" }, { label: "Used by" }],
                    rows: blocks.map((block) => ({ cells: [block.prefix, block.what] })),
                })
            );
        }
    };

    for (const space of spaces) {
        container.append(heading(`${space.prefix}, ${space.owner}`));
        segmentsAndBlocks(space.segments, space.blocks);
        container.append(h("p", {}, h("strong", {}, "Free: "), space.free.join(", ") || "none"));
    }

    if (elsewhere.segments.length || elsewhere.blocks.length) {
        container.append(heading("Outside the space the network originates"));
        segmentsAndBlocks(elsewhere.segments, elsewhere.blocks);
    }

    if (!spaces.length && !elsewhere.segments.length && !elsewhere.blocks.length) container.append(empty("The config holds no addresses."));
}

/** @param {HTMLElement} container */
function sessionsView(container) {
    const ours = new Set(data.devices.map((device) => device.name));

    container.append(
        heading("BGP sessions", "h2"),
        empty("Every BGP neighbor, with its group's settings filled in. A far end that is one of our devices links to it."),
        data.sessions.length
            ? table({
                  head: ["Device", "Neighbor", "Address", "Remote AS", "Role", "Import", "Export", "Far end", ""].map((label) => ({
                      label,
                  })),
                  rows: data.sessions.map((session) => ({
                      cells: [
                          deviceLink(session.device),
                          h("strong", {}, session.name),
                          session.address,
                          session.remoteAs ? String(session.remoteAs) : "",
                          session.role ?? "",
                          session.import ?? "imports nothing",
                          session.export ?? "exports nothing",
                          session.far && ours.has(session.far) ? deviceLink(session.far) : (session.far ?? ""),
                          session.oneSided ? h("span", { class: "badge warning" }, "no session back") : "",
                      ],
                  })),
              })
            : empty("No device runs BGP.")
    );
}

/** @param {HTMLElement} container */
function cablesView(container) {
    container.append(
        heading("Cables", "h2"),
        empty("Every cable a port's link names, once, from the end that names it first."),
        data.cables.length
            ? table({
                  head: ["Device", "Port", "Far device", "Far port", "LAG", "VLANs", "Description", ""].map((label) => ({ label })),
                  rows: data.cables.map((cable) => ({
                      cells: [
                          deviceLink(cable.device),
                          cable.port,
                          deviceLink(cable.farDevice),
                          cable.farPort,
                          [cable.lag, cable.farLag].filter(Boolean).join(" to "),
                          cable.vlans.join(", "),
                          cable.description ?? "",
                          cable.oneSided ? h("span", { class: "badge warning" }, "not linked back") : "",
                      ],
                  })),
              })
            : empty("No port names a link.")
    );
}

/**
 * Everything that needs a look, in one place: what validate found, what only one end declares, and devices unlike their snapshot.
 *
 * @param {HTMLElement} container
 */
function problemsView(container) {
    const { graph } = data;
    const nameOf = (/** @type {string} */ id) => graph.nodes.find((node) => node.id === id)?.label ?? id;

    const errors = graph.findings.filter((finding) => finding.level === "error");
    const warnings = graph.findings.filter((finding) => finding.level === "warning");
    const oneSided = graph.edges.filter((edge) => edge.oneSided);
    const drifted = data.devices.filter((device) => graph.drift[device.name]?.status === "differs");
    const unplanned = data.devices.filter((device) => graph.drift[device.name]?.status === "cannot plan");
    const unsnapped = data.devices.filter((device) => graph.drift[device.name]?.status === "no snapshot");

    container.append(
        heading("Problems", "h2"),
        empty("Everything that needs a look. Studio finds these from the files and the last snapshots alone.")
    );

    if (!errors.length && !warnings.length && !oneSided.length && !drifted.length && !unplanned.length) {
        container.append(empty("Nothing: every check passes, both ends declare everything, and every device with a snapshot matches it."));
    }

    /**
     * @param {string} title
     * @param {import("../../core/define").Finding[]} findings
     */
    const findingTable = (title, findings) => {
        if (!findings.length) return;

        container.append(
            h("h3", {}, title, " found by ", h("code", {}, "circuit validate")),
            table({
                head: ["Device", "Message"].map((label) => ({ label })),
                rows: findings.map((finding) => ({
                    cells: [finding.device ? deviceLink(finding.device) : "the network", finding.message],
                })),
            })
        );
    };

    findingTable("Errors", errors);
    findingTable("Warnings", warnings);

    if (oneSided.length) {
        container.append(
            heading("Declared by one end only"),
            table({
                head: ["Layer", "What", "From", "To", ""].map((label) => ({ label })),
                rows: oneSided.map((edge) => ({
                    cells: [
                        LAYER_NAMES[edge.layer],
                        edge.label,
                        nameOf(edge.from),
                        nameOf(edge.to),
                        link("in the graph", () => go(`graph/${edge.layer}`)),
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
            heading(title),
            h(
                "ul",
                { class: "findings" },
                ...devices.map((device) =>
                    h(
                        "li",
                        {},
                        deviceLink(device.name),
                        " · ",
                        link(action, () => go(`${deviceRoute(device.name)}/${section}`))
                    )
                )
            )
        );
    };

    deviceList("Unlike their last snapshot", drifted, "plan", "see the plan");
    deviceList("Could not be planned against their snapshot", unplanned, "plan", "see why");

    if (unsnapped.length) {
        container.append(
            heading("No snapshot yet"),
            prose(
                unsnapped.map((device) => device.name).join(", "),
                ". Run ",
                h("code", {}, "circuit snapshot"),
                " to compare them with what they run."
            )
        );
    }
}

/** How many problems there are, for the top bar. */
export function problemCount(/** @type {StudioData} */ next) {
    const drifted = Object.values(next.graph.drift).filter((drift) => drift.status === "differs" || drift.status === "cannot plan").length;
    return next.graph.findings.length + next.graph.edges.filter((edge) => edge.oneSided).length + drifted;
}

/** Which section shows each part of a device, for search results. @type {Record<string, string>} */
const SECTION_OF = {
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
function searchView(query, container) {
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
        results.push({ device, section: SECTION_OF[path[0] ?? ""] ?? "overview", path: path.join(" › "), text });
    };

    /**
     * @param {string} device
     * @param {string[]} path
     * @param {unknown} value
     */
    const walk = (device, path, value) => {
        if (results.length >= 200) return;

        if (isSecret(value)) return check(device, path, secretText(/** @type {Record<string, unknown>} */ (value)));
        if (Array.isArray(value)) return value.forEach((item, index) => walk(device, [...path, String(index + 1)], item));
        if (isObject(value)) {
            for (const [key, inner] of Object.entries(value)) {
                // A name a device declares, such as a port or a VLAN, is a match too.
                if (path.length && key.toLowerCase().includes(needle)) check(device, [...path, key], key);
                walk(device, [...path, key], inner);
            }
            return;
        }

        if (value !== undefined && value !== null) check(device, path, String(value));
    };

    for (const device of data.devices) walk(device.name, [], device);

    container.append(heading(`Search: ${query}`, "h2"));

    if (!results.length) {
        container.append(empty("Nothing in the config matches."));
        return;
    }

    container.append(
        empty(results.length >= 200 ? "The first 200 matches." : `${results.length} ${results.length === 1 ? "match" : "matches"}.`),
        table({
            head: ["Device", "Where", "Value"].map((label) => ({ label })),
            rows: results.map((result) => ({
                cells: [
                    deviceLink(result.device),
                    link(result.path, () => go(`${deviceRoute(result.device)}/${result.section}`)),
                    result.text.length > 120 ? `${result.text.slice(0, 120)}…` : result.text,
                ],
            })),
        })
    );
}

/**
 * Draw a place in studio's tables, such as `["devices", "edge-01", "ports"]`, into a container.
 *
 * @param {string[]} route
 * @param {HTMLElement} container
 * @param {StudioData} next
 */
export function showTables(route, container, next) {
    data = next;
    container.replaceChildren();

    const [view, first, second] = route;

    if (view === "devices" && first) deviceView(first, second, container);
    else if (view === "devices") devicesView(container);
    else if (view === "vlans") vlansView(container);
    else if (view === "addresses") addressesView(container);
    else if (view === "sessions") sessionsView(container);
    else if (view === "cables") cablesView(container);
    else if (view === "problems") problemsView(container);
    else if (view === "search") searchView(first ?? "", container);
}
