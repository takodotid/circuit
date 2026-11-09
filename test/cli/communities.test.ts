// `circuit communities` prints the scheme's catalogue in each published format: NLNOG's lines, Alice-LG's section, and the JSON of
// draft-ietf-grow-yang-bgp-communities.

import { expect, test } from "bun:test";
import { Communities } from "../../src/cli/communities";
import { catalogue } from "../../src/config/communities";

const settings = {
    asn: 64500,
    sites: { "jakarta-1": { description: "Jakarta", number: 1 } },
    communities: {
        groups: { transit: { value: 1 }, exchange: { value: 2 } },
        learned_from_group: { code: 1 },
        learned_at_site: { code: 2 },
        do_not_announce_to_as: { code: 3 },
        prepend: { once: { code: 4 }, twice: { code: 5 } },
        blackhole: { code: 6 },
    },
};
const network = { name: "as64500", asn: 64500, communities: catalogue(settings), settings };

test("NLNOG's lines: where the file comes from, then community,description", () => {
    expect(Communities.text(network, "nlnog")).toBe(
        [
            "# AS64500 communities written by Circuit from the network's scheme",
            "64500:1:1,Learned from a transit",
            "64500:1:2,Learned from an exchange",
            "64500:2:1,Learned at jakarta-1",
            "64500:2:nnn,Learned at site $0",
            "64500:3:0,Do not announce to anyone",
            "64500:3:nnn,Do not announce to AS$0",
            "64500:4:nnn,Prepend once to AS$0",
            "64500:5:nnn,Prepend twice to AS$0",
            "64500:6:0,Blackhole: dropped in AS64500",
            "",
        ].join("\n")
    );
});

test("Alice-LG's section: * for any number, and $N for the part it stands in", () => {
    const lines = Communities.text(network, "alice").split("\n");
    expect(lines[0]).toBe("[bgp_communities]");
    expect(lines).toContain("64500:1:1 = Learned from a transit");
    expect(lines).toContain("64500:3:* = Do not announce to AS$2");
    expect(lines).toContain("64500:2:* = Learned at site $2");
});

test("the YANG model's JSON: one entry per community, named once each, tags informational and requests actions", () => {
    const json = Communities.json(network, 64500);
    const set = json["ietf-bgp-communities:bgp-communities"];
    const names = set.large.map((entry) => entry.name);

    expect(set["autonomous-system-id"]).toBe(64500);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
        "learned-from-group-1",
        "learned-from-group-2",
        "learned-at-site-1",
        "learned-at-site-any",
        "do-not-announce-to-as-0",
        "do-not-announce-to-as-any",
        "prepend-once-any",
        "prepend-twice-any",
        "blackhole-0",
    ]);

    expect(set.large[5]).toEqual({
        name: "do-not-announce-to-as-any",
        category: "action",
        description: "Do not announce to",
        "global-admin": 64500,
        "local-data-part-1": { field: [{ name: "Function", pattern: "3" }] },
        "local-data-part-2": { field: [{ name: "ASN", pattern: ".*", description: "*" }] },
    });
    expect(set.large[0]?.category).toBe("informational");
    expect(JSON.parse(Communities.text(network, "json"))).toEqual(json);
});
