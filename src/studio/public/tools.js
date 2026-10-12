// @ts-check
/// <reference lib="dom" />
// Studio's tools, for finding out why something does or does not reach where it should: trace an address, find the VLAN path between two devices, test a packet against a firewall, and test a route against a route policy.

import { go, h, link } from "./dom.js";
import { filterPacket, routeThrough, trace, vlanPath } from "./evaluate.js";
import { lightPath } from "./graph.js";
import { deviceLink, empty, heading, prose, table } from "./tables.js";

/** @typedef {import("../data").StudioData} StudioData */
/** @typedef {import("../../schema").Device} Device */
/** @typedef {import("./dom.js").Child} Child */
/** @typedef {import("./evaluate.js").Check} Check */

/** What Studio shows, set each time a tool is drawn. @type {StudioData} */
let data;

/** What was typed into each tool, kept while the page is open, so a tool drawn again shows its last answer. */
const typed = {
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

const TOOLS = [
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
const field = (label, control, hint) =>
    h("label", { class: "field" }, h("span", {}, label), control, hint ? h("small", { class: "muted" }, hint) : undefined);

/**
 * A text box that keeps what is typed in `store[key]`.
 *
 * @param {Record<string, unknown>} store
 * @param {string} key
 * @param {string} [placeholder]
 */
function textBox(store, key, placeholder = "") {
    const input = h("input", { type: "text", value: String(store[key] ?? ""), placeholder, spellcheck: "false" });
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
function choice(store, key, options, changed) {
    const select = h(
        "select",
        {},
        ...options.map(([value, text]) => h("option", { value, ...(value === store[key] ? { selected: "" } : {}) }, text))
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
const verdictOf = (check) =>
    check.answer === "yes"
        ? "matches"
        : check.answer === "no"
          ? `does not match: ${check.why.join("; ")}`
          : `cannot tell without ${check.why.join(", ")}`;

/**
 * @param {string} text
 * @param {() => void} action
 */
function button(text, action) {
    const element = h("button", { type: "submit", class: "primary" }, text);
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
function traceTool(asked, container) {
    const store = { address: asked ?? "" };
    const input = textBox(store, "address", "10.0.10.5");

    container.append(
        prose(
            "Where an address is in the network, how each device would reach it from what the files say, and every firewall rule and ACL that names it."
        ),
        h(
            "form",
            { class: "tool-form" },
            field("Address", input),
            button("Trace", () => store.address.trim() && go(`tools/trace/${encodeURIComponent(store.address.trim())}`))
        )
    );

    if (!asked) return;

    const found = trace(data, asked);
    if (!found) {
        container.append(empty(`${asked} is not an address, such as 10.0.10.5 or 2001:db8::1.`));
        return;
    }

    const holder = found.held.length
        ? h(
              "span",
              {},
              "It is held by ",
              ...found.held.flatMap((held, index) => [index ? ", " : "", deviceLink(held.device), ` ${held.where}`]),
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

    container.append(heading(asked, "h2"), h("p", {}, holder, " ", where));

    if (found.uses.length) {
        container.append(
            heading("Used by"),
            table({
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
        heading("How each device reaches it"),
        prose("Routes a device learns from BGP or OSPF are not in the files, so a device with no route here may still reach it."),
        table({
            csv: `trace-${asked}`,
            head: ["Device", "Table", "By", "Prefix", "Next hop or interface", "Note"].map((label) => ({ label })),
            rows: found.routes.map((route) => ({
                muted: route.kind === "none",
                cells: [
                    deviceLink(route.device),
                    route.table,
                    kinds[route.kind],
                    route.prefix ?? "",
                    [route.via, route.through].filter(Boolean).join(", "),
                    route.note ?? "",
                ],
            })),
        })
    );

    container.append(heading("Rules that name it"));
    container.append(
        found.rules.length
            ? table({
                  head: ["Device", "Where", "Rule", "Description", "Action", "Names it as"].map((label) => ({ label })),
                  rows: found.rules.map((rule) => ({
                      cells: [deviceLink(rule.device), rule.where, String(rule.rule), rule.description ?? "", rule.action, rule.side],
                  })),
              })
            : empty("No firewall rule or ACL names it, by address, prefix or address set.")
    );
}

// The VLAN path between two devices.

/** @param {HTMLElement} container */
function vlanTool(container) {
    const store = typed.vlan;
    const vlans = new Map();
    for (const edge of data.graph.edges) for (const vlan of edge.vlans ?? []) vlans.set(vlan.id, vlan.name);

    const devices = data.devices.map((device) => /** @type {[string, string]} */ ([device.name, device.name]));
    const vlanChoices = [...vlans]
        .sort(([a], [b]) => a - b)
        .map(([id, name]) => /** @type {[string, string]} */ ([String(id), `${name} (${id})`]));

    const result = h("div");
    const find = () => {
        result.replaceChildren();

        const path = vlanPath(data, Number(store.vlan), store.from, store.to);
        if (store.from === store.to) return result.append(empty("Pick two different devices."));
        if (!path) return result.append(empty(`No cables carry VLAN ${store.vlan} from ${store.from} to ${store.to}.`));

        const cableOf = (/** @type {import("../../core/graph").GraphEdge} */ edge) =>
            data.graph.edges.find(
                (other) =>
                    other.layer === "l1" &&
                    ((other.from === edge.from && other.to === edge.to) || (other.from === edge.to && other.to === edge.from))
            )?.label ?? "";
        const nameOf = (/** @type {string} */ id) => id.replace(/^device:/, "");

        result.append(
            h(
                "p",
                {},
                `${path.length} ${path.length === 1 ? "cable" : "cables"} carry it from ${store.from} to ${store.to}. `,
                link("Show in the graph", () => {
                    lightPath(path);
                    go("graph/l2");
                })
            ),
            table({
                head: ["#", "From", "To", "Cable"].map((label) => ({ label })),
                rows: path.map((edge, index) => ({
                    cells: [String(index + 1), deviceLink(nameOf(edge.from)), deviceLink(nameOf(edge.to)), cableOf(edge)],
                })),
            })
        );
    };

    if (!vlanChoices.length) return container.append(empty("No cable carries a VLAN."));

    container.append(
        prose("The fewest cables that carry a VLAN from one device to another, from the ports' VLANs and links."),
        h(
            "form",
            { class: "tool-form" },
            field("VLAN", choice(store, "vlan", vlanChoices)),
            field("From", choice(store, "from", devices)),
            field("To", choice(store, "to", devices)),
            button("Find the path", find)
        ),
        result
    );
}

// Test a firewall.

/** @param {HTMLElement} container */
function firewallTool(container) {
    const store = typed.firewall;
    const devices = data.devices.filter((device) => Object.values(device.firewall?.filter ?? {}).some(Boolean));
    if (!devices.length) return container.append(empty("No device has a firewall filter."));

    const result = h("div");
    const form = h("form", { class: "tool-form" });

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

        const flags = h("span", { class: "flags" });
        for (const flag of ["syn", "ack", "fin", "rst", "psh", "urg"]) {
            const box = h("input", { type: "checkbox", ...(store.flags.includes(flag) ? { checked: "" } : {}) });
            box.addEventListener(
                "change",
                () => (store.flags = box.checked ? [...store.flags, flag] : store.flags.filter((other) => other !== flag))
            );
            flags.append(h("label", { class: "flag" }, box, flag));
        }

        form.append(
            field(
                "Device",
                choice(
                    store,
                    "device",
                    devices.map((candidate) => [candidate.name, candidate.name]),
                    draw
                )
            ),
            field("Chain", choice(store, "chain", chains)),
            field("Protocol", choice(store, "protocol", protocols)),
            field("Source", textBox(store, "src", "203.0.113.9")),
            field("Destination", textBox(store, "dst", "192.0.2.1")),
            field("Source port", textBox(store, "srcPort")),
            field("Destination port", textBox(store, "dstPort", "22")),
            field("Arrives on", choice(store, "inInterface", names)),
            field("Leaves through", choice(store, "outInterface", names)),
            field("State", choice(store, "state", states)),
            field("TCP flags", flags, "Leave all unticked when not known."),
            button("Test", test)
        );
    };

    const test = () => {
        result.replaceChildren();
        const device = devices.find((candidate) => candidate.name === store.device) ?? /** @type {Device} */ (devices[0]);
        const port = (/** @type {string} */ text) => (text.trim() === "" ? undefined : Number(text));

        const outcome = filterPacket(device, /** @type {"input" | "forward" | "output"} */ (store.chain), {
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
            ? h("p", { class: `verdict ${outcome.verdict}` }, `${outcome.verdict}, by ${outcome.by}.`)
            : h("p", { class: "verdict unknown" }, `Cannot tell: ${outcome.by} needs more about the packet.`);
        const reached = outcome.steps.length;
        const rules = device.firewall?.filter?.[/** @type {"input" | "forward" | "output"} */ (store.chain)]?.rules ?? [];

        result.append(
            decided,
            table({
                head: ["Rule", "Description", "Action", "This packet"].map((label) => ({ label })),
                rows: rules.map((rule, index) => {
                    const step = outcome.steps[index];
                    return {
                        muted: index >= reached,
                        cells: [String(index + 1), rule.description ?? "", rule.action, step ? verdictOf(step.check) : "not reached"],
                    };
                }),
            })
        );
    };

    draw();
    container.append(
        prose("Which rule of a device's filter chain a packet meets, first match first, as the schema describes each condition."),
        form,
        result
    );
}

// Test a route policy.

/** @param {HTMLElement} container */
function policyTool(container) {
    const store = typed.policy;
    const devices = data.devices.filter((device) => Object.keys(device.policies ?? {}).length);
    if (!devices.length) return container.append(empty("No device has a route policy."));

    const result = h("div");
    const form = h("form", { class: "tool-form" });

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
        const sets = h("span", { class: "flags" });
        for (const [name] of registrySets) {
            const box = h("input", { type: "checkbox", ...(store.inRegistrySets.includes(name) ? { checked: "" } : {}) });
            box.addEventListener(
                "change",
                () =>
                    (store.inRegistrySets = box.checked
                        ? [...store.inRegistrySets, name]
                        : store.inRegistrySets.filter((other) => other !== name))
            );
            sets.append(h("label", { class: "flag" }, box, name));
        }

        form.append(
            field(
                "Device",
                choice(
                    store,
                    "device",
                    devices.map((candidate) => [candidate.name, candidate.name]),
                    draw
                )
            ),
            field("Policy", choice(store, "policy", policies)),
            field("Prefix", textBox(store, "prefix", "198.51.100.0/24")),
            field("AS path length", textBox(store, "asPathLength"), "As the route arrives."),
            field(
                "RPKI",
                choice(store, "rpki", [
                    ["", "not known"],
                    ["valid", "valid"],
                    ["invalid", "invalid"],
                    ["not-found", "not found"],
                ])
            ),
            field("Communities", textBox(store, "communities", "64500:100"), "Separated by spaces or commas."),
            field("Large communities", textBox(store, "largeCommunities", "64500:1:1")),
            ...(registrySets.length
                ? [field("In prefix sets from a registry", sets, "Their prefixes are fetched by circuit refresh and are not in the files.")]
                : []),
            button("Test", test)
        );
    };

    const test = () => {
        result.replaceChildren();
        const device = devices.find((candidate) => candidate.name === store.device) ?? /** @type {Device} */ (devices[0]);
        const list = (/** @type {string} */ text) => text.split(/[\s,]+/).filter(Boolean);

        if (!store.prefix.trim()) return result.append(empty("Give the route's prefix, such as 198.51.100.0/24."));

        const outcome = routeThrough(device, store.policy, {
            prefix: store.prefix.trim(),
            asPathLength: store.asPathLength.trim() === "" ? undefined : Number(store.asPathLength),
            rpki: store.rpki || undefined,
            communities: list(store.communities),
            largeCommunities: list(store.largeCommunities),
            inRegistrySets: store.inRegistrySets,
        });

        const decided =
            outcome.decision === "unknown"
                ? h(
                      "p",
                      { class: "verdict unknown" },
                      `Cannot tell: rule ${outcome.steps.at(-1)?.rule} of ${outcome.steps.at(-1)?.policy} needs more about the route.`
                  )
                : h(
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
            table({
                head: ["Policy", "Rule", "Description", "This route", "Changes", "Decision"].map((label) => ({ label })),
                rows: outcome.steps.map((step) => ({
                    cells: [
                        step.policy,
                        String(step.rule),
                        step.description ?? (step.call ? `calls ${step.call}` : ""),
                        verdictOf(step.check),
                        step.changed.join("; "),
                        step.decision ?? "",
                    ],
                })),
            }),
            ...(outcome.decision === "accept" ? [h("p", {}, "The route leaves with ", final.join(", "), ".")] : [])
        );
    };

    draw();
    container.append(
        prose(
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
export function showTools(route, container, next) {
    data = next;
    container.replaceChildren();

    const [, asked = "trace", argument] = route;
    const tool = TOOLS.find(([id]) => id === asked) ?? TOOLS[0];
    if (!tool) return;

    const tabs = h("nav", { class: "tabs", "aria-label": "Tools" });
    for (const [id, title] of TOOLS) {
        const tab = h("button", { "aria-pressed": String(id === tool[0]) }, title ?? id ?? "");
        tab.addEventListener("click", () => go(`tools/${id}`));
        tabs.append(tab);
    }

    const body = h("div", { class: "section" });
    container.append(
        heading("Tools", "h2"),
        prose(
            "They read the files as the schema describes each field. A device can still behave otherwise; these say what the config means."
        ),
        tabs,
        body
    );

    if (tool[0] === "trace") traceTool(argument, body);
    else if (tool[0] === "vlan") vlanTool(body);
    else if (tool[0] === "firewall") firewallTool(body);
    else policyTool(body);
}
