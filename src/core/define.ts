import type { ModelName, PlatformName, PortName } from "../adapters/devices/catalog";
import type { Device, Secret } from "../schema";

/** A value resolved by name when a device is applied, from the environment or `.env` beside the config, and through 1Password when that value is an `op://` reference. Never the value itself. */
export const secret = (name: string): Secret => ({ secret: name });

/** A value read from a file when a device is applied, such as a private key in PEM. The path is relative to the config file; keep the file out of git. */
export const secretFile = (path: string): Secret => {
    if (!/^[A-Za-z0-9_./-]+$/.test(path)) throw new Error(`secret file path ${path} may hold only letters, digits, _ . / and -`);
    return { secret_file: path };
};

/**
 * Declare one device.
 *
 * The names it declares (VLANs, interfaces, policies and the rest) are the only names its other fields accept, and the editor suggests them. The port names come from the model.
 */
export function defineDevice<
    const Platform extends PlatformName,
    const Model extends ModelName<Platform>,
    const Vlans extends string = never,
    const Interfaces extends string = never,
    const Policies extends string = never,
    const PrefixSets extends string = never,
    const BgpGroups extends string = never,
    const Acls extends string = never,
    const AddressSets extends string = never,
    const Users extends string = never,
    const Vrfs extends string = never,
    const Certificates extends string = never,
>(
    device: Device<
        Platform,
        Model,
        PortName<Platform, Model>,
        Vlans,
        Interfaces,
        Policies,
        PrefixSets,
        BgpGroups,
        Acls,
        AddressSets,
        Users,
        Vrfs,
        Certificates
    >
): Device {
    return device as unknown as Device;
}

/** Something a check found. */
export type Finding = {
    /** An error stops `diff` and `apply`; a warning is reported only. */
    level: "error" | "warning";
    /** The device it is about, when it is about one. */
    device?: string;
    /** What is wrong, in a sentence. */
    message: string;
};

/** A rule of your own design, run by `validate` beside the framework's. */
export type Check = (devices: readonly Device[]) => readonly Finding[];

/**
 * One BGP community the network defines, in the community description format of the NLNOG Ring looking glass, which bgp.tools also reads.
 *
 * `community` takes `nnn` for any number, `x` for one digit and `a-b` for a range, such as `65535:0:nnn`. `description` refers to what each wildcard matched as `$0`, `$1` and so on, such as `do not announce to AS$0`.
 */
export type Community = {
    community: string;
    description: string;
};

/** The whole network. */
export type Network = {
    /** Every device the framework manages. */
    devices: readonly Device[];
    /** Rules of your own design. */
    checks?: readonly Check[];
    /** The AS the network operates, for what is published about it. */
    asn?: number;
    /** The BGP communities the network defines, printed by `circuit communities` for a looking glass or bgp.tools. */
    communities?: readonly Community[];
    /** Keeps the network's PeeringDB record in step with the config: `circuit peeringdb`. Needs `asn`. */
    peeringdb?: {
        /** An API key with write access to the network's record. */
        api_key: Secret;
    };
    /** Keeps LibreNMS monitoring every device: `circuit librenms`. */
    librenms?: {
        /** Where LibreNMS is, such as `https://librenms.example.com`. */
        url: string;
        /** An API token that can add devices. */
        api_token: Secret;
    };
};

/** Declare the network, in `circuit.config.ts`. */
export const defineNetwork = (network: Network): Network => network;
