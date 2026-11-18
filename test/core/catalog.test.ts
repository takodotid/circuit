import { expect, test } from "bun:test";
import { Catalog } from "../../src/core/catalog";

test("a virtual model takes any adapter by its form, and a fixed model only the ports it has", () => {
    const chr = ["virtual-1", "virtual-64", "virtual-0", "virtual-01", "1g-1", "virtual"];
    expect(chr.map((port) => Catalog.isPort("routeros", "CHR", port))).toEqual([true, true, false, false, false, false]);
    expect(Catalog.spell("routeros", "CHR", "virtual-4")).toBe("ether4");
    expect(Catalog.ports("routeros", "CHR")).toEqual([]);
    expect(["1g-1", "1g-2"].map((port) => Catalog.isPort("routeros", "CCR2216-1G-12XS-2XQ", port))).toEqual([true, false]);
});
