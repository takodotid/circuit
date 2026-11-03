// What a project's files call, as globals: `circuit`, `part`, `literal`, `merge`, `secret`, `secretFile`, `bgpNeighbors`. A network's `device()`.

import type { IP, Secret } from "./common";
import type { AnyDevice, AnyPort, Device, DevicePart, Names, Part } from "./device";
import type { FilterRule, NatRule } from "./firewall";
import type { Port } from "./interfaces";
import type { Model, Platform, PortName } from "./models";
import type { CommunitiesExport, CommunitiesImport, GroupsOf, RequestsOf } from "./communities";
import type { NetworkFacts, NetworkSettings, Prefixes, Site } from "./network";
import { ACL_RULE, ACTIONS, closest, FILTER_RULE, NAT_RULE, ROUTING_RULE, type Shape, unknownKeyHelp, unknownKeys } from "./keys";
import { type Before, type Clash, caller, innerCaller, made, mark, type Merged, mergeAll, resolve, ruleList, writtenAt } from "./merge";
import { type CallRule, type PolicyRule, policyRuleProblem, type RouteRule, type RoutingRule } from "./routing";
import type { AclRule } from "./switching";

/** A secret by name, read when a device is applied from the network's secrets file or the environment, and through 1Password when that value is an `op://` reference. Never the value itself. */
export const secret = (name: string): Secret => ({ secret: name });

/** A value read from a file when a device is applied, such as a private key in PEM. The path is from the project root; keep the file out of git. */
export const secretFile = (path: string): Secret => ({ secret_file: path });

/** One network `circuit()` made, the line that made it, and each device registered with it: the device, the line that made it, and the file Circuit was reading. */
export type Registered = { network: object; at: string; devices: { device: AnyDevice; at: string; file: string }[] };

/**
 * What Circuit checks once it has read every device: each network and its devices, that each source's hostnames are devices of the
 * network, and that each rule list `part` made is placed. `reading` is the file under `sites/` Circuit is importing.
 */
export const registry = {
    networks: [] as Registered[],
    sources: [] as { source: object; device: string; file: string; network: object }[],
    rules: [] as { rules: readonly object[]; file: string }[],
    reading: "",
};

/** Ports by name. A name the model does not have is an error that says so. */
type CheckedPorts<Ports extends string, ModelPorts extends string, M extends string, P> = {
    [K in Ports]?: K extends ModelPorts ? P : `${K} is not a port of ${M}`;
};

/** The names a device declares, by kind, from what `device()` finds in it. */
type Declared<
    Pt extends string,
    L extends string,
    VI extends string,
    I extends string,
    V extends string,
    A extends string,
    P extends string,
    S extends string,
    G extends string,
    T extends string,
    F extends string,
    AS extends string,
    IS extends string,
    U extends string,
    C extends string,
> = {
    port: Pt;
    lag: L;
    vlanInterface: VI;
    interface: I;
    vlan: V;
    acl: A;
    policy: P;
    prefixSet: S;
    neighborGroup: G;
    table: T;
    vrf: F;
    addressSet: AS;
    interfaceSet: IS;
    user: U;
    certificate: C;
    anyInterface: Pt | L | VI | I;
};

/** The keys of the map at `D[G][K]`, such as the VLANs at `switching.vlans`. */
type KeysAt<D, G extends string, K extends string> = D extends { readonly [g in G]?: infer Group }
    ? K extends keyof NonNullable<Group>
        ? keyof NonNullable<NonNullable<Group>[K]> & string
        : never
    : never;

