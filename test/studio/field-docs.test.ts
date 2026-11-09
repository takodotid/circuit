// Each device field's doc, read from src/config/ when Studio's page is built, and found by its path in a device.

import { describe, expect, test } from "bun:test";
import { FieldDocs } from "../../src/studio/app/src/lib/field-docs";
import { FieldDocsReader } from "../../src/studio/field-docs";

describe("field docs", () => {
    const read = FieldDocsReader.read();
    const packed = FieldDocsReader.pack(read);

    test("every field of a device, by path, with its doc comment", () => {
        expect(read["name"]).toStartWith("Its hostname");
        expect(read["routing.bgp.neighbors.*.remote_as"]).toStartWith("The neighbor's AS.");
        expect(read["firewall.filter.input.default_action"]).toBe("What happens to a packet no rule matched. Accept when absent.");
        // A route policy is a map of lists: a star for the name, one for the rule.
        expect(read["routing.policies.*.*.then"]).toContain("accepted or rejected");
    });

    test("a field found by its path in a device, names and items in it", () => {
        expect(FieldDocs.find("switching.vlans.servers.id", packed)).toBe(read["switching.vlans.*.id"]);
        expect(FieldDocs.find("routing.policies.transit-import.0.then", packed)).toBe(read["routing.policies.*.*.then"]);
        expect(FieldDocs.find("interfaces.ethernet.*.link.through", packed)).toBe(read["interfaces.ethernet.*.link.through"]);
        expect(FieldDocs.find("routing.nothing", packed)).toBeUndefined();
        // A list's item has no doc of its own.
        expect(FieldDocs.find("routing.policies.transit-import", packed)).toBeUndefined();
    });

    test("each doc once, and a secret's own fields left out", () => {
        expect(new Set(packed.docs).size).toBe(packed.docs.length);
        expect(FieldDocs.find("system.users.operator.password.secret", packed)).toBeUndefined();
        expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(read).length / 1.5);
    });
});
