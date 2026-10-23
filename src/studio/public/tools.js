// @ts-check
/// <reference lib="dom" />
// Studio's tools, for finding out why something does or does not reach where it should: trace an address, find the VLAN path between two devices, test a packet against a firewall, and test a route against a route policy.

import { Dom } from "./dom.js";
import { Evaluate } from "./evaluate.js";
import { Graph } from "./graph.js";
import { Tables } from "./tables.js";

/** @typedef {import("../data").StudioData} StudioData */
/** @typedef {import("../../schema").Device} Device */
/** @typedef {import("./dom.js").Child} Child */
/** @typedef {import("./evaluate.js").Check} Check */

export class Tools {
    /** What Studio shows, set each time a tool is drawn. @type {StudioData} */
    static #data;

    /** What was typed into each tool, kept while the page is open, so a tool drawn again shows its last answer. */
    static #typed = {
        vlan: { vlan: "", from: "", to: "" },
        firewall: {
            device: "",
            chain: "input",
            protocol: "tcp",
            src: "",
            dst: "",
            srcPort: "",
            dstPort: "",
            inInterface: "",
            outInterface: "",
            state: "new",
            flags: /** @type {string[]} */ ([]),
        },
        policy: {
            device: "",
            policy: "",
            prefix: "",
            asPathLength: "",
            rpki: "",
            communities: "",
            largeCommunities: "",
            inRegistrySets: /** @type {string[]} */ ([]),
        },
    };

    static #TOOLS = [
        ["trace", "Trace an address"],
        ["vlan", "VLAN path"],
        ["firewall", "Test a firewall"],
        ["policy", "Test a route policy"],
    ];

    /**
     * A labelled field.
     *
     * @param {string} label
     * @param {HTMLElement} control
     * @param {string} [hint]
     */
    static #field(label, control, hint) {
        return Dom.h(
            "label",
            { class: "field" },
            Dom.h("span", {}, label),
            control,
            hint ? Dom.h("small", { class: "muted" }, hint) : undefined
        );
    }

    /**
     * A text box that keeps what is typed in `store[key]`.
     *
     * @param {Record<string, unknown>} store
     * @param {string} key
     * @param {string} [placeholder]
     */
    static #textBox(store, key, placeholder = "") {
        const input = Dom.h("input", { type: "text", value: String(store[key] ?? ""), placeholder, spellcheck: "false" });
        input.addEventListener("input", () => (store[key] = input.value));
        return input;
    }

    /**
     * A choice that keeps what is chosen in `store[key]`.
     *
     * @param {Record<string, unknown>} store
     * @param {string} key
     * @param {[string, string][]} options value and text
     * @param {() => void} [changed]
     */
    static #choice(store, key, options, changed) {
        const select = Dom.h(
            "select",
            {},
            ...options.map(([value, text]) => Dom.h("option", { value, ...(value === store[key] ? { selected: "" } : {}) }, text))
        );
        if (!options.some(([value]) => value === store[key])) store[key] = options[0]?.[0] ?? "";
        select.value = String(store[key]);
        select.addEventListener("change", () => {
            store[key] = select.value;
            changed?.();
        });
        return select;
    }

    /**
     * What a check found, in words.
     *
     * @param {Check} check
     */
    static #verdictOf(check) {
        return check.answer === "yes"
            ? "matches"
            : check.answer === "no"
              ? `does not match: ${check.why.join("; ")}`
              : `cannot tell without ${check.why.join(", ")}`;
    }

    /**
     * @param {string} text
     * @param {() => void} action
     */
    static #button(text, action) {
        const element = Dom.h("button", { type: "submit", class: "primary" }, text);
        element.addEventListener("click", (event) => {
            event.preventDefault();
            action();
        });
        return element;
    }

    // Trace an address.

    /**
     * @param {string | undefined} asked
     * @param {HTMLElement} container
     */
    static #trace(asked, container) {
        const store = { address: asked ?? "" };
        const input = Tools.#textBox(store, "address", "10.0.10.5");

        container.append(
            Tables.prose(
                "Where an address is in the network, how each device would reach it from what the files say, and every firewall rule and ACL that names it."
            ),
            Dom.h(
                "form",
                { class: "tool-form" },
                Tools.#field("Address", input),
                Tools.#button("Trace", () => store.address.trim() && Dom.go(`tools/trace/${encodeURIComponent(store.address.trim())}`))
            )
        );

        if (!asked) return;

        const found = Evaluate.trace(Tools.#data, asked);
        if (!found) {
            container.append(Tables.empty(`${asked} is not an address, such as 10.0.10.5 or 2001:db8::1.`));
            return;
        }

        const holder = found.held.length
            ? Dom.h(
                  "span",
                  {},
                  "It is held by ",
                  ...found.held.flatMap((held, index) => [index ? ", " : "", Tables.deviceLink(held.device), ` ${held.where}`]),
                  "."
              )
            : "No device holds it.";
        const where = found.segment
            ? `It is in ${found.segment.prefix}${found.space ? `, inside ${found.space.prefix}, ${found.space.owner}` : ""}.`
            : found.block
              ? `It is in ${found.block.prefix}: ${found.block.what}.`
              : found.space
                ? `It is in ${found.space.prefix}, ${found.space.owner}, where nothing uses it yet.`
                : "No segment or block of the network holds it.";

        container.append(Tables.heading(asked, "h2"), Dom.h("p", {}, holder, " ", where));

        if (found.uses.length) {
            container.append(
                Tables.heading("Used by"),
                Tables.of({
                    head: [{ label: "Address" }, { label: "Used by" }],
                    rows: found.uses.map((use) => ({ cells: [use.address, use.what] })),
                })
            );
        }

        const kinds = {
            local: "it is its own address",
            connected: "an address of its own is in the same prefix",
            static: "a static route",
            none: "no route in the files",
        };

        container.append(
            Tables.heading("How each device reaches it"),
            Tables.prose(
                "Routes a device learns from BGP or OSPF are not in the files, so a device with no route here may still reach it."
            ),
            Tables.of({
                csv: `trace-${asked}`,
                head: ["Device", "Table", "By", "Prefix", "Next hop or interface", "Note"].map((label) => ({ label })),
                rows: found.routes.map((route) => ({
                    muted: route.kind === "none",
                    cells: [
                        Tables.deviceLink(route.device),
                        route.table,
                        kinds[route.kind],
                        route.prefix ?? "",
                        [route.via, route.through].filter(Boolean).join(", "),
                        route.note ?? "",
                    ],
                })),
            })
        );

        container.append(Tables.heading("Rules that name it"));
        container.append(
            found.rules.length
                ? Tables.of({
                      head: ["Device", "Where", "Rule", "Description", "Action", "Names it as"].map((label) => ({ label })),
                      rows: found.rules.map((rule) => ({
                          cells: [
                              Tables.deviceLink(rule.device),
                              rule.where,
                              String(rule.rule),
                              rule.description ?? "",
                              rule.action,
                              rule.side,
                          ],
                      })),
                  })
                : Tables.empty("No firewall rule or ACL names it, by address, prefix or address set.")
        );
    }

    // The VLAN path between two devices.

    /** @param {HTMLElement} container */
    static #vlan(container) {
        const store = Tools.#typed.vlan;
        const vlans = new Map();
        for (const edge of Tools.#data.graph.edges) for (const vlan of edge.vlans ?? []) vlans.set(vlan.id, vlan.name);

        const devices = Tools.#data.devices.map((device) => /** @type {[string, string]} */ ([device.name, device.name]));
        const vlanChoices = [...vlans]
            .sort(([a], [b]) => a - b)
            .map(([id, name]) => /** @type {[string, string]} */ ([String(id), `${name} (${id})`]));

        const result = Dom.h("div");
        const find = () => {
            result.replaceChildren();

            const path = Evaluate.vlanPath(Tools.#data, Number(store.vlan), store.from, store.to);
            if (store.from === store.to) return result.append(Tables.empty("Pick two different devices."));
            if (!path) return result.append(Tables.empty(`No cables carry VLAN ${store.vlan} from ${store.from} to ${store.to}.`));

            const cableOf = (/** @type {import("../../core/topology").GraphEdge} */ edge) =>
                Tools.#data.graph.edges.find(
                    (other) =>
                        other.layer === "l1" &&
                        ((other.from === edge.from && other.to === edge.to) || (other.from === edge.to && other.to === edge.from))
                )?.label ?? "";
            const nameOf = (/** @type {string} */ id) => id.replace(/^device:/, "");

            result.append(
                Dom.h(
                    "p",
                    {},
                    `${path.length} ${path.length === 1 ? "cable" : "cables"} carry it from ${store.from} to ${store.to}. `,
                    Dom.link("Show in the graph", () => {
                        Graph.lightPath(path);
                        Dom.go("graph/l2");
                    })
                ),
                Tables.of({
                    head: ["#", "From", "To", "Cable"].map((label) => ({ label })),
                    rows: path.map((edge, index) => ({
                        cells: [String(index + 1), Tables.deviceLink(nameOf(edge.from)), Tables.deviceLink(nameOf(edge.to)), cableOf(edge)],
                    })),
                })
            );
        };

        if (!vlanChoices.length) return container.append(Tables.empty("No cable carries a VLAN."));

        container.append(
            Tables.prose("The fewest cables that carry a VLAN from one device to another, from the ports' VLANs and links."),
            Dom.h(
                "form",
                { class: "tool-form" },
                Tools.#field("VLAN", Tools.#choice(store, "vlan", vlanChoices)),
                Tools.#field("From", Tools.#choice(store, "from", devices)),
                Tools.#field("To", Tools.#choice(store, "to", devices)),
                Tools.#button("Find the path", find)
            ),
            result
        );
    }

    // Test a firewall.

    /** @param {HTMLElement} container */
    static #firewall(container) {
        const store = Tools.#typed.firewall;
        const devices = Tools.#data.devices.filter((device) => Object.values(device.firewall?.filter ?? {}).some(Boolean));
        if (!devices.length) return container.append(Tables.empty("No device has a firewall filter."));

        const result = Dom.h("div");
        const form = Dom.h("form", { class: "tool-form" });

        const draw = () => {
            form.replaceChildren();
            const device = devices.find((candidate) => candidate.name === store.device) ?? /** @type {Device} */ (devices[0]);
            const chains = /** @type {[string, string][]} */ (Object.keys(device.firewall?.filter ?? {}).map((chain) => [chain, chain]));
            const names = /** @type {[string, string][]} */ ([
                ["", "not given"],
                ...Object.keys({ ...device.ports, ...device.interfaces }).map((name) => [name, name]),
            ]);
            const protocols = /** @type {[string, string][]} */ (
                ["tcp", "udp", "icmp", "gre", "esp", "ah", "ospf", "vrrp"].map((name) => [name, name])
            );
            const states = /** @type {[string, string][]} */ (
                ["new", "established", "related", "untracked", "invalid"].map((name) => [name, name])
            );

            const flags = Dom.h("span", { class: "flags" });
            for (const flag of ["syn", "ack", "fin", "rst", "psh", "urg"]) {
                const box = Dom.h("input", { type: "checkbox", ...(store.flags.includes(flag) ? { checked: "" } : {}) });
                box.addEventListener(
                    "change",
                    () => (store.flags = box.checked ? [...store.flags, flag] : store.flags.filter((other) => other !== flag))
                );
                flags.append(Dom.h("label", { class: "flag" }, box, flag));
            }

            form.append(
                Tools.#field(
                    "Device",
                    Tools.#choice(
                        store,
                        "device",
                        devices.map((candidate) => [candidate.name, candidate.name]),
                        draw
                    )
                ),
                Tools.#field("Chain", Tools.#choice(store, "chain", chains)),
                Tools.#field("Protocol", Tools.#choice(store, "protocol", protocols)),
                Tools.#field("Source", Tools.#textBox(store, "src", "203.0.113.9")),
                Tools.#field("Destination", Tools.#textBox(store, "dst", "192.0.2.1")),
                Tools.#field("Source port", Tools.#textBox(store, "srcPort")),
                Tools.#field("Destination port", Tools.#textBox(store, "dstPort", "22")),
                Tools.#field("Arrives on", Tools.#choice(store, "inInterface", names)),
                Tools.#field("Leaves through", Tools.#choice(store, "outInterface", names)),
                Tools.#field("State", Tools.#choice(store, "state", states)),
                Tools.#field("TCP flags", flags, "Leave all unticked when not known."),
                Tools.#button("Test", test)
            );
        };

        const test = () => {
            result.replaceChildren();
            const device = devices.find((candidate) => candidate.name === store.device) ?? /** @type {Device} */ (devices[0]);
            const port = (/** @type {string} */ text) => (text.trim() === "" ? undefined : Number(text));

            const outcome = Evaluate.filterPacket(device, /** @type {"input" | "forward" | "output"} */ (store.chain), {
                protocol: store.protocol,
                src: store.src.trim() || undefined,
                dst: store.dst.trim() || undefined,
                srcPort: port(store.srcPort),
                dstPort: port(store.dstPort),
                inInterface: store.inInterface || undefined,
                outInterface: store.outInterface || undefined,
                state: store.state,
                flags: store.flags.length ? store.flags : undefined,
            });

            const decided = outcome.verdict
                ? Dom.h("p", { class: `verdict ${outcome.verdict}` }, `${outcome.verdict}, by ${outcome.by}.`)
                : Dom.h("p", { class: "verdict unknown" }, `Cannot tell: ${outcome.by} needs more about the packet.`);
            const reached = outcome.steps.length;
            const rules = device.firewall?.filter?.[/** @type {"input" | "forward" | "output"} */ (store.chain)]?.rules ?? [];

            result.append(
                decided,
                Tables.of({
                    head: ["Rule", "Description", "Action", "This packet"].map((label) => ({ label })),
                    rows: rules.map((rule, index) => {
                        const step = outcome.steps[index];
                        return {
                            muted: index >= reached,
                            cells: [
                                String(index + 1),
                                rule.description ?? "",
                                rule.action,
                                step ? Tools.#verdictOf(step.check) : "not reached",
                            ],
                        };
                    }),
                })
            );
        };

        draw();
        container.append(
            Tables.prose(
                "Which rule of a device's filter chain a packet meets, first match first, as the schema describes each condition."
            ),
            form,
            result
        );
    }

    // Test a route policy.

    /** @param {HTMLElement} container */
    static #policy(container) {
        const store = Tools.#typed.policy;
        const devices = Tools.#data.devices.filter((device) => Object.keys(device.policies ?? {}).length);
        if (!devices.length) return container.append(Tables.empty("No device has a route policy."));

        const result = Dom.h("div");
        const form = Dom.h("form", { class: "tool-form" });

        const draw = () => {
            form.replaceChildren();
            const device = devices.find((candidate) => candidate.name === store.device) ?? /** @type {Device} */ (devices[0]);
            const neighbors = Object.entries(device.routing?.bgp?.neighbors ?? {});
            const groups = device.routing?.bgp?.groups ?? {};

            // A policy is listed with the sessions that use it, so it can be picked by neighbor.
            const usedBy = (/** @type {string} */ policy) =>
                neighbors.flatMap(([name, neighbor]) => {
                    const group = neighbor.group ? groups[neighbor.group] : undefined;
                    return [
                        (neighbor.import ?? group?.import) === policy ? `import from ${name}` : "",
                        (neighbor.export ?? group?.export) === policy ? `export to ${name}` : "",
                    ].filter(Boolean);
                });

            const policies = /** @type {[string, string][]} */ (
                Object.keys(device.policies ?? {}).map((name) => {
                    const uses = usedBy(name);
                    return [name, uses.length ? `${name}: ${uses.join(", ")}` : name];
                })
            );

            const registrySets = Object.entries(device.prefix_sets ?? {}).filter(([, set]) => "source" in set);
            const sets = Dom.h("span", { class: "flags" });
            for (const [name] of registrySets) {
                const box = Dom.h("input", { type: "checkbox", ...(store.inRegistrySets.includes(name) ? { checked: "" } : {}) });
                box.addEventListener(
                    "change",
                    () =>
                        (store.inRegistrySets = box.checked
                            ? [...store.inRegistrySets, name]
                            : store.inRegistrySets.filter((other) => other !== name))
                );
                sets.append(Dom.h("label", { class: "flag" }, box, name));
            }

            form.append(
                Tools.#field(
                    "Device",
                    Tools.#choice(
                        store,
                        "device",
                        devices.map((candidate) => [candidate.name, candidate.name]),
                        draw
                    )
                ),
                Tools.#field("Policy", Tools.#choice(store, "policy", policies)),
                Tools.#field("Prefix", Tools.#textBox(store, "prefix", "198.51.100.0/24")),
                Tools.#field("AS path length", Tools.#textBox(store, "asPathLength"), "As the route arrives."),
                Tools.#field(
                    "RPKI",
                    Tools.#choice(store, "rpki", [
                        ["", "not known"],
                        ["valid", "valid"],
                        ["invalid", "invalid"],
                        ["not-found", "not found"],
                    ])
                ),
                Tools.#field("Communities", Tools.#textBox(store, "communities", "64500:100"), "Separated by spaces or commas."),
                Tools.#field("Large communities", Tools.#textBox(store, "largeCommunities", "64500:1:1")),
                ...(registrySets.length
                    ? [
                          Tools.#field(
                              "In prefix sets from a registry",
                              sets,
                              "Their prefixes are fetched by circuit refresh and are not in the files."
                          ),
                      ]
                    : []),
                Tools.#button("Test", test)
            );
        };

        const test = () => {
            result.replaceChildren();
            const device = devices.find((candidate) => candidate.name === store.device) ?? /** @type {Device} */ (devices[0]);
            const list = (/** @type {string} */ text) => text.split(/[\s,]+/).filter(Boolean);

            if (!store.prefix.trim()) return result.append(Tables.empty("Give the route's prefix, such as 198.51.100.0/24."));

            const outcome = Evaluate.routeThrough(device, store.policy, {
                prefix: store.prefix.trim(),
                asPathLength: store.asPathLength.trim() === "" ? undefined : Number(store.asPathLength),
                rpki: store.rpki || undefined,
                communities: list(store.communities),
                largeCommunities: list(store.largeCommunities),
                inRegistrySets: store.inRegistrySets,
            });

            const decided =
                outcome.decision === "unknown"
                    ? Dom.h(
                          "p",
                          { class: "verdict unknown" },
                          `Cannot tell: rule ${outcome.steps.at(-1)?.rule} of ${outcome.steps.at(-1)?.policy} needs more about the route.`
                      )
                    : Dom.h(
                          "p",
                          { class: `verdict ${outcome.decision}` },
                          `${outcome.decision}ed${outcome.byDefault ? ", since no rule accepted it" : ""}.`
                      );

            const { attributes } = outcome;
            const final = [
                attributes.localPref !== undefined ? `local preference ${attributes.localPref}` : "",
                attributes.med !== undefined ? `MED ${attributes.med}` : "",
                attributes.prepend ? `our AS prepended ${attributes.prepend} ${attributes.prepend === 1 ? "time" : "times"}` : "",
                `communities ${attributes.communities.join(", ") || "none"}`,
                `large communities ${attributes.largeCommunities.join(", ") || "none"}`,
                attributes.nextHop ? `next hop ${attributes.nextHop}` : "",
                attributes.preferredSource ? `preferred source ${attributes.preferredSource}` : "",
                attributes.blackhole ? "blackholed" : "",
            ].filter(Boolean);

            result.append(
                decided,
                Tables.of({
                    head: ["Policy", "Rule", "Description", "This route", "Changes", "Decision"].map((label) => ({ label })),
                    rows: outcome.steps.map((step) => ({
                        cells: [
                            step.policy,
                            String(step.rule),
                            step.description ?? (step.call ? `calls ${step.call}` : ""),
                            Tools.#verdictOf(step.check),
                            step.changed.join("; "),
                            step.decision ?? "",
                        ],
                    })),
                }),
                ...(outcome.decision === "accept" ? [Dom.h("p", {}, "The route leaves with ", final.join(", "), ".")] : [])
            );
        };

        draw();
        container.append(
            Tables.prose(
                "What a device's route policy does to a route: rule by rule, what matches, what changes, and the decision. A prefix set holds a route whose prefix is one of its own or inside one."
            ),
            form,
            result
        );
    }

    /**
     * Draw a tool, such as `["tools", "trace", "10.0.10.5"]`, into a container.
     *
     * @param {string[]} route
     * @param {HTMLElement} container
     * @param {StudioData} next
     */
    static show(route, container, next) {
        Tools.#data = next;
        container.replaceChildren();

        const [, asked = "trace", argument] = route;
        const tool = Tools.#TOOLS.find(([id]) => id === asked) ?? Tools.#TOOLS[0];
        if (!tool) return;

        const tabs = Dom.h("nav", { class: "tabs", "aria-label": "Tools" });
        for (const [id, title] of Tools.#TOOLS) {
            const tab = Dom.h("button", { "aria-pressed": String(id === tool[0]) }, title ?? id ?? "");
            tab.addEventListener("click", () => Dom.go(`tools/${id}`));
            tabs.append(tab);
        }

        const body = Dom.h("div", { class: "section" });
        container.append(
            Tables.heading("Tools", "h2"),
            Tables.prose(
                "They read the files as the schema describes each field. A device can still behave otherwise; these say what the config means."
            ),
            tabs,
            body
        );

        if (tool[0] === "trace") Tools.#trace(argument, body);
        else if (tool[0] === "vlan") Tools.#vlan(body);
        else if (tool[0] === "firewall") Tools.#firewall(body);
        else Tools.#policy(body);
    }
}