/** The names a device declares, by kind: the keys of its maps, from the device and every part merged. */
type NamesOf<D> = {
    port: KeysAt<D, "interfaces", "ethernet">;
    lag: KeysAt<D, "interfaces", "lag">;
    vlanInterface: KeysAt<D, "interfaces", "vlan_interface">;
    interface: KeysAt<D, "interfaces", "bridge" | "loopback" | "gre" | "vxlan" | "wireguard">;
    vlan: KeysAt<D, "switching", "vlans">;
    acl: KeysAt<D, "switching", "acls">;
    policy: KeysAt<D, "routing", "policies">;
    prefixSet: KeysAt<D, "routing", "prefix_sets">;
    neighborGroup: D extends { readonly routing?: { readonly bgp?: { readonly neighbor_groups?: infer G } } } ? keyof G & string : never;
    table: KeysAt<D, "routing", "tables">;
    vrf: KeysAt<D, "routing", "vrfs">;
    addressSet: KeysAt<D, "firewall", "address_sets">;
    interfaceSet: KeysAt<D, "firewall", "interface_sets">;
    user: KeysAt<D, "system", "users">;
    certificate: KeysAt<D, "system", "certificates">;
    anyInterface: KeysAt<D, "interfaces", "ethernet" | "lag" | "vlan_interface" | "bridge" | "loopback" | "gre" | "vxlan" | "wireguard">;
};

/** The ports a device declares, each checked against its model. */
type EthernetOf<P extends Platform, M extends Model<P>, N extends Names> = CheckedPorts<
    N["port"],
    PortName<P, M>,
    M,
    Port<NoInfer<N["vlan"]>, NoInfer<N["acl"]>, NoInfer<N["lag"]>, NoInfer<N["vrf"]>>
>;

/** The names the device itself declares, which `device()` infers, and those its parts declare. */
type All<Own extends Names, Parts extends readonly object[]> = {
    [K in keyof Names]: Own[K] | NamesOf<Merged<Parts>>[K];
};

/** The part a source gives the device `Name`: its entry under that hostname, or nothing. */
type PartOf<S, Name extends string> = S extends { readonly [K in Name]: infer P } ? P : {};

/** The part each source gives the device `Name`, in the order of the sources. */
type PartsOf<Sources extends readonly object[], Name extends string> = { [I in keyof Sources]: PartOf<Sources[I], Name> };

/**
 * Declare one device of this network, in its own file under `sites/`. Circuit finds the file and imports it; the call registers the
 * device with this network:
 *
 * ```ts
 * export default as64500.device({ name: "switch-02", site: "site-b", ... });
 * export default as64500.device({ name: "edge-01", include: [tenants.parts], site: "site-a", ... });
 * ```
 *
 * `site` is one of the network's `sites`, and the editor suggests them. `untrusted: true` on a VLAN is an error unless the network turns
 * on the check `untrusted_vlans`. A neighbor's `communities` and a policy's `{ communities }` rule are errors unless the network writes
 * `communities`, and take its groups and requests.
 *
 * `include` lists the device's sources, each an object keyed by hostname, each value a part, such as the tenants'. The device takes
 * from each the part under its own `name`, merged in after it as `merge` does: maps key by key, lists joined. A value two of them
 * write, or an ordered list from two places, is an error, in the editor where it can tell and always when Circuit reads the project.
 * So is a hostname in a source that is no device of the network.
 *
 * The names the device and its parts declare (VLANs, interfaces, sets, ACLs, policies and the rest) are the only names their fields
 * accept, and the editor suggests them. The port names come from the model.
 */
export type DeviceOf<Sites extends string, Net extends NetworkFacts> = <
    const Name extends string,
    const P extends Platform,
    const M extends Model<P>,
    const Sources extends readonly object[] = [],
    const Ports extends string = never,
    const Lags extends string = never,
    const VlanInterfaces extends string = never,
    const OtherInterfaces extends string = never,
    const Vlans extends string = never,
    const Acls extends string = never,
    const Policies extends string = never,
    const PrefixSets extends string = never,
    const NeighborGroups extends string = never,
    const Tables extends string = never,
    const Vrfs extends string = never,
    const AddressSets extends string = never,
    const InterfaceSets extends string = never,
    const Users extends string = never,
    const Certificates extends string = never,
