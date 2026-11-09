// `circuit communities`: what each community of a network's scheme means, for a looking glass or bgp.tools to show. The catalogue is
// written by `catalogue()` in `src/config/communities.ts`, in NLNOG's notation: `nnn` for any number, `$0` for what it matched. Each
// format here is a published one:
//
// - `nlnog`: `community,description`, one per line, as the NLNOG Looking Glass reads its `communities/asNNN.txt` and bgp.tools takes it.
// - `alice`: the `[bgp_communities]` section of Alice-LG's config, `community = description`, `*` for any number and `$N` for part N.
// - `json`: draft-ietf-grow-yang-bgp-communities (version 10), the YANG model's JSON, which the NLNOG Looking Glass also reads.

import type { Community } from "../config/network";

/** A network as the command needs it: its name, its catalogue, and its scheme as written. */
export type CommunitiesNetwork = {
    name: string;
    asn?: number;
    communities: readonly Community[];
    settings: { asn?: number; communities?: { asn?: number; [option: string]: unknown } };
};

/** The formats `--format` takes. */
export const COMMUNITY_FORMATS = ["nlnog", "alice", "json"] as const;
export type CommunityFormat = (typeof COMMUNITY_FORMATS)[number];

/** The scheme's tags: they only tell where a route was learned. Every other option asks for something. */
const TAGS = ["learned_from_group", "learned_at_site", "learned_from_as"];

export class Communities {
    /** The network's catalogue in `format`, ending with a newline. */
    static text(network: CommunitiesNetwork, format: CommunityFormat): string {
        const asn = network.settings.communities?.asn ?? network.asn;
        if (format === "alice") return Communities.alice(network.communities);
        if (format === "json") return `${JSON.stringify(Communities.json(network, asn), null, 2)}\n`;
        return Communities.nlnog(network.communities, asn);
    }

    /** NLNOG's file: a first line that says where it comes from, then one community per line. */
    static nlnog(communities: readonly Community[], asn: number | undefined): string {
        const source = `# AS${asn ?? "?"} communities written by Circuit from the network's scheme`;
        return `${[source, ...communities.map((c) => `${c.community},${c.description}`)].join("\n")}\n`;
    }

    /** Alice-LG's section: `nnn` is `*`, and `$0`, the first wildcard's value, is `$N`, N being the part it is in. */
    static alice(communities: readonly Community[]): string {
        const lines = communities.map(({ community, description }) => {
            const parts = community.split(":");
            const wild = parts.flatMap((part, index) => (part === "nnn" ? [index] : []));
            const text = description.replace(/\$(\d+)/g, (written, n: string) => {
                const part = wild[Number(n)];
                return part === undefined ? written : `$${part}`;
            });
            return `${parts.map((part) => (part === "nnn" ? "*" : part)).join(":")} = ${text}`;
        });
        return `${["[bgp_communities]", ...lines].join("\n")}\n`;
    }

    /** The draft's JSON: each large community with its two local data parts, `.*` and `*` for any number. */
    static json(network: CommunitiesNetwork, asn: number | undefined) {
        const options = Communities.options(network.settings.communities ?? {});

        const large = network.communities.flatMap(({ community, description }) => {
            const [global, function_, value] = community.split(":");
            if (global === undefined || function_ === undefined || value === undefined) return [];

            const option = options.get(Number(function_)) ?? "community";
            const any = value === "nnn";
            const what = /AS\$0/.test(description) ? "ASN" : "Value";
            return [
                {
                    name: `${option.replaceAll("_", "-")}-${any ? "any" : value}`,
                    category: TAGS.includes(option) ? "informational" : "action",

                    description: any ? description.replace(/\s*(AS)?\$0/, "").trim() : description,
                    "global-admin": Number(global),
                    "local-data-part-1": { field: [{ name: "Function", pattern: function_ }] },
                    "local-data-part-2": { field: [{ name: what, pattern: any ? ".*" : value, ...(any ? { description: "*" } : {}) }] },
                },
            ];
        });

        return {
            "ietf-bgp-communities:bgp-communities": {
                ...(asn !== undefined ? { "autonomous-system-id": asn } : {}),
                description: `The BGP communities of ${network.name}${asn !== undefined ? `, AS${asn}` : ""}`,
                large,
            },
        };
    }

    /** Each code of the scheme and its option, a prepend's as `prepend_once` and so on. */
    private static options(scheme: Record<string, unknown>): Map<number, string> {
        const codeOf = (value: unknown) =>
            typeof value === "object" && value !== null && "code" in value && typeof value.code === "number" ? value.code : undefined;

        const options = new Map<number, string>();
        for (const [key, value] of Object.entries(scheme)) {
            const code = codeOf(value);
            if (code !== undefined) options.set(code, key);
            if (key !== "prepend" || typeof value !== "object" || value === null) continue;

            for (const [times, option] of Object.entries(value)) {
                const prepend = codeOf(option);
                if (prepend !== undefined) options.set(prepend, `prepend_${times}`);
            }
        }
        return options;
    }
}
