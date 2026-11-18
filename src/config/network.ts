// The whole network, what `circuit()` in `circuit.ts` at a project's root takes: `asn`, `prefixes`, `communities`, `sites`, `checks`, `integrations`. Its devices register with it.

import type { Prefix, Secret } from "./common";
import type { CommunityRequest, CommunityScheme, SchemeCheck } from "./communities";
import type { AnyDevice } from "./device";
import type { RouteRule } from "./routing";

/**
 * The network's own prefixes, in groups you choose, such as by region. Each group is a map of named prefixes: `{ region_a: { v4_1: "192.0.2.0/24", v6_1: "2001:db8::/48" } }`.
 */
export type Prefixes = Readonly<Record<string, Readonly<Record<string, Prefix>>>>;

/**
 * One BGP community the network defines, in the format the NLNOG Ring looking glass uses to describe communities. bgp.tools reads it too.
 */
export type Community = {
    /** The community. `nnn` stands for any number, `x` for one digit and `a-b` for a range, such as `65535:0:nnn`. */
    community: string;
    /** What it means. `$0`, `$1` and so on stand for what each wildcard matched, such as `do not announce to AS$0`. */
    description: string;
};

/** A site, such as a data center or an office. */
export type Site = {
    /** What and where the site is. */
    description?: string;
    /**
     * The site's number, for `communities.learned_at_site`. It is the last part of the community that tags routes learned at this site, such as `64500:2:0`.
     */
    number?: number;
};

/** Circuit's built-in checks, by name. A check is on when you write it here. `D` is the network's device names, and `circuit validate` checks that each is a device of the network. */
export type Checks<D extends string> = {
    /**
     * Checks where traffic from outside may go before anything filters it. The untrusted VLANs are the ones with `untrusted: true` in `switching.vlans`. Every other VLAN is trusted, so a VLAN you add later is protected without being listed. `untrusted: true` is allowed only while this check is on.
     */
    untrusted_vlans?: {
        /** The devices that filter. Only they may give an untrusted VLAN an address, and only they may be at the other end of a port that carries both trusted and untrusted VLANs. */
        filtering_devices: readonly D[];
        /** Links between two switches that may carry both trusted and untrusted VLANs, each given by its two devices. For example, a site's switch extended to another building, with an exchange's VLAN and the site's management on one cable. Neither end may give an untrusted VLAN an address. */
        mixed_links?: readonly (readonly [D, D])[];
    };
    /** Every BGP export policy ends in a rule that rejects everything, so nothing leaves by accident. Exports to neighbors whose `role` is `customer` are not checked. */
    exports_end_in_reject?: true;
    /** Every BGP import policy ends in a rule that decides for every route: an accept or a reject with no `if`. */
    imports_end_in_accept_or_reject?: true;
    /** A native VLAN is a dead end. It is native on at most one trunk (a port or a LAG) of a device, and is never an access VLAN or a tagged VLAN anywhere on that device. */
    native_vlans_are_dead_ends?: true;
    /** A GRE or VXLAN tunnel's local address is outside the routes announced to the neighbors over that tunnel. Otherwise their replies would route back into the tunnel. */
    tunnels_outside_offered?: true;
    /**
     * One VLAN name has the same ID on every device of the network. Circuit runs this check when it reads the project. A VLAN name with two IDs stops it, and the error shows each device and where each ID is written.
     */
    same_vlan_ids?: true;
};

/**
 * What one of your own checks found: a sentence, plus the device and path it is about, if the check knows them. Circuit prints it with the file and line that write that path, as it does for its own errors: `sites/site-a/switch-01.ts:21: tenants_dont_clash: switch-01: interfaces.ethernet.10g-2: ...`.
 */
export type Finding = {
    /** What is wrong, in a sentence. */
    message: string;
    /** The device it is about, by name. */
    device?: string;
    /** Where in that device, as a path of field names, such as `interfaces.ethernet.10g-2` or `routing.policies.transit-a-export[2]`. */
    path?: string;
};

/**
 * A device as your own checks read it, as it will run:
 *
 * - Each BGP neighbor holds the settings it takes from its group.
 * - Each policy holds route rules only. A `call` becomes the called policy's rules, and a `{ communities }` rule becomes the rules it stands for.
 * - `management.allow` written as an address set's name becomes that set's addresses, and a rule's interface set becomes its interfaces.
 *
 * It is a copy, so a check can't change the device.
 */
export type ResolvedDevice = Omit<AnyDevice, "routing" | "management"> & {
    readonly routing?: Omit<NonNullable<AnyDevice["routing"]>, "policies"> & {
        readonly policies?: Readonly<Record<string, readonly RouteRule<string>[]>>;
    };
    readonly management?: Omit<NonNullable<AnyDevice["management"]>, "allow"> & { readonly allow?: readonly Prefix[] };
};