>(
    // `site` is checked on its own: inside the device, a network of one site made a wrong site a second error at each port.
    device: {
        /** The site it is at, one of the network's `sites`. The NetBox site and LibreNMS group of that name. */
        site: Sites;
        /**
         * Where the device takes parts from, written right after `name`: `include: [tenants.parts]`. Each source is keyed by hostname; the
         * device takes the part under its own `name`, merged in after its own object, in this order.
         */
        include?: {
            [I in keyof Sources]: Sources[I] & {
                readonly [K in Name]?: Clash<PartOf<Sources[I], Name>, Before<PartsOf<Sources, Name>, I>> &
                    Part<
                        All<
                            Declared<
                                Ports,
                                Lags,
                                VlanInterfaces,
                                OtherInterfaces,
                                Vlans,
                                Acls,
                                Policies,
                                PrefixSets,
                                NeighborGroups,
                                Tables,
                                Vrfs,
                                AddressSets,
                                InterfaceSets,
                                Users,
                                Certificates
                            >,
                            PartsOf<Sources, Name>
                        >,
                        EthernetOf<
                            P,
                            M,
                            All<
                                Declared<
                                    Ports,
                                    Lags,
                                    VlanInterfaces,
                                    OtherInterfaces,
                                    Vlans,
                                    Acls,
                                    Policies,
                                    PrefixSets,
                                    NeighborGroups,
                                    Tables,
                                    Vrfs,
                                    AddressSets,
                                    InterfaceSets,
                                    Users,
                                    Certificates
                                >,
                                PartsOf<Sources, Name>
                            >
                        >,
                        Net
                    >;
            };
        };
    } & Device<
        P,
        M,
        string,
        All<
            Declared<
                Ports,
                Lags,
                VlanInterfaces,
                OtherInterfaces,
                Vlans,
                Acls,
                Policies,
                PrefixSets,
                NeighborGroups,
                Tables,
                Vrfs,
                AddressSets,
                InterfaceSets,
                Users,
                Certificates
            >,
            PartsOf<Sources, Name>
        >,
        EthernetOf<
            P,
            M,
            All<
                Declared<
                    Ports,
                    Lags,
                    VlanInterfaces,
                    OtherInterfaces,
                    Vlans,
                    Acls,
                    Policies,
                    PrefixSets,
                    NeighborGroups,
                    Tables,
                    Vrfs,
                    AddressSets,
                    InterfaceSets,
                    Users,
                    Certificates
                >,
                PartsOf<Sources, Name>
            >
        >,
        Name,
        Net
    >
) => Device<
    P,
    M,
    Sites,
    All<
        Declared<
            Ports,
            Lags,
            VlanInterfaces,
            OtherInterfaces,
            Vlans,
            Acls,
            Policies,
            PrefixSets,
            NeighborGroups,
            Tables,
            Vrfs,
            AddressSets,
            InterfaceSets,
            Users,
            Certificates
        >,
        PartsOf<Sources, Name>
    >,
    Record<Ports | NamesOf<Merged<PartsOf<Sources, Name>>>["port"], AnyPort>,
    Name
>;

/** One device, merged with the parts its `include` gives it and registered with its network, under the file Circuit is reading. */
function addDevice(network: Registered, written: AnyDevice & { include?: readonly object[] }): AnyDevice {
    const at = caller();
    // Taken off the device's own object, not copied, so the object stays the one the file wrote.
    const include = written.include;
    delete written.include;
    const device: AnyDevice = written;
    resolve(device, "");
    const given = (include ?? []).map((source) => resolve(source, "")) as readonly Record<string, object>[];
    given.forEach((source, i) => {
        if (!source || typeof source !== "object" || Array.isArray(source))
            throw new Error(
                `${at}: ${device.name}: include[${i}] is ${Array.isArray(source) ? "a list" : JSON.stringify(source)}, not a source keyed by hostname, such as tenants.parts.`
            );
    });
    registry.sources.push(...given.map((source) => ({ source, device: device.name, file: at, network: network.network })));
    const merged = mergeAll([device, ...given.map((source) => source[device.name])], at) as AnyDevice;
    network.devices.push({ device: merged, at, file: registry.reading });
    return merged;
}

