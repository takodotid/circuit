// A prefix set a registry fills is fetched by `diff` and `apply`, and then planned like any list written out: each prefix added or
// removed, never the list emptied first. An answer that can't be right stops before anything is sent.

import { afterEach, expect, test } from "bun:test";
import { Registries } from "../../src/core/registries";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

/** RIPEstat answering `prefixes`, and the queries asked of it. */
function ripeStat(prefixes: string[], status = 200): string[] {
    const asked: string[] = [];
    globalThis.fetch = Object.assign(
        async (input: string | URL | Request) => {
            asked.push(String(input));
            return new Response(JSON.stringify({ data: { prefixes: prefixes.map((prefix) => ({ prefix })) } }), { status });
        },
        { preconnect: realFetch.preconnect }
    );
    return asked;
}

// The example router, with only the sets it writes out, then with one set a registry fills.
const example = Fixtures.device("platforms--example-router");
const written = Object.fromEntries(Object.entries(example.routing?.prefix_sets ?? {}).filter(([, set]) => set && "prefixes" in set));
const router: Device = { ...example, routing: { ...example.routing, prefix_sets: written } };
const device: Device = {
    ...router,
    routing: {
        ...router.routing,
        prefix_sets: { ...written, "customer-a-v4": { source: { registry: "ripe-stat", query: "AS64501", family: "ipv4" } } },
    },
};

test("a set a registry fills becomes the prefixes it gave, of its family only", async () => {
    const asked = ripeStat(["198.51.100.0/24", "203.0.113.0/24", "2001:db8:1::/48"]);
    const told: string[] = [];

    const fetched = await Registries.resolve(device, (line) => told.push(line));

    expect(asked).toEqual(["https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS64501"]);
    expect(fetched.routing?.prefix_sets?.["customer-a-v4"]).toEqual({ prefixes: ["198.51.100.0/24", "203.0.113.0/24"] });
    expect(told).toEqual(["customer-a-v4: 2 ipv4 prefix(es) from ripe-stat AS64501"]);
    expect(device.routing?.prefix_sets?.["customer-a-v4"]).toEqual({ source: { registry: "ripe-stat", query: "AS64501", family: "ipv4" } });
});

test("on RouterOS the fetched prefixes are entries of the list, which the plan adds one by one", async () => {
    ripeStat(["198.51.100.0/24", "203.0.113.0/24"]);
    const platform = Platforms.get("routeros");
    const fetched = await Registries.resolve(device);

    const before = platform.render({
        ...fetched,
        routing: {
            ...fetched.routing,
            prefix_sets: { ...fetched.routing?.prefix_sets, "customer-a-v4": { prefixes: ["198.51.100.0/24"] } },
        },
    });
    const plan = platform.plan(platform.render(fetched), before, { secrets: false, rollback: 10 });
    const sent = plan.steps.flatMap((step) => step.send).join("\n");

    expect(sent).toContain("add address=203.0.113.0/24 list=customer-a-v4");
    expect(sent).not.toContain("remove");
});

test("nothing to go on stops before anything is sent: no answer, an empty one, or too many prefixes", async () => {
    ripeStat([], 200);
    expect(Registries.resolve(device)).rejects.toThrow(
        "routing.prefix_sets.customer-a-v4: ripe-stat gave no ipv4 prefix for AS64501, so nothing was sent"
    );

    ripeStat([], 503);
    expect(Registries.resolve(device)).rejects.toThrow("routing.prefix_sets.customer-a-v4: ripe-stat AS64501: ripe-stat answered 503");

    ripeStat(Array.from({ length: Registries.MOST + 1 }, (_, index) => `10.${index >> 16}.${(index >> 8) & 255}.${index & 255}/32`));
    expect(Registries.resolve(device)).rejects.toThrow(`more than ${Registries.MOST}: check the query`);
});

test("a device with no such set is left as it is, without asking any registry", async () => {
    const asked = ripeStat(["198.51.100.0/24"]);
    expect(await Registries.resolve(router)).toBe(router);
    expect(asked).toEqual([]);
});
