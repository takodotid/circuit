// Prints the names Upstreams.define built in Circuit 0.40 from `names` patterns, written out for each upstream, to paste into a 0.41 catalog. Run it in the project while it still has Circuit 0.40 installed:
//
//   bun path/to/circuit/scripts/upstream-names.ts upstreams-0.40.ts
//
// The file exports `catalog` and `names`, as passed to `Upstreams.define(catalog, { names })` in 0.40. Each upstream gets its VLAN and native as `{ name, id }`, its interface, its import and export names, and its group, where it had one. When the file also exports `policies`, the options 0.40's `policies(...)` took, each import and export gets the rules 0.40 built, so the device sees the same policy; otherwise `rules: []` is left to fill.

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Built = {
    vlans(device?: string): Record<string, { id: number }>;
    interfaces(): Record<string, unknown>;
    policies(options?: object): Record<string, unknown>;
    groups(): Record<string, unknown>;
};

type Upstream = {
    handoff?: { vlan: number; native?: number; port?: { device: string } };
    tunnel?: object;
    import?: object;
};

class UpstreamNames {
    static async main(file: string | undefined): Promise<void> {
        if (!file) throw new Error("usage: bun scripts/upstream-names.ts <file exporting catalog and names>");

        const helpers = createRequire(join(process.cwd(), "package.json")).resolve("@takodotid/circuit/helpers");
        const { Upstreams } = (await import(pathToFileURL(helpers).href)) as {
            Upstreams: { define(catalog: object, options: object): Built };
        };
        const { catalog, names, policies } = (await import(pathToFileURL(resolve(file)).href)) as {
            catalog: Record<string, Upstream>;
            names: object;
            policies?: object;
        };

        for (const [key, upstream] of Object.entries(catalog)) {
            const built = Upstreams.define({ [key]: upstream }, { names });
            console.log(UpstreamNames.written(key, upstream, built, policies));
        }
    }

    /** One upstream's names, as the fields a 0.41 catalog writes them in. */
    private static written(key: string, upstream: Upstream, built: Built, options: object | undefined): string {
        const lines = [`${key}: {`];
        const [interfaceName] = Object.keys(built.interfaces());
        const handoff = upstream.handoff;

        if (handoff) {
            const [vlan] = Object.keys(built.vlans());
            const native =
                handoff.native !== undefined && handoff.port
                    ? Object.keys(built.vlans(handoff.port.device)).find((name) => name !== vlan)
                    : undefined;
            lines.push(`    handoff: {`);
            lines.push(`        vlan: { name: ${JSON.stringify(vlan)}, id: ${handoff.vlan} },`);
            if (native) lines.push(`        native: { name: ${JSON.stringify(native)}, id: ${handoff.native} },`);
            lines.push(`        interface: ${JSON.stringify(interfaceName)},`);
            lines.push(`    },`);
        } else if (upstream.tunnel) {
            lines.push(`    tunnel: { interface: ${JSON.stringify(interfaceName)} },`);
        }

        // 0.40 wrote the export first, then the import when there was one.
        const policies = built.policies(options);
        const rules = (name: string) => (options ? JSON.stringify(policies[name]) : "[]");
        const [exported, imported] = Object.keys(policies);
        if (upstream.import && imported) lines.push(`    import: { name: ${JSON.stringify(imported)}, rules: ${rules(imported)} },`);
        lines.push(`    export: { name: ${JSON.stringify(exported)}, rules: ${rules(exported!)} },`);

        const [group] = Object.keys(built.groups());
        if (group) lines.push(`    group: ${JSON.stringify(group)},`);

        lines.push("},");
        return lines.join("\n");
    }
}

await UpstreamNames.main(process.argv[2]);