/** The single items of a list given to `merge`, its nested lists opened. */
type Flat<X> = X extends readonly (infer Y)[] ? Flat<Y> : X;

/** Every key of any member of a union. */
type AllKeys<U> = U extends unknown ? keyof U : never;

// ---------- what is wrong, said at the key, in one line ----------

/** `S` with one letter left out, each way. */
type Drop1<S extends string> = S extends `${infer A}${infer B}` ? B | `${A}${Drop1<B>}` : never;

/** Whether `A` and `B` are one letter apart: one left out, one too many, one changed, or two side by side swapped. */
type Near<A extends string, B extends string> =
    A extends Drop1<B> ? true : B extends Drop1<A> ? true : [Drop1<A> & Drop1<B>] extends [never] ? false : true;

/** ` Did you mean x?` for the key of `Known` one letter from `K`, or nothing. */
type DidYouMean<K extends string, Known extends string> = {
    [P in Known]: Near<K, P> extends true ? P : never;
}[Known] extends infer M extends string
    ? [M] extends [never]
        ? ""
        : ` Did you mean ${M}?`
    : "";

/** What a key Circuit doesn't take says, as its type: `fast_pth is no field of a filter rule. Did you mean fast_path?` */
type NoField<K extends string, Known, Of extends string> = `${K} is no field of ${Of}.${DidYouMean<K, Known & string>}`;

type ValueAt<U, K> = U extends unknown ? (K extends keyof U ? U[K] : never) : never;
/** The item of the lists among `R`, or nothing when `R` holds no list. */
type ListItemOf<R> =
    Extract<NonNullable<R>, readonly unknown[]> extends infer A
        ? [A] extends [never]
            ? never
            : A extends readonly (infer E)[]
              ? E
              : never
        : never;

/** The maps among `R`, without plain values or lists: what a map written there is checked against. */
type MapsOf<R> = Exclude<NonNullable<R>, string | number | boolean | bigint | symbol | readonly unknown[]>;

/** Whether `R` holds maps, alone or in a list: only there is a value looked into. */
type HoldsMaps<R> = [MapsOf<R> | MapsOf<ListItemOf<R>>] extends [never] ? false : true;

/**
 * `X` as it should be, by `R`: a key `R` doesn't take becomes a sentence that says so, and a `then` `R` doesn't take becomes what it
 * takes. So the editor says what is wrong at that key, in one line. Maps and lists inside are checked the same way. `Of` names where.
 *
 * What `R` decides alone is looked into, never a value by its own type: in a function in `lib/` a value may still be a type parameter,
 * which the editor can't look into. A map keyed by name, such as VLANs, is left to the device that takes it.
 */
type Fix<X, R, Of extends string> =
    IsNameMap<R> extends true
        ? X
        : X extends readonly unknown[]
          ? { [I in keyof X]: Fix<X[I], ListItemOf<R>, Of> }
          : X extends object
            ? {
                  [K in keyof X]: K extends AllKeys<MapsOf<R>>
                      ? K extends "then"
                          ? [X[K]] extends [ValueAt<MapsOf<R>, K>]
                              ? X[K]
                              : ValueAt<MapsOf<R>, K>
                          : HoldsMaps<ValueAt<MapsOf<R>, K>> extends true
                            ? Fix<X[K], ValueAt<MapsOf<R>, K>, K & string>
                            : X[K]
                      : NoField<K & string, AllKeys<MapsOf<R>>, Of>;
              }
            : X;

