import { Address } from "../../core/address";
import type { Device } from "../../model";
import type { BgpSession, ReadSession } from "../platform";
import { JunosBgp } from "./bgp";

/** One element of `| display json`: Junos writes each as a list of objects, a value in `data` and child elements by their names. */
type JsonElement = { data?: string } & Record<string, unknown>;

/** A BGP peer as the device prints it, with the fields Circuit reads. */
type Peer = {
    /** Without the TCP port the device adds while a session is up, `192.0.2.1+179`. */
    address: string;
    group: string;
    /** The routing instance it is configured in: `master` for the main one. */
    instance: string;
    state: string;
    flags: string[];
    /** How long it has been in its state, from `show bgp summary` only. */
    elapsed: string;
    /** Each table it sent routes into, such as `inet.0` or `<vrf>.inet6.0`, with how many prefixes it received there. */
    ribs: { name: string; received: number }[];
};

/** The live BGP sessions, from `show bgp neighbor` and `show bgp summary` as JSON, both of which list the peers of every routing instance. */
export class JunosBgpSessions {
    /** Each peer's group, routing instance, state, flags, and the prefixes it received in each table. */
    static readonly NEIGHBORS = "show bgp neighbor | display json | no-more";

    /** How long each peer has been in its state, `elapsed-time`, which the neighbor detail lacks. */
    static readonly SUMMARY = "show bgp summary | display json | no-more";

    /** What the device prints, in an `output` element, on a switch with no BGP configured (21.4R3-S8.5). */
    private static readonly NOT_RUNNING = "BGP is not running";

    private static readonly ESTABLISHED = "Established";

    /** The flag of a session idle because the neighbor sent more prefixes than its `prefix-limit` (Juniper's `show bgp neighbor` reference). */
    private static readonly LIMIT_FLAG = "PrefixLimitIdle";

    /** The main routing instance, as the device names it. */
    private static readonly MAIN = "master";

    /** A line that says which routing engine the CLI is on, such as `{master:0}`, which an interactive CLI prints before each prompt. */
    private static readonly BANNER = /^\{[\w-]+(?::[\w-]+)?\}$/gm;

    /** How much of an answer it cannot read an error quotes. */
    private static readonly QUOTE_CHARS = 300;

    /** Each configured neighbor in its order, matched to its peer by address within its routing instance first, then by its group, which Circuit names after it. */
    static async read(device: Device, session: ReadSession): Promise<BgpSession[]> {
        const peers = JunosBgpSessions.peers(await session.run(JunosBgpSessions.NEIGHBORS));
        const summary = JunosBgpSessions.peers(await session.run(JunosBgpSessions.SUMMARY));

        return Object.entries(device.routing?.bgp?.neighbors ?? {}).map(([name, neighbor]): BgpSession => {
            const instance = JunosBgp.settingsOf(device, neighbor).vrf ?? JunosBgpSessions.MAIN;
            const address = Address.canonical(neighbor.address);
            const inInstance = peers.filter((peer) => peer.instance === instance);
            const found = inInstance.find((peer) => peer.address === address) ?? inInstance.find((peer) => peer.group === name);

            if (!found) return { neighbor: name, remote: "-", established: false, prefixes: "-", uptime: "no session" };

            const up = found.state === JunosBgpSessions.ESTABLISHED;
            const limited = found.flags.includes(JunosBgpSessions.LIMIT_FLAG);
            // The summary names no routing instance, so a peer whose address is in two is told apart by its tables.
            const sameAddress = summary.filter((peer) => peer.address === found.address);
            const timed =
                sameAddress.find((peer) => peer.ribs.some((rib) => JunosBgpSessions.instanceOf(rib.name) === instance)) ?? sameAddress[0];
            const received = found.ribs.reduce((sum, rib) => sum + rib.received, 0);

            return {
                neighbor: name,
                remote: found.address,
                established: up,
                prefixes: up && found.ribs.length ? String(received) : "-",
                uptime: up ? timed?.elapsed || "-" : "-",
                ...(up ? {} : { reason: limited ? "limit exceeded" : found.state || "not established" }),
                ...(limited ? { limit: {} } : {}),
            };
        });
    }

    /** The peers in an answer of `NEIGHBORS` or `SUMMARY`. None when BGP is not running. */
    static peers(answer: string): Peer[] {
        const json = JunosBgpSessions.json(answer);
        const [information] = JunosBgpSessions.children(json, "bgp-information");

        if (!information) {
            const [output] = JunosBgpSessions.children(json, "output");
            if (output?.data?.trim() === JunosBgpSessions.NOT_RUNNING) return [];
            throw new Error(`the device did not list its BGP peers: ${answer.slice(0, JunosBgpSessions.QUOTE_CHARS)}`);
        }

        return JunosBgpSessions.children(information, "bgp-peer").map((peer) => ({
            address: Address.canonical(JunosBgpSessions.text(peer, "peer-address").replace(/\+\d+$/, "")),
            group: JunosBgpSessions.text(peer, "peer-group"),
            instance: JunosBgpSessions.text(peer, "peer-cfg-rti") || JunosBgpSessions.MAIN,
            state: JunosBgpSessions.text(peer, "peer-state"),
            flags: JunosBgpSessions.text(peer, "peer-flags").split(/\s+/).filter(Boolean),
            elapsed: JunosBgpSessions.text(peer, "elapsed-time"),
            ribs: JunosBgpSessions.children(peer, "bgp-rib").map((rib) => ({
                name: JunosBgpSessions.text(rib, "name"),
                received: Number(JunosBgpSessions.text(rib, "received-prefix-count")) || 0,
            })),
        }));
    }

    /** The routing instance of a table: `<vrf>.inet.0` is the VRF's, `inet.0` the main instance's. */
    private static instanceOf(rib: string): string {
        return /^(.+)\.inet6?\.\d+$/.exec(rib)?.[1] ?? JunosBgpSessions.MAIN;
    }

    /** The JSON in an answer. Anything printed around it is left out, such as a warning, or the `{master:0}` line a console prints before its prompt. */
    private static json(answer: string): JsonElement {
        const text = answer.replace(JunosBgpSessions.BANNER, "");
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");

        try {
            if (start === -1 || end < start) throw new Error("no JSON");
            return JSON.parse(text.slice(start, end + 1)) as JsonElement;
        } catch {
            throw new Error(`the device's answer is not the JSON Circuit asked for: ${answer.slice(0, JunosBgpSessions.QUOTE_CHARS)}`);
        }
    }

    private static children(element: JsonElement | undefined, name: string): JsonElement[] {
        const value = element?.[name];
        return Array.isArray(value) ? (value as JsonElement[]) : [];
    }

    private static text(element: JsonElement, name: string): string {
        return (JunosBgpSessions.children(element, name)[0]?.data ?? "").trim();
    }
}
