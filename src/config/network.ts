// The whole network, what `circuit()` in `circuit.ts` at a project's root takes: `asn`, `prefixes`, `communities`, `sites`, `checks`, `integrations`. Its devices register with it.

import type { Prefix, Secret } from "./common";
import type { CommunityRequest, CommunityScheme, SchemeCheck } from "./communities";
import type { AnyDevice } from "./device";
import type { RouteRule } from "./routing";

/**
 * The network's own prefixes, in groups of your choosing, such as a location (`id01`), each a map of named prefixes:
 * `{ region_a: { v4_1: "192.0.2.0/24", v6_1: "2001:db8::/48" } }`.
 */
export type Prefixes = Readonly<Record<string, Readonly<Record<string, Prefix>>>>;

/**
 * One BGP community the network defines, in the community description format of the NLNOG Ring looking glass, which bgp.tools also reads.
 */
export type Community = {
    /** The community. `nnn` stands for any number, `x` for one digit and `a-b` for a range, such as `65535:0:nnn`. */
    community: string;
    /** What it means. `$0`, `$1` and so on stand for what each wildcard matched, such as `do not announce to AS$0`. */
    description: string;
};

/** A site: a data centre or an office. */
export type Site = {
    /** What and where the site is. */
    description?: string;
    /**
     * The site's number, the last part of the community `learned_at_site` tags a route with, such as `64500:2:0`. Only Circuit reads
     * it: the resolved network leaves it out.
     */
    number?: number;
};

/** Circuit's built-in checks, by name. A check is on when it is here. `D` is the network's device names: `circuit validate` checks each is a device of the network. */
export type Checks<D extends string> = {
    /**
     * Where traffic from outside, before anything filters it, may go. The untrusted VLANs are those written `untrusted: true` in
     * `switching.vlans`; every other VLAN is trusted, so a VLAN added later is protected without being listed. `untrusted: true` is
     * allowed only while this check is on.
     */
    untrusted_vlans?: {
        /** The devices that filter: the only ones that may give an untrusted VLAN an address, and the only ones a port carrying both kinds may face. */
        filtering_devices: readonly D[];
        /** Links between two switches that may carry both kinds, each named by its two devices: a site's switch extended to another building, with an exchange's VLAN and its own management on one cable. Neither end gives an untrusted VLAN an address. */
        mixed_links?: readonly (readonly [D, D])[];
    };
    /** Every BGP export ends in a reject that matches everything, so nothing leaves by accident. An export to a neighbor whose `role` is `customer` is left out. */
    exports_end_in_reject?: true;
    /** Every BGP import ends in a rule that decides for every route, an accept or a reject without a match. */
    imports_end_in_accept_or_reject?: true;
    /** A native VLAN is a dead end: native on one trunk (a port or a LAG) of a device at most, and never an access VLAN or a tagged VLAN anywhere on that device. */
    native_vlans_are_dead_ends?: true;
    /** A GRE or VXLAN tunnel's local address is outside what the neighbors over it are offered, or their replies route back into the tunnel. */
    tunnels_outside_offered?: true;
    /**
     * One VLAN name has one ID on every device of the network. Circuit runs it when it reads the project, and `circuit validate` stops on a VLAN
     * with two IDs, naming both devices and where each is written. So the resolved network always passes it, and leaves it out.
     */
    same_vlan_ids?: true;
};

/**
 * What one of your own checks found: a sentence, and the device and path it is about, when it knows them. Circuit prints it with the
 * file and line that write that path, as for its own errors: `sites/site-a/switch-01.ts:21: tenants_dont_clash: switch-01: interfaces.ethernet.10g-2: ...`.
 */
export type Finding = {
    /** What is wrong, in a sentence. */
    message: string;
    /** The device it is about, by name. */
    device?: string;
    /** Where in that device, dot by dot, as Circuit names a field: `interfaces.ethernet.10g-2`, `routing.policies.transit-a-export[2]`. */
    path?: string;
};

/**
 * A device as your own checks read it: as it will run. Each BGP neighbor holds what it takes from its group. Each policy is route rules
 * only: a `call` is the called policy's rules, and a `{ communities }` rule the rules it means there. `management.allow` written as an
 * address set's name is that set's addresses, and a rule's interface set is its interfaces. A copy: a check changes nothing.
 */
export type ResolvedDevice = Omit<AnyDevice, "routing" | "management"> & {
    readonly routing?: Omit<NonNullable<AnyDevice["routing"]>, "policies"> & {
        readonly policies?: Readonly<Record<string, readonly RouteRule<string>[]>>;
    };
    readonly management?: Omit<NonNullable<AnyDevice["management"]>, "allow"> & { readonly allow?: readonly Prefix[] };
};

/** The network as your own checks read it: its AS, its prefixes, and each device as it will run, its parts merged in. */
export type ResolvedNetwork = { readonly asn?: number; readonly prefixes: Prefixes; readonly devices: readonly ResolvedDevice[] };