/** Whether `R` is a map keyed by name only, such as VLANs: any key, and no list beside it. */
type IsNameMap<R> = [MapsOf<R>] extends [never]
    ? false
    : string extends AllKeys<MapsOf<R>>
      ? [ListItemOf<R>] extends [never]
          ? true
          : false
      : false;

/** `X` when it is right by `R`, else `X` as it should be: the editor's error is then at the wrong key, and short. */
type Checked<X, R, Of extends string> = X extends Fix<X, R, Of> ? X : Fix<X, R, Of>;

/** A route policy rule's kind, by what it holds, and its words. */
type PolicyRuleOf<X> = X extends { readonly call: unknown }
    ? [CallRule<string>, "a call rule"]
    : X extends { readonly communities: "import" }
      ? [CommunitiesImport<string>, "a communities import rule"]
      : X extends { readonly communities: "export" }
        ? [CommunitiesExport, "a communities export rule"]
        : [RouteRule<string>, "a route policy rule"];

/**
 * What item `X` of a list of `E` is checked as, and its words: a route policy rule as its own kind (`PolicyRuleOf`), a rule as the kind
 * the list holds, anything else as `E`.
 */
type RuleOf<X, E> =
    "call" extends AllKeys<E>
        ? PolicyRuleOf<X>
        : "fast_path" extends AllKeys<E>
          ? [E, "a filter rule"]
          : "to_address" extends AllKeys<E>
            ? [E, "a nat rule"]
            : "rate" extends AllKeys<E>
              ? [E, "an acl rule"]
              : "routing_table" extends AllKeys<E>
                ? [E, "a policy-routing rule"]
                : [E, "an item of this list"];

/** One item of a list of `E`, checked as `RuleOf` says; a list in it, each of its items. */
type ItemChecked<X, E> = X extends readonly unknown[]
    ? { [J in keyof X]: ItemChecked<X[J], E> }
    : X extends object
      ? Checked<X, RuleOf<X, E>[0], RuleOf<X, E>[1]>
      : X;

/** Whether item `X` of `merge`, at any depth, has a key or a `then` its list's items don't take. */
type IsBadItem<X, E> = true extends (Flat<X> extends infer Y ? (Y extends ItemChecked<Y, E> ? false : true) : never) ? true : false;

/** The list a field holds, from its type `F`: never where it holds no list. A field that takes one value or a list (`OneOrMore`) holds a list. */
type ListOf<F> = Extract<NonNullable<F>, readonly unknown[]>;

/**
 * An item of a list field: one of its items, or a list of them, nested as deep as you like (a part's rules, a preset). The list has
 * each key of an item as `never`, so a rule's own keys still tell its kind apart (`call` a call rule), and an error names what it takes.
 */
type ItemOrList<E> = E | (readonly ItemOrList<E>[] & { readonly [K in AllKeys<Extract<E, object>>]?: never });

/** Maps merged: each item checked against those before it, so a value written twice, or an ordered list from two items, is an error at the item. */
type MapItems<T extends readonly unknown[]> = { [I in keyof T]: T[I] & {} & Clash<T[I], Before<T, I>> };

/** Every item is a map: no list, no single value. */
type AllMaps<T extends readonly unknown[]> = true extends (
    T[number] extends infer X ? (X extends readonly unknown[] ? true : X extends object ? false : true) : never
)
    ? false
    : true;

