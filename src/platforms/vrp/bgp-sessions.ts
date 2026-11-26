// The live BGP sessions on VRP: `display bgp peer` lists the main table's IPv4 sessions, `display bgp ipv6 peer` its IPv6 ones, and `display bgp vpnv4 vpn-instance <name> peer` a VRF's. A CE6855 on V200R005C00SPC800 printed each with sessions that never came up (TRAPS.md).

import { Address } from "../../core/address";
import type { Device } from "../../model";
import type { BgpSession, ReadSession } from "../platform";
import { VrpBgp } from "./bgp";

/** One session's line under the header: its address, how long it has been up or down, its state, and the prefixes it received. */
type Row = { address: string; upDown: string; state: string; received: string };

export class VrpBgpSessions {
    private static readonly ESTABLISHED = "Established";

    /** How many fields a session's line has, from its address to the prefixes it received. */
    private static readonly FIELDS = 9;

    /** Each configured neighbor in its order, matched by address to a line of the list that holds its family or its VRF. */
    static async read(device: Device, session: ReadSession): Promise<BgpSession[]> {
        const neighbors = Object.entries(device.routing?.bgp?.neighbors ?? {});
        const lists = new Map<string, Row[]>();

        const rows = async (command: string) => {
            if (!lists.has(command)) lists.set(command, VrpBgpSessions.rows(await session.run(command)));
            return lists.get(command)!;
        };

        const sessions: BgpSession[] = [];
        for (const [name, neighbor] of neighbors) {
            const vrf = VrpBgp.settingsOf(device, neighbor).vrf;
            const command = vrf
                ? `display bgp vpnv4 vpn-instance ${vrf} peer`
                : Address.family(neighbor.address) === "ipv6"
                  ? "display bgp ipv6 peer"
                  : "display bgp peer";
            const address = Address.canonical(neighbor.address);
            const found = (await rows(command)).find((row) => Address.canonical(row.address) === address);

            if (!found) {
                sessions.push({ neighbor: name, remote: "-", established: false, prefixes: "-", uptime: "no session" });
                continue;
            }

            const up = found.state === VrpBgpSessions.ESTABLISHED;
            sessions.push({
                neighbor: name,
                remote: found.address,
                established: up,
                prefixes: up ? found.received : "-",
                uptime: up ? found.upDown : "-",
                ...(up ? {} : { reason: found.state }),
            });
        }

        return sessions;
    }

    /** The lines under the header, up to the prompt. None when BGP is not running: the switch then prints nothing. */
    static rows(answer: string): Row[] {
        const lines = answer.replace(/\r/g, "").split("\n");
        const header = lines.findIndex((line) => /^\s*Peer\s+V\s+AS\s+MsgRcvd/.test(line));
        if (header === -1) return [];

        return lines.slice(header + 1).flatMap((line): Row[] => {
            const words = line.trim().split(/\s+/);
            if (words.length !== VrpBgpSessions.FIELDS || !Address.isValid(words[0]!)) return [];

            const [address, , , , , , upDown, state, received] = words as [string, ...string[]];
            return [{ address, upDown: upDown!, state: state!, received: received! }];
        });
    }
}
