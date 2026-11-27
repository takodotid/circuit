// The live BGP sessions on Raisecom ROS, from `show ip bgp summary`. A RAX721 on ROS 6.5.2 printed it with sessions that never came up, each `Idle` (TRAPS.md).

import { Address } from "../../core/address";
import type { Device } from "../../model";
import type { BgpSession, ReadSession } from "../platform";

/** One session's line under the header: its address, how long it has been up or down, and its state or the prefixes it received. */
type Row = { address: string; upDown: string; state: string };

export class RaisecomRosBgpSessions {
    static readonly COMMAND = "show ip bgp summary";

    /** The fields of a session's line before its state: address, version, AS, messages received and sent, both queues, and up or down. */
    private static readonly FIELDS = 8;

    /** Each configured neighbor in its order, matched by address to a line of the summary. An established session shows the prefixes it received where another shows its state. */
    static async read(device: Device, session: ReadSession): Promise<BgpSession[]> {
        const rows = RaisecomRosBgpSessions.rows(await session.run(RaisecomRosBgpSessions.COMMAND));

        return Object.entries(device.routing?.bgp?.neighbors ?? {}).flatMap(([name, neighbor]): BgpSession[] => {
            if (!neighbor) return [];

            const address = Address.canonical(neighbor.address);
            const found = rows.find((row) => Address.canonical(row.address) === address);
            if (!found) return [{ neighbor: name, remote: "-", established: false, prefixes: "-", uptime: "no session" }];

            const up = /^\d+$/.test(found.state);
            return [
                {
                    neighbor: name,
                    remote: found.address,
                    established: up,
                    prefixes: up ? found.state : "-",
                    uptime: up ? found.upDown : "-",
                    ...(up ? {} : { reason: found.state }),
                },
            ];
        });
    }

    /** The lines under the header. None when BGP is not running: the switch then says `No BGP process is configured`. */
    static rows(answer: string): Row[] {
        const lines = answer.replace(/\r/g, "").split("\n");
        const header = lines.findIndex((line) => /^\s*Neighbor\s+V\s+AS\s+MsgRcvd/.test(line));
        if (header === -1) return [];

        return lines.slice(header + 1).flatMap((line): Row[] => {
            const words = line.trim().split(/\s+/);
            if (words.length <= RaisecomRosBgpSessions.FIELDS || !Address.isValid(words[0]!)) return [];

            // A state of two words, such as `Idle (Admin)`, stays whole.
            const state = words.slice(RaisecomRosBgpSessions.FIELDS).join(" ");
            return [{ address: words[0]!, upDown: words[RaisecomRosBgpSessions.FIELDS - 1]!, state }];
        });
    }
}