/**
 * Items made into one, in order: `merge([rule_a, tenants.rules.router_input, rule_b])`. Each item is one value or a list of them, nested
 * as deep as you like; you never write `...`.
 *
 * What it makes is decided by the field it goes in, `F`, which the editor reads where `merge` lands, as Circuit does from the model:
 *
 * - **a list** (a chain's rules, NAT, an ACL, a route policy, policy routing, trunk VLANs, addresses, static routes): one flat list. Each
 *   item is checked as one of the field's own items, the device's names included, and completes as one: a rule's keys, its `if`,
 *   `then`, and the names of address sets, interfaces, VLANs and policies. Two single rules, `merge([rule_a, rule_b])`, are two rules.
 *   An ordered list keeps every item in order; any other list keeps the same item once.
 * - **a map** (a part, VLANs, interfaces, address sets, a source keyed by hostname, a tenant): merged key by key, by MODEL.md's Merge
 *   rules. A list inside joins, and two rule lists `part` made join in order, every rule kept; an ordered list from two items, or
 *   another value at one path, is an error naming both files. So `merge([tenant_a, tenant_b])` gives each part by hostname, and each rule
 *   list with tenant_a's rules first.
 * - **no field** (a value of its own, `export const tenants = merge([tenant_a])`): maps merged when every item is a map, else a list.
 *
 * The same map twice in one `merge` is an error.
 *
 * The field is known only once the device's names are: the second signature below makes TypeScript read `merge` after the rest of the
 * device, so it has them.
 */
export function merge<const T extends readonly unknown[], F = unknown>(
    items: unknown extends F
        ? AllMaps<T> extends true
            ? MapItems<T>
            : T
        : [ListOf<F>] extends [never]
          ? MapItems<T>
          : // Each item is checked and completes as the field's own; one with a wrong key or `then` has it said there, in one line
            // (`ItemChecked`). Item by item: a rule that holds a `merge` of its own, such as `dst_port: merge([...])`, is read later, and
            // would otherwise leave every item unchecked this way.
            {
                [I in keyof T]: IsBadItem<T[I], ListOf<F>[number]> extends true
                    ? ItemChecked<T[I] & {}, ListOf<F>[number]>
                    : ItemOrList<ListOf<F>[number]>;
            }
): [T] extends [never]
    ? F
    : unknown extends F
      ? AllMaps<T> extends true
          ? Merged<T>
          : readonly Flat<T[number]>[]
      : [ListOf<F>] extends [never]
        ? Merged<T>
        : ListOf<F>;
/**
 * Never called: no call has two arguments. A generic signature that returns a function makes TypeScript skip `merge` in its first
 * pass over the device, and read it in a second, with the names the first pass found (`SkipGenericFunctions` in its checker).
 */
export function merge<X>(deferred: never, _: never): () => X;
export function merge(items: readonly unknown[]): unknown {
    return made(items, caller());
}

/** The rule each kind of rule list holds, by the ordered list it goes in. */
type Rules = {
    /** A firewall chain's rules: `firewall.filter.<chain>.rules`. */
    filter: FilterRule<string, string, string>;
    /** Address translation: `firewall.nat.source` or `.destination`. */
    nat: NatRule<string, string, string>;
    /** A hardware ACL: `switching.acls.<name>`. */
    acl: AclRule<string>;
    /** A route policy: `routing.policies.<name>`. */
    policy: PolicyRule<string, string>;
    /** Policy routing rules: `routing.policy_routing`. */
    "policy-routing": RoutingRule<string, string>;
};

/** What `part` takes, by kind: a device's shape, or a list of one kind of rule. */
type Kinds = {
    device: DevicePart;
    filter: readonly Rules["filter"][];
    nat: readonly Rules["nat"][];
    acl: readonly Rules["acl"][];
    policy: readonly Rules["policy"][];
    "policy-routing": readonly Rules["policy-routing"][];
};

/**
 * What `part` checks, by kind, at the wrong key: a device part has only a device's keys, at every depth; each rule only its kind's keys,
 * its `if` only its kind's conditions, and its `then` one its kind takes. A route policy rule as its own kind (`PolicyRuleOf`).
 */
type PartChecked<T, K> = K extends "device"
    ? Checked<T, DevicePart, "a device part">
    : K extends "policy"
      ? T extends ItemChecked<T, Rules["policy"]>
          ? T
          : ItemChecked<T, Rules["policy"]>
      : K extends Exclude<keyof Rules, "policy">
        ? Checked<T, readonly Rules[K][], `a ${K} rule`>
        : T;

