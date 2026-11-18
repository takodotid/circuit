// A Studio bookmark from before Studio had paths, such as `/#devices/edge-01`, opens the same page at its path.

import { describe, expect, test } from "bun:test";
import { OldAddress } from "../../src/studio/app/src/lib/old-address";

describe("an address after #", () => {
    test("becomes the page's path", () => {
        expect(OldAddress.path("#devices")).toBe("/devices");
        expect(OldAddress.path("#devices/edge-01")).toBe("/devices/edge-01");
        expect(OldAddress.path("#devices/edge-01/ports")).toBe("/devices/edge-01/ports");
        expect(OldAddress.path("#secrets")).toBe("/secrets");
        expect(OldAddress.path("#tools/trace/192.0.2.5")).toBe("/tools/trace/192.0.2.5");
        expect(OldAddress.path("#compare/main")).toBe("/compare/main");
    });

    test("opens the graph, and a layer named alone opens that layer", () => {
        expect(OldAddress.path("#graph")).toBe("/");
        expect(OldAddress.path("#graph/l2")).toBe("/graph/l2");
        expect(OldAddress.path("#bgp")).toBe("/graph/bgp");
    });

    test("opens a device named the old way", () => {
        expect(OldAddress.path("#device/edge-01")).toBe("/devices/edge-01");
    });

    test("keeps a tool's form and a search in the query", () => {
        expect(OldAddress.path("#tools/firewall/device=edge-01&chain=input&dst_port=22")).toBe(
            "/tools/firewall?device=edge-01&chain=input&dst_port=22"
        );
        expect(OldAddress.path("#tools/policy/device=edge-01&prefix=198.51.100.0%2F24")).toBe(
            "/tools/policy?device=edge-01&prefix=198.51.100.0%2F24"
        );
        expect(OldAddress.path("#tools/vlan")).toBe("/tools/vlan");
        expect(OldAddress.path("#search/edge%2001")).toBe("/search?q=edge+01");
    });

    test("is nothing when there is none", () => {
        expect(OldAddress.path("")).toBeUndefined();
        expect(OldAddress.path("#")).toBeUndefined();
    });
});
