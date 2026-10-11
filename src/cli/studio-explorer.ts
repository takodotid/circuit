/// <reference lib="dom" />
// Studio's tables, for reading the config without reading TypeScript: every device and everything it holds, and the network's VLANs, addresses, BGP sessions and cables. `explorer` runs in the browser like `page`, which hands it what it needs, so it uses nothing from outside its own body but types.

import type { Device } from "../schema";
import type { StudioData } from "./studio-data";

type Child = Node | string | undefined | false;

/** What the page hands the explorer. */
export type ExplorerUi = {
    h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes?: Record<string, string>, ...children: Child[]): HTMLElementTagNameMap[K];
    link(text: string, action: () => void): HTMLAnchorElement;
    data(): StudioData | undefined;
    /** Go to a place in studio, such as `devices/edge-01/ports`. */
    go(route: string): void;
    /** The graph, with this device selected. */
    showDevice(name: string): void;
    /** The graph's VLAN layer, with every cable carrying this VLAN lit. */
    showVlan(id: number): void;
};

/** Runs in the browser. Returns what draws a place in studio, such as `["devices", "edge-01", "ports"]`, into a container. */
export function explorer(ui: ExplorerUi): (route: string[], container: HTMLElement) => void {
    const { h, link } = ui;

    type Value = unknown;
    type Table = { head: { label: string; title?: string }[]; rows: { cells: Child[]; muted?: boolean }[] };

    const isObject = (value: Value): value is Record<string, Value> => typeof value === "object" && value !== null && !Array.isArray(value);
    const isSecret = (value: Value) =>
        isObject(value) && Object.keys(value).length === 1 && (typeof value.secret === "string" || typeof value.secret_file === "string");
    const secretText = (value: Record<string, Value>) =>
        typeof value.secret === "string" ? `secret("${value.secret}")` : `secretFile("${value.secret_file}")`;

    /** What a field is, from the schema's comments: looked up in these types, and the types they take fields from. */
    function describe(types: readonly string[], field: string): string | undefined {
        const docs = ui.data()?.docs ?? {};
        const seen = new Set<string>();
        const queue = [...types];

        while (queue.length) {
            const name = queue.shift()!;
            if (seen.has(name)) continue;
            seen.add(name);

            const type = docs[name];
            if (!type) continue;

            const found = type.fields[field] ?? Object.entries(type.fields).find(([path]) => path.endsWith(`.${field}`))?.[1];
            if (found?.description) return found.description;

            queue.push(...type.includes);
        }

        return undefined;
    }

    /** A value in one line of text. */
    function compact(value: Value): string {
        if (value === undefined || value === null) return "";
        if (isSecret(value)) return secretText(value as Record<string, Value>);
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

    function table({ head, rows }: Table): HTMLTableElement {
        return h(
            "table",
            { class: "data" },
            h("thead", {}, h("tr", {}, ...head.map((column) => h("th", column.title ? { title: column.title } : {}, column.label)))),
            h(
                "tbody",
                {},
                ...rows.map((row) => h("tr", row.muted ? { class: "muted" } : {}, ...row.cells.map((cell) => h("td", {}, cell))))
            )
        );
    }

    /** The fields any of the items hold, in the order first seen, with a chosen few first. */
    function columnsOf(items: Record<string, Value>[], first: readonly string[] = []): string[] {
        const seen = new Set<string>(first.filter((key) => items.some((item) => key in item)));
        for (const item of items) for (const key of Object.keys(item)) seen.add(key);
        return [...seen];
    }

    /** Named items, such as ports or neighbors, as a table: a row per name, a column per field. */
    function recordTable(record: Record<string, Value>, types: readonly string[], nameLabel = "Name", first: readonly string[] = []): Node {
        const entries = Object.entries(record).filter(([, value]) => value !== undefined);
        if (!entries.length) return h("p", { class: "muted" }, "None.");

        const items = entries.map(([, value]) => (isObject(value) && !isSecret(value) ? value : { value }));
        const columns = columnsOf(items, first);

        return table({
            head: [{ label: nameLabel }, ...columns.map((column) => ({ label: column, title: describe(types, column) }))],
            rows: entries.map(([name], index) => ({
                cells: [h("strong", {}, name), ...columns.map((column) => compact(items[index]![column]))],
            })),
        });
    }

    /** A list of items, such as rules or routes, as a table, in order. */
    function listTable(list: readonly Value[], types: readonly string[], first: readonly string[] = []): Node {
        if (!list.length) return h("p", { class: "muted" }, "None.");

        const items = list.map((value) => (isObject(value) ? value : { value }));
        const columns = columnsOf(items, first);

        return table({
            head: [{ label: "#" }, ...columns.map((column) => ({ label: column, title: describe(types, column) }))],
            rows: items.map((item, index) => ({ cells: [String(index + 1), ...columns.map((column) => compact(item[column]))] })),
        });
    }

    /** Settings as a table of field and value. A value that holds more is shown inside, the same way. */
    function settings(object: Record<string, Value>, types: readonly string[]): Node {
        const entries = Object.entries(object).filter(([, value]) => value !== undefined);
        if (!entries.length) return h("p", { class: "muted" }, "None.");

        const valueOf = (value: Value): Child => {
            if (isObject(value) && !Object.keys(value).length) return compact(value);
            if (isObject(value) && !isSecret(value)) {
                const allObjects = Object.values(value).every((inner) => isObject(inner) && !isSecret(inner));
                return allObjects && Object.keys(value).length ? recordTable(value, types) : settings(value, types);
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
                    return h("tr", {}, h("th", title ? { title } : {}, key), h("td", {}, valueOf(value)));
                })
            )
        );
    }

    const heading = (text: string, level: "h2" | "h3" | "h4" = "h3") => h(level, {}, text);
    const empty = (text: string) => h("p", { class: "muted" }, text);

    const deviceLink = (name: string) => link(name, () => ui.go(`devices/${encodeURIComponent(name)}`));

    function findingBadges(device: string): Child[] {
        const findings = ui.data()?.graph.findings.filter((finding) => finding.device === device) ?? [];
        const errors = findings.filter((finding) => finding.level === "error").length;
        const warnings = findings.length - errors;

        return [
            errors ? h("span", { class: "badge error" }, `${errors} ${errors === 1 ? "error" : "errors"}`) : undefined,
            warnings ? h("span", { class: "badge warning" }, `${warnings} ${warnings === 1 ? "warning" : "warnings"}`) : undefined,
        ];
    }

    const SNAPSHOT_TEXT: Record<string, string> = {
        matches: "matches its snapshot",
        differs: "differs from its snapshot",
        "no snapshot": "no snapshot yet",
        "cannot plan": "cannot be planned",
    };

    // A device's sections. Each lists the schema types its fields come from, for their descriptions.
    type Section = { id: string; title: string; has(device: Device): boolean; render(device: Device): Child[] };

    const PORT_FIELDS = ["description", "access_vlan", "trunk_vlans", "native_vlan", "addresses", "lag", "link"];

    const SECTIONS: Section[] = [
        {
            id: "overview",
            title: "Overview",
            has: () => true,
            render(device) {
                const data = ui.data()!;
                const findings = data.graph.findings.filter((finding) => finding.device === device.name);
                const drift = data.graph.drift[device.name];

                const { platform, model, connection, system, hardware_offload, lldp, stp, vrfs } = device;
                const shown = { platform, model, connection, hardware_offload, lldp, stp, vrfs, system };

                return [
                    findings.length ? heading("Found by validate") : undefined,
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
                        drift ? SNAPSHOT_TEXT[drift.status] : "not compared",
                        drift?.status === "differs" ? " · " : "",
                        drift?.status === "differs"
                            ? link("see the plan", () => ui.go(`devices/${encodeURIComponent(device.name)}/plan`))
                            : undefined
                    ),
                    heading("Device"),
                    settings(shown as Record<string, Value>, ["Device", "Connection", "System", "Vrf"]),
                ];
            },
        },
        {
            id: "ports",
            title: "Ports",
            has: () => true,
            render(device) {
                const declared = (device.ports ?? {}) as Record<string, Record<string, Value> | undefined>;
                const all = [...new Set([...(ui.data()!.ports[device.name] ?? []), ...Object.keys(declared)])];
                const types = ["Port", "Routed", "Switched", "Link", "PortStp", "Vrrp", "Exchange"];

                // A LAG member carries what its LAG carries.
                const switching = (port: Record<string, Value>): string => {
                    const lag =
                        typeof port.lag === "string" ? (device.interfaces?.[port.lag] as Record<string, Value> | undefined) : undefined;
                    if (lag) {
                        const carried = switching({ ...lag, lag: undefined });
                        return carried ? `${carried}, on LAG ${port.lag}` : "";
                    }

                    if (port.access_vlan) return `access ${port.access_vlan}`;
                    if (Array.isArray(port.trunk_vlans))
                        return `trunk ${port.trunk_vlans.join(", ")}${port.native_vlan ? `, native ${port.native_vlan}` : ""}`;
                    return "";
                };

                const rows = all.map((name) => {
                    const port = declared[name];
                    if (!port) return { cells: [name, "not declared, so shut down", "", "", "", "", ""], muted: true };

                    const link = port.link as { device: string; port: string } | undefined;
                    const other = Object.fromEntries(Object.entries(port).filter(([key]) => !PORT_FIELDS.includes(key)));

                    return {
                        cells: [
                            h("strong", {}, name),
                            compact(port.description),
                            switching(port),
                            compact(port.addresses),
                            compact(port.lag),
                            link ? h("span", {}, deviceLink(link.device), ` ${link.port}`) : "",
                            Object.keys(other).length ? compact(other) : "",
                        ],
                    };
                });

                const column = (label: string, field?: string) => ({ label, title: field ? describe(types, field) : undefined });
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
                    device.interfaces as Record<string, Value>,
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
            render: (device) => [recordTable(device.vlans as Record<string, Value>, ["Vlan"], "VLAN", ["id", "description"])],
        },
        {
            id: "routing",
            title: "Routing",
            has: (device) => device.routing !== undefined,
            render(device) {
                const routing = device.routing!;
                const types = ["Routing", "StaticRoute", "Bgp", "Neighbor", "NeighborSettings", "Ospf", "OspfInterface", "RpkiServer"];
                const parts: Child[] = [];

                if (routing.router_id) parts.push(settings({ router_id: routing.router_id }, types));
                if (routing.static?.length)
                    parts.push(heading("Static routes"), listTable(routing.static, types, ["prefix", "via", "interface"]));

                if (routing.bgp) {
                    const { asn, networks } = routing.bgp;
                    parts.push(heading("BGP"), settings({ asn, networks }, types));
                    if (routing.bgp.groups)
                        parts.push(heading("BGP groups"), recordTable(routing.bgp.groups as Record<string, Value>, types, "Group"));
                    if (routing.bgp.neighbors) {
                        parts.push(
                            heading("BGP neighbors"),
                            recordTable(routing.bgp.neighbors as Record<string, Value>, types, "Neighbor", [
                                "address",
                                "group",
                                "remote_as",
                                "role",
                            ])
                        );
                    }
                }

                if (routing.ospf) {
                    const { families, redistribute } = routing.ospf;
                    parts.push(heading("OSPF"));
                    if (families || redistribute) parts.push(settings({ families, redistribute }, types));
                    for (const [area, { interfaces }] of Object.entries(routing.ospf.areas)) {
                        parts.push(heading(`Area ${area}`, "h4"), recordTable(interfaces as Record<string, Value>, types, "Interface"));
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
                const parts: Child[] = [];

                for (const [name, rules] of Object.entries(device.policies ?? {})) {
                    parts.push(heading(`Policy ${name}`), listTable(rules, types, ["description", "match", "set", "action"]));
                }

                if (device.prefix_sets)
                    parts.push(heading("Prefix sets"), recordTable(device.prefix_sets as Record<string, Value>, types, "Prefix set"));
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
                const parts: Child[] = [];

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

                return [
                    heading("Users"),
                    recordTable((device.users ?? {}) as Record<string, Value>, types, "User", ["role", "description"]),
                    heading("Ways in"),
                    settings((device.management ?? {}) as Record<string, Value>, types),
                    Object.keys(certificates).length ? heading("Certificates") : undefined,
                    Object.keys(certificates).length ? recordTable(certificates, types, "Certificate") : undefined,
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
                    device.dhcp
                        ? recordTable(device.dhcp as Record<string, Value>, types, "Server", ["interface", "network", "gateway", "pool"])
                        : undefined,
                    device.dhcp_relay ? heading("DHCP relays") : undefined,
                    device.dhcp_relay ? recordTable(device.dhcp_relay as Record<string, Value>, types, "Relay") : undefined,
                    device.flow_export ? heading("Flow export") : undefined,
                    device.flow_export ? settings(device.flow_export as Record<string, Value>, types) : undefined,
                ];
            },
        },
        {
            id: "config",
            title: "Config",
            has: () => true,
            render: (device) => [
                h(
                    "p",
                    { class: "muted" },
                    "What the device should run, in its vendor's commands, as circuit build prints it. Secrets are markers, never values."
                ),
                h("pre", { class: "code" }, ui.data()!.rendered[device.name] ?? ""),
            ],
        },
        {
            id: "plan",
            title: "Plan",
            has: () => true,
            render(device) {
                const drift = ui.data()!.graph.drift[device.name];
                if (!drift || drift.status === "no snapshot")
                    return [empty("No snapshot yet, so nothing to compare with: run circuit snapshot.")];
                if (drift.status === "matches") return [empty("The device matches its last snapshot: circuit diff would send nothing.")];

                return [
                    h(
                        "p",
                        { class: "muted" },
                        drift.status === "differs" ? "What circuit diff would send, against the last snapshot:" : "It could not be planned:"
                    ),
                    h("pre", { class: "code" }, drift.lines.join("\n")),
                ];
            },
        },
    ];

    function devicesView(container: HTMLElement): void {
        const data = ui.data()!;

        container.append(
            heading("Devices", "h2"),
            table({
                head: [
                    { label: "Name" },
                    { label: "Platform" },
                    { label: "Model" },
                    { label: "Reached at" },
                    { label: "Ports declared" },
                    { label: "Snapshot" },
                    { label: "Found" },
                ],
                rows: data.devices.map((device) => ({
                    cells: [
                        h("strong", {}, deviceLink(device.name)),
                        device.platform,
                        device.model,
                        device.connection.host,
                        `${Object.keys(device.ports ?? {}).length} of ${data.ports[device.name]?.length ?? "?"}`,
                        SNAPSHOT_TEXT[data.graph.drift[device.name]?.status ?? ""] ?? "",
                        findingBadges(device.name).some(Boolean)
                            ? h("span", {}, ...findingBadges(device.name))
                            : h("span", { class: "muted" }, "nothing"),
                    ],
                })),
            })
        );
    }

    function deviceView(name: string, sectionId: string | undefined, container: HTMLElement): void {
        const device = ui.data()!.devices.find((candidate) => candidate.name === name);
        if (!device) {
            container.append(
                heading("No such device", "h2"),
                empty(`The config has no device ${name}.`),
                link("All devices", () => ui.go("devices"))
            );
            return;
        }

        const sections = SECTIONS.filter((section) => section.has(device));
        const section = sections.find((candidate) => candidate.id === sectionId) ?? sections[0]!;

        const tabs = h("nav", { class: "tabs", "aria-label": "Sections" });
        for (const candidate of sections) {
            const button = h("button", { "aria-pressed": String(candidate === section) }, candidate.title);
            button.addEventListener("click", () => ui.go(`devices/${encodeURIComponent(device.name)}/${candidate.id}`));
            tabs.append(button);
        }

        container.append(
            h(
                "div",
                { class: "device-head" },
                h(
                    "p",
                    { class: "crumbs" },
                    link("Devices", () => ui.go("devices")),
                    " / "
                ),
                h("h2", {}, device.name, " ", ...findingBadges(device.name)),
                h(
                    "p",
                    { class: "muted" },
                    `${device.platform} ${device.model}, reached at ${device.connection.host} · `,
                    link("show in the graph", () => ui.showDevice(device.name))
                )
            ),
            tabs,
            h("div", { class: "section" }, ...section.render(device))
        );
    }

    function vlansView(container: HTMLElement): void {
        const data = ui.data()!;
        type Row = { names: Set<string>; declared: string[]; gateways: string[]; ports: string[] };
        const byId = new Map<number, Row>();

        for (const device of data.devices) {
            for (const [name, vlan] of Object.entries(device.vlans ?? {})) {
                const row = byId.get(vlan.id) ?? { names: new Set(), declared: [], gateways: [], ports: [] };
                row.names.add(name);
                row.declared.push(device.name);

                const gateways = Object.entries(device.interfaces ?? {}).filter(
                    ([, iface]) => iface.type === "vlan" && iface.vlan === name
                );
                for (const [iface, settingsOfInterface] of gateways) {
                    row.gateways.push(`${device.name} ${iface} ${compact(settingsOfInterface.addresses)}`.trim());
                }

                const carriers = Object.values({ ...device.ports, ...device.interfaces }) as (Record<string, Value> | undefined)[];
                const access = carriers.filter((carrier) => carrier?.access_vlan === name).length;
                const trunk = carriers.filter(
                    (carrier) => Array.isArray(carrier?.trunk_vlans) && carrier.trunk_vlans.includes(name)
                ).length;
                if (access || trunk)
                    row.ports.push(
                        `${device.name}: ${[access ? `${access} access` : "", trunk ? `${trunk} trunk` : ""].filter(Boolean).join(", ")}`
                    );

                byId.set(vlan.id, row);
            }
        }

        const ids = [...byId.keys()].sort((a, b) => a - b);

        container.append(
            heading("VLANs", "h2"),
            h("p", { class: "muted" }, "Every VLAN any device declares. One id under two names is worth a look."),
            ids.length
                ? table({
                      head: [
                          { label: "VLAN" },
                          { label: "Name" },
                          { label: "Declared on" },
                          { label: "Gateway" },
                          { label: "Ports" },
                          { label: "" },
                      ],
                      rows: ids.map((id) => {
                          const row = byId.get(id)!;
                          return {
                              cells: [
                                  h("strong", {}, String(id)),
                                  [...row.names].join(", "),
                                  h("span", {}, ...row.declared.flatMap((name, index) => [index ? ", " : "", deviceLink(name)])),
                                  row.gateways.join("; "),
                                  row.ports.join("; "),
                                  link("cables in the graph", () => ui.showVlan(id)),
                              ],
                          };
                      }),
                  })
                : empty("No device declares a VLAN.")
        );
    }

    function addressesView(container: HTMLElement): void {
        const { spaces, elsewhere } = ui.data()!.addresses;
        container.append(
            heading("Addresses", "h2"),
            h("p", { class: "muted" }, "Every address the config uses, by prefix, and what is still free, as circuit addresses prints it.")
        );

        const segmentsAndBlocks = (segments: typeof elsewhere.segments, blocks: typeof elsewhere.blocks) => {
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

        if (!spaces.length && !elsewhere.segments.length && !elsewhere.blocks.length)
            container.append(empty("The config holds no addresses."));
    }

    function sessionsView(container: HTMLElement): void {
        const { sessions, devices } = ui.data()!;
        const ours = new Set(devices.map((device) => device.name));

        container.append(
            heading("BGP sessions", "h2"),
            h(
                "p",
                { class: "muted" },
                "Every BGP neighbor, with its group's settings filled in. A far end that is one of our devices links to it."
            ),
            sessions.length
                ? table({
                      head: ["Device", "Neighbor", "Address", "Remote AS", "Role", "Import", "Export", "Far end", ""].map((label) => ({
                          label,
                      })),
                      rows: sessions.map((session) => ({
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

    function cablesView(container: HTMLElement): void {
        const { cables } = ui.data()!;

        container.append(
            heading("Cables", "h2"),
            h("p", { class: "muted" }, "Every cable a port's link names, once, from the end that names it first."),
            cables.length
                ? table({
                      head: ["Device", "Port", "Far device", "Far port", "LAG", "VLANs", "Description", ""].map((label) => ({ label })),
                      rows: cables.map((cable) => ({
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

    // Which section shows each part of a device, for search results.
    const SECTION_OF: Record<string, string> = {
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

    function searchView(query: string, container: HTMLElement): void {
        const data = ui.data()!;
        const needle = query.toLowerCase();
        const results: { device: string; section: string; path: string; text: string }[] = [];

        const walk = (device: string, path: string[], value: Value) => {
            if (results.length >= 200) return;

            if (isSecret(value)) return check(device, path, secretText(value as Record<string, Value>));
            if (Array.isArray(value)) return value.forEach((item, index) => walk(device, [...path, String(index + 1)], item));
            if (isObject(value)) {
                for (const [key, inner] of Object.entries(value)) {
                    // A name a device declares, such as a port or a VLAN, is a match too.
                    if (key.toLowerCase().includes(needle) && path.length) check(device, [...path, key], key);
                    walk(device, [...path, key], inner);
                }
                return;
            }

            if (value !== undefined && value !== null) check(device, path, String(value));
        };

        const check = (device: string, path: string[], text: string) => {
            if (!text.toLowerCase().includes(needle)) return;
            if (path.at(-1) === "certificate") return;
            results.push({ device, section: SECTION_OF[path[0] ?? ""] ?? "overview", path: path.join(" › "), text });
        };

        for (const device of data.devices) walk(device.name, [], device);

        container.append(heading(`Search: ${query}`, "h2"));

        if (!results.length) {
            container.append(empty("Nothing in the config matches."));
            return;
        }

        container.append(
            h(
                "p",
                { class: "muted" },
                results.length >= 200 ? "The first 200 matches." : `${results.length} ${results.length === 1 ? "match" : "matches"}.`
            ),
            table({
                head: ["Device", "Where", "Value"].map((label) => ({ label })),
                rows: results.map((result) => ({
                    cells: [
                        deviceLink(result.device),
                        link(result.path, () => ui.go(`devices/${encodeURIComponent(result.device)}/${result.section}`)),
                        result.text.length > 120 ? `${result.text.slice(0, 120)}…` : result.text,
                    ],
                })),
            })
        );
    }

    return (route, container) => {
        container.replaceChildren();
        if (!ui.data()) return;

        const [view, first, second] = route;

        if (view === "devices" && first) deviceView(first, second, container);
        else if (view === "devices") devicesView(container);
        else if (view === "vlans") vlansView(container);
        else if (view === "addresses") addressesView(container);
        else if (view === "sessions") sessionsView(container);
        else if (view === "cables") cablesView(container);
        else if (view === "search") searchView(first ?? "", container);
    };
}