/** Each kind's keys at run time, from keys.ts, which checks them against the types; and what `then` may be. */
const RULE_SHAPES: Record<string, Shape> = { filter: FILTER_RULE, nat: NAT_RULE, acl: ACL_RULE, "policy-routing": ROUTING_RULE };
const THEN: Record<string, readonly string[]> = ACTIONS;

/** The map at `path` in `value`, its list positions included: `[2].if` is the `if` of the third rule. */
const mapAt = (value: unknown, path: string): unknown =>
    (path.match(/[^.[\]]+/g) ?? []).reduce<unknown>(
        (v, step) => (v && typeof v === "object" ? (v as Record<string, unknown>)[step] : undefined),
        value
    );

/**
 * A part written in one file and used in another. The kind says its shape, and the editor completes and checks it as that:
 *
 * - `part("device", { ... })`: a part of a device, in the device's shape, given to each device under its hostname in a source:
 *   `{ "edge-01": part("device", { ... }) }`. The names it refers to are checked at the device.
 * - `part("filter", [...])`, `"nat"`, `"acl"`, `"policy"`, `"policy-routing"`: rules for an ordered list another file writes, such as
 *   each tenant's rules for the router's input chain. That file places them with `merge`: `rules: merge([own_rule, tenants.rules.router_input])`.
 *   Each rule has its kind's fields only. Rules made here that no device holds stop `circuit validate`, so none is forgotten.
 */
export function part<const K extends "device" | "filter" | "nat" | "acl" | "policy" | "policy-routing", const T>(
    kind: K,
    value: Kinds[K] & PartChecked<T, K>
): // Rules with a mistake give no rules, so the mistake is said once, at the rule, and not again where the list is placed.
K extends "device" ? T : T extends PartChecked<T, K> ? T : readonly never[] {
    const file = caller();
    // The line that called `part`, such as one in lib/: where a wrong key of a rule is looked for first.
    const inner = innerCaller();
    if (!(kind in RULE_SHAPES) && kind !== "device" && kind !== "policy")
        throw new Error(`${file}: part has no kind "${kind}". The kinds: device, policy, ${Object.keys(RULE_SHAPES).join(", ")}.`);
    if (kind === "policy") {
        if (!Array.isArray(value)) throw new Error(`${file}: a policy part is a list of rules.`);
        value.forEach((rule: unknown, i: number) => {
            const problem = policyRuleProblem(rule);
            if (problem) throw new Error(`${file}: rule ${i + 1} of this policy part: ${problem}`);
        });
        registry.rules.push({ rules: value, file });
    }
    const shape = RULE_SHAPES[kind];
    if (shape) {
        if (!Array.isArray(value)) throw new Error(`${file}: a ${kind} part is a list of rules.`);
        mark(value, file, inner);
        const takes = THEN[kind];
        const wrong = [
            ...unknownKeys(value, [shape]).map((u) => {
                // `[2].if` and `protocl`: rule 3, `if.protocl`.
                const [, i = "0", within = ""] = /^\[(\d+)\]\.?(.*)$/.exec(u.path) ?? [];
                const key = within ? `${within}.${u.key}` : u.key;
                return `${writtenAt(mapAt(value, u.path), u.key)}rule ${Number(i) + 1} of this ${kind} part: ${key}: no such field. ${unknownKeyHelp(u)}`;
            }),
            ...(takes
                ? value.flatMap((rule: Record<string, unknown>, i: number) => {
                      if (takes.includes(rule.then as string)) return [];
                      const hint = typeof rule.then === "string" ? closest(rule.then, takes) : undefined;
                      return [
                          `${writtenAt(rule, "then")}rule ${i + 1} of this ${kind} part: then: ${JSON.stringify(rule.then)} is no then of a ${kind} rule. ${hint ? `Did you mean ${hint}?` : `It takes: ${takes.join(", ")}.`}`,
                      ];
                  })
                : []),
        ];
        if (wrong.length) throw new Error(wrong.join("\n"));
        registry.rules.push({ rules: value, file });
    }
    // A rule list joins another one in `merge`, every rule kept, in order: each tenant's, one after another.
    return (kind === "device" ? mark(value, file, inner) : ruleList(mark(value as object, file, inner))) as never;
}