/**
 * A check of your own, beside Circuit's: it reads the network resolved, as its devices will run it, and returns what is wrong. Nothing
 * found is an empty list. `circuit validate` runs it; the resolved network never shows it.
 */
export type Check = (network: ResolvedNetwork) => readonly Finding[];

/** Where a network's secrets are: a file of `NAME="value"` lines, each value encrypted, changed with `circuit secrets`. */
export type NetworkSecrets = {
    /** The file, relative to the project, such as `.circuit/lab-secrets` for a lab network with its own password. Commit it. */
    file: string;
};

/** Systems Circuit keeps in step with the config, each with `circuit sync <target>`. */
export type Integrations = {
    /** Keeps the network's exchange presence at PeeringDB in step with the config: `circuit sync peeringdb`. Needs `asn`. */
    peeringdb?: {
        /** An API key with write access to the network's record. */
        api_key: Secret;
    };
    /** Keeps LibreNMS monitoring every device, under its name, with its SNMP credentials and location, and in a group for its site: `circuit sync librenms`. */
    librenms?: {
        /** Where LibreNMS is, such as `https://librenms.example.com`. */
        url: `http://${string}` | `https://${string}`;
        /** An API token that can add and change devices and device groups. */
        api_token: Secret;
    };
    /** Keeps NetBox in step with the config: `circuit sync netbox`. Each device's `site` and `role` place it there, so every device needs a `role`. */
    netbox?: {
        /** Where NetBox is, such as `https://netbox.example.com`. */
        url: `http://${string}` | `https://${string}`;
        /** An API token that can write. */
        api_token: Secret;
    };
    /** Writes the files Prometheus and snmp_exporter read, in the project: `circuit sync prometheus`. Commit them, and deploy them as you deploy anything else. */
    prometheus?: {
        /** The targets file for Prometheus's `file_sd_configs`, relative to the project, such as `monitoring/targets.json`. One entry per device with SNMP. */
        targets: string;
        /** The `auths` file for snmp_exporter, relative to the project, such as `monitoring/snmp-auths.yml`. Each password is written `${NAME}`, the name of its secret, never its value. None when absent. */
        auths?: string;
    };
};

/**
 * What a device takes from its network, for the editor: whether `untrusted_vlans` is on, whether the network writes `communities`, and
 * the scheme's groups and requests.
 */
export type NetworkFacts = { untrusted: boolean; communities: boolean; groups: string; requests: string };

/** Any network's facts: what a part, or a device seen from the network, takes. */
export type AnyFacts = { untrusted: true; communities: true; groups: string; requests: CommunityRequest };

/** Whether a site has a number, which `learned_at_site` needs. */
export type Numbered<Sites> = true extends (
    Sites[keyof Sites] extends infer X ? (X extends { readonly number: number } ? true : false) : never
)
    ? true
    : false;

/**
 * What `circuit()` takes: the whole network but its devices, which register with it from their own files. `Sites` is its sites as
 * written. `Own` is the `checks` as written: a key that is not one of Circuit's is a check of your own. `C` is the `communities` as
 * written. `P` is the `prefixes` as written.
 */
export type NetworkSettings<
    Sites extends Readonly<Record<string, Site>>,
    Asn extends number,
    Own = {},
    C = undefined,
    P extends Prefixes = {},
> = {
    /** The AS the network operates. A device's BGP runs it, unless the device writes `routing.bgp.asn`. */
    asn?: Asn;
    /**
     * The network's own prefixes, in groups of your choosing, each a map of named prefixes: `{ region_a: { v4_1: "192.0.2.0/24" } }`.
     * Devices use them by name, `as64500.prefixes.id01.v4_1`, and your own checks read them. The resolved network keeps them, for the
     * commands that would use them: PeeringDB's prefix counts, and RPKI and IRR checks.
     */
    prefixes?: P;
    /**
     * The network's BGP large communities, `asn:code:value` (RFC 8092), used as RFC 8195 describes. Written once here: a neighbor group
     * says which `groups` it is in, and a policy places `{ communities: "import" }` or `{ communities: "export" }`. Circuit writes the
     * catalogue from it, for a looking glass or bgp.tools.
     */
    communities?: C & CommunityScheme & SchemeCheck<C, Numbered<Sites>>;
    /** Each site, by name: a data centre or an office. The NetBox site and LibreNMS group of that name. A device's `site` is one of these, and each has a device. */
    sites: Sites;
    /**
     * Circuit's built-in checks, turned on by name, with their settings, and your own: any other name takes a function that reads the
     * network and returns what it found (`Check`). `circuit validate` runs them all. `untrusted: true` on a VLAN is allowed only while
     * `untrusted_vlans` is here.
     */
    checks?: Own & Checks<string> & { [K in Exclude<keyof Own, keyof Checks<string>>]: Check };
    /** Systems Circuit keeps in step with the config. */
    integrations?: Integrations;
    /** Where the network's secrets are. `.circuit/secrets` when absent. */
    secrets?: NetworkSecrets;
};
