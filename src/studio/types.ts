// What Studio's server sends its page. Types only, so the page shares them without taking any of Circuit's code.

import type { Graph } from "../core/graph";
import type { Device } from "../model";
import type { Finding } from "../platforms/finding";

/** One network of the project, without its devices. */
export type StudioNetwork = {
    name: string;
    asn?: number;
    /** By name. */
    sites: Record<string, { description?: string; number?: number }>;
    devices: string[];
    /** Where its secrets are, relative to the project. */
    secretsFile: string;
    /** The secrets its devices and integrations name with `secret("NAME")`. */
    secrets: string[];
};

/** One address a device holds. */
export type AddressRow = {
    device: string;
    /** The port or interface. */
    holder: string;
    /** With its length. */
    address: string;
    /** The prefix it is in. */
    prefix: string;
    family: "ipv4" | "ipv6";
    /** The far end of a point-to-point address. */
    peer?: string;
    vrf?: string;
};

/** One BGP session, with what it takes from its neighbor group, and what is at its far end. */
export type Session = {
    device: string;
    name: string;
    address: string;
    group?: string;
    remoteAs?: number;
    role?: string;
    import?: string;
    export?: string;
    description?: string;
    /** One of our devices, by name, or another network, as `AS64501`. */
    far?: string;
    /** The far device has no session back. */
    oneSided?: true;
};

/** One cable, from the end that names it first. */
export type Cable = {
    device: string;
    port: string;
    farDevice: string;
    farPort: string;
    /** The LAG each end's port is in. */
    lag?: string;
    farLag?: string;
    description?: string;
    /** What is between the two ends, such as a carrier's local loop. */
    through?: string;
    /** VLANs carried, as `name (id)`, from the port or its LAG. */
    vlans: string[];
    /** The far end does not name this cable back. */
    oneSided?: true;
};

/** Everything Studio shows of the project, read fresh each time a file changes. */
export type StudioData = {
    /** The project's folder name. */
    project: string;
    networks: StudioNetwork[];
    devices: Device[];
    /** Each device's file, from the project's folder. */
    files: Record<string, string>;
    /** Every port each device's model has, in order, so Studio can show the ones the project leaves shut. */
    ports: Record<string, string[]>;
    /** What each device would run, as `circuit apply` would send it whole, or why it cannot be rendered. */
    rendered: Record<string, string>;
    /** What `circuit validate` finds, and what reading the project warns of. */
    findings: Finding[];
    graph: Graph;
    addresses: AddressRow[];
    sessions: Session[];
    cables: Cable[];
    /** Every secret the project names with `secret("NAME")`, by name. */
    secrets: string[];
};

/** What reading the project stopped on, instead of the data. */
export type StudioError = { error: string };

/** One commit, as Studio lists it. */
export type Commit = {
    commit: string;
    short: string;
    author: string;
    /** ISO 8601, with the author's time zone. */
    date: string;
    subject: string;
};

/** How one name in a secrets file is kept. The value is sent only when it is encrypted: a value in plain text never leaves the server. */
export type SecretEntry = {
    name: string;
    kind: "encrypted" | "1password" | "empty" | "not encrypted" | "missing";
    /** The `encrypted:...` value, for the page to decrypt with the password a person types. */
    ciphertext?: string;
    /** Where 1Password keeps it. */
    onePassword?: { vault: string; item: string; field: string };
    /** The config names it with `secret("NAME")`. */
    needed: boolean;
};

/** One secrets file as the page may see it: names, how each is kept, ciphertexts. Never a value in plain text, and never the password. */
export type SecretsFileListing = {
    file: string;
    /** The networks that keep their secrets here. */
    networks: string[];
    /** Where the password comes from, without its value. Absent when a person types it. */
    passwordLocation?: string;
    entries: SecretEntry[];
};

export type SecretsListing = { files: SecretsFileListing[] };

/** What `Read from the device now` found: the device's own config, and the plan from it to the project's. */
export type LiveRead = {
    device: string;
    /** What the device runs now, secrets removed. */
    running: string;
    /** What the project says it should run. */
    rendered: string;
    /** The plan `circuit diff` would show. */
    steps: { title: string; show: string[] }[];
    problems: string[];
    /** When it was read, ISO 8601. */
    readAt: string;
};