/** Marks the list `bgpNeighbors()` makes, for Circuit to fill. */
export const BGP_NEIGHBORS = Symbol("every BGP neighbor");

/**
 * Every BGP neighbor address of this device, as an address set: `address_sets: { "bgp-neighbors": bgpNeighbors() }`. Circuit fills
 * it when it reads the project, from `routing.bgp.neighbors`, so a new neighbor needs no second line. Write it alone as the set.
 * To the editor it is a list of addresses. Nothing refers to its items by name: rules name the set (`src_set: "bgp-neighbors"`).
 */
export function bgpNeighbors(): readonly IP[] {
    return Object.defineProperty([], BGP_NEIGHBORS, { value: true });
}

/**
 * A value written once and used as it is written, in this file or another: `literal(["exchange-a", "exchange-b"])` stays those two VLAN names,
 * so a device takes it where it takes VLANs, and the editor checks each name there. Without it, the editor would see only "some text".
 */
export function literal<const T>(values: T): T {
    return mark(values, caller());
}

/** What a device takes from a network that writes `checks` as `Own` and `communities` as `C`. */
type FactsOf<Own, C> = {
    untrusted: Own extends { readonly untrusted_vlans: object } ? true : false;
    communities: C extends object ? true : false;
    groups: GroupsOf<C>;
    requests: RequestsOf<C>;
};

/** The network `circuit()` returns: what it was given, as written, and `device()`, typed from it. */
export type Network<Sites extends Readonly<Record<string, Site>>, Asn extends number, Own, C, P extends Prefixes> = Readonly<
    NetworkSettings<Sites, Asn, Own, C, P>
> & {
    /** The AS the network operates, as written. */
    readonly asn: Asn;
    /** The network's own prefixes, as written, for a device to use by name: `as64500.prefixes.id01.v4_1`. Empty when `circuit()` writes none. */
    readonly prefixes: P;
    /** Declare one device of this network, in its own file under `sites/`: `export default as64500.device({ name: "edge-01", include: [tenants.parts], ... })`. */
    readonly device: DeviceOf<keyof Sites & string, FactsOf<Own, C>>;
};

/**
 * Declare a network, in `circuit.ts` at the project's root: `export const as64500 = circuit({ asn: 64500, sites: { ... }, checks: { ... } })`,
 * named after its AS, as we suggest. Its devices are `as64500.device({ ... })`, each in its own file under `sites/`, typed from what the network writes here: its sites,
 * whether `untrusted_vlans` is on, and its `communities`. Circuit imports `circuit.ts`, then every device file, so `circuit.ts` imports no device.
 *
 * A project may hold several networks, such as two ASes: one `circuit()` each, each exported from `circuit.ts` under its own name. The
 * export writes one JSON file per network, named after it.
 *
 * A check of your own is any other name in `checks`, with a function: `checks: { exports_end_in_reject: true, prefixes_stay_in_region: prefixesStayInRegion }`.
 * It reads the network resolved, as its devices will run it (`ResolvedNetwork`).
 */
export function circuit<
    const Sites extends Readonly<Record<string, Site>>,
    const Asn extends number,
    const Own = {},
    const C = undefined,
    const P extends Prefixes = {},
>(settings: NetworkSettings<Sites, Asn, Own, C, P>): Network<Sites, Asn, Own, C, P> {
    const registered: Registered = { network: {}, at: caller(), devices: [] };
    registered.network = { ...settings, prefixes: settings.prefixes ?? {}, device: (device: AnyDevice) => addDevice(registered, device) };
    registry.networks.push(registered);
    return registered.network as never;
}

export type { Names };
