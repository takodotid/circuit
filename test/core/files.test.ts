// A device's file is the one whose defineDevice gives it its name: another device that file names, in a link, a session or a tunnel, does not make it that device's file.

import { expect, test } from "bun:test";
import { declaresDevice } from "../../src/core/files";

const edgeA2 = `import { defineDevice } from "@takodotid/circuit";

export default defineDevice({
    name: "edge-a2",
    platform: "routeros",
    ports: { "25g-12": { link: { device: "edge-b1", port: "25g-12" } } },
    interfaces: { "wg-b1": { type: "wireguard", peers: [{ name: "edge-b1" }] } },
});
`;

test("a device's file declares it, and not the devices it names further on", () => {
    expect(declaresDevice(edgeA2, "edge-a2")).toBe(true);
    expect(declaresDevice(edgeA2, "edge-b1")).toBe(false);
});

test("a file without a call to defineDevice declares no device, even when it names one", () => {
    expect(declaresDevice(`export const peer = { name: "edge-a2" };\n`, "edge-a2")).toBe(false);
    expect(
        declaresDevice(`import { defineDevice } from "@takodotid/circuit";\nexport const peer = { name: "edge-a2" };\n`, "edge-a2")
    ).toBe(false);
});

test("a name built from parts is not a name written out", () => {
    expect(declaresDevice('defineDevice({ name: `edge-${site}`, platform: "routeros" });\n', "edge-a2")).toBe(false);
});