/** The network as your own checks read it: its AS, its prefixes, and each device as it will run, with its parts merged in. */
export type ResolvedNetwork = { readonly asn?: number; readonly prefixes: Prefixes; readonly devices: readonly ResolvedDevice[] };

/**
 * A check of your own, beside Circuit's. It reads the network as its devices will run it, and returns what is wrong, or an empty list. `circuit validate` runs it.
 */
export type Check = (network: ResolvedNetwork) => readonly Finding[];

/** Where a network's secrets are: a file of `NAME="value"` lines, each value encrypted. Change it with `circuit secrets`. */
export type NetworkSecrets = {
    /** The file, relative to the project, such as `.circuit/lab-secrets` for a lab network with its own password. Commit it. */
    file: string;
};

/** Systems Circuit keeps in sync with the config, each with `circuit sync <target>`. */
export type Integrations = {
    /** `circuit sync peeringdb` keeps the network's exchange connections at PeeringDB in sync with the config. Needs `asn`. */
    peeringdb?: {
        /** An API key with write access to the network's record. */
        api_key: Secret;
    };
    /** `circuit sync librenms` makes LibreNMS monitor every device, under its name, with its SNMP credentials and location, in a group for its site. */
    librenms?: {
        /** Where LibreNMS is, such as `https://librenms.example.com`. */
        url: `http://${string}` | `https://${string}`;
        /** An API token that can add and change devices and device groups. */
        api_token: Secret;
    };
    /** `circuit sync netbox` keeps NetBox in sync with the config. NetBox places each device by its `site` and `role`, so every device needs a `role`. */
    netbox?: {
        /** Where NetBox is, such as `https://netbox.example.com`. */
        url: `http://${string}` | `https://${string}`;
        /** An API token that can write. */
        api_token: Secret;
    };
    /** `circuit sync prometheus` writes the files that Prometheus and snmp_exporter read, into the project. Commit them, and deploy them as you deploy anything else. */
    prometheus?: {
        /** The targets file for Prometheus's `file_sd_configs`, relative to the project, such as `monitoring/targets.json`. One entry per device with SNMP. */
        targets: string;
        /** The `auths` file for snmp_exporter, relative to the project, such as `monitoring/snmp-auths.yml`. Each password is written as `${NAME}`, the name of its secret, never its value. Not written when absent. */
        auths?: string;
    };
};

/**
 * What a device takes from its network, for the editor: whether `untrusted_vlans` is on, whether the network writes `communities`, and the scheme's groups and requests.
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
 * What `circuit()` takes: the whole network except its devices, which register with it from their own files. `Sites` is its sites as written. `Own` is the `checks` as written: a key that is not one of Circuit's is a check of your own. `C` is the `communities` as written. `P` is the `prefixes` as written.
 */
export type NetworkSettings<
    Sites extends Readonly<Record<string, Site>>,
    Asn extends number,
    Own = {},
    C = undefined,
    P extends Prefixes = {},
> = {
    /** The network's AS number. A device's BGP uses it, unless the device writes `routing.bgp.asn`. */
    asn?: Asn;
    /**
     * The network's own prefixes, in groups you choose. Each group is a map of named prefixes: `{ region_a: { v4_1: "192.0.2.0/24" } }`. Devices use them by name, such as `as64500.prefixes.region_a.v4_1`, and your own checks can read them.
     */
    prefixes?: P;
    /**
     * The network's BGP large communities, `asn:code:value` (RFC 8092), used as RFC 8195 describes. Write them once, here. A neighbor group says which `groups` it is in, and a policy uses them with a `{ communities: "import" }` or `{ communities: "export" }` rule. `circuit communities` prints what each one means, for a looking glass or bgp.tools.
     */
    communities?: C & CommunityScheme & SchemeCheck<C, Numbered<Sites>>;
    /** Each site, by name, such as a data center or an office. Each is also a site in NetBox and a group in LibreNMS. A device's `site` is one of these, and each site needs at least one device. */
    sites: Sites;
    /**
     * Circuit's built-in checks, turned on by name with their settings, and your own checks. Any other name takes a function that reads the network and returns what it found (`Check`). `circuit validate` runs them all. `untrusted: true` on a VLAN is allowed only while `untrusted_vlans` is here.
     */
    checks?: Own & Checks<string> & { [K in Exclude<keyof Own, keyof Checks<string>>]: Check };
    /** Systems Circuit keeps in sync with the config. */
    integrations?: Integrations;
    /** Where the network's secrets are. `.circuit/secrets` when absent. */
    secrets?: NetworkSecrets;
};
