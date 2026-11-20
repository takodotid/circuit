import { Address } from "../../core/address";
import type { Device, Family } from "../../model";
import type { BgpSession, ReadSession } from "../platform";
import { FortiOsRouting } from "./routing";
import { FortiOsVdoms } from "./vdoms";

/** One neighbor's line in a BGP summary. */
type Row = {
    address: string;
    /** How long the session has been up or down, or `never`. */
    upDown: string;
    /** The prefixes received while the session is up, else its state, such as `Active` or `Idle (PfxCt)`. */
    state: string;
};

/** The live BGP sessions, from the BGP summary of each family the neighbors carry. */
export class FortiOsBgpSessions {
    static readonly SUMMARY: Record<Family, string> = { ipv4: "get router info bgp summary", ipv6: "get router info6 bgp summary" };

    /** The state of a session closed because the neighbor sent more prefixes than its `maximum-prefix`. */
    private static readonly LIMIT_STATE = "Idle (PfxCt)";

    /** What the device prints when it refuses a command, such as `get router` outside a VDOM in multi-VDOM mode. */
    private static readonly REFUSED = /Command fail\. Return code|command parse error/;

    /** How much of an answer it cannot read an error quotes. */
    private static readonly QUOTE_CHARS = 300;

    /**
     * Each configured neighbor in its order, matched to its summary lines by address. In multi-VDOM mode BGP runs in `root`, which the summaries are read in, so the session moves to a shell of its own. A session is up when a summary shows a prefix count for it.
     */
    static async read(device: Device, session: ReadSession): Promise<BgpSession[]> {
        const neighbors = Object.entries(device.routing?.bgp?.neighbors ?? {});
        const families = new Set(neighbors.flatMap(([, neighbor]) => FortiOsRouting.familiesOfNeighbor(device, neighbor)));
        const multi = Boolean(device.system?.vdoms);
        const answers: string[] = [];

        if (multi) {
            await session.run("config vdom");
            await session.run(`edit ${FortiOsVdoms.ROOT}`);
        }

        try {
            for (const family of families) answers.push(await session.run(FortiOsBgpSessions.SUMMARY[family]));
        } finally {
            if (multi) await session.run("end");
        }

        const refused = answers.find((answer) => FortiOsBgpSessions.REFUSED.test(answer));
        if (refused) throw new Error(`the device refused its BGP summary: ${refused.trim().slice(0, FortiOsBgpSessions.QUOTE_CHARS)}`);

        const rows = answers.flatMap((answer) => FortiOsBgpSessions.rows(answer));

        return neighbors.map(([name, neighbor]): BgpSession => {
            const address = Address.canonical(neighbor.address);
            const mine = rows.filter((row) => Address.canonical(row.address) === address);
            if (!mine.length) return { neighbor: name, remote: "-", established: false, prefixes: "-", uptime: "no session" };

            const up = mine.filter((row) => /^\d+$/.test(row.state));
            const limited = mine.some((row) => row.state === FortiOsBgpSessions.LIMIT_STATE);

            return {
                neighbor: name,
                remote: mine[0]!.address,
                established: up.length > 0,
                prefixes: up.length ? String(up.reduce((sum, row) => sum + Number(row.state), 0)) : "-",
                uptime: up[0]?.upDown ?? "-",
                ...(up.length ? {} : { reason: limited ? "limit exceeded" : mine[0]!.state }),
                ...(limited ? { limit: {} } : {}),
            };
        });
    }

    /**
     * The neighbor lines under the summary's header, `Neighbor V AS MsgRcvd MsgSent TblVer InQ OutQ Up/Down State/PfxRcd`, up to `Total number of neighbors`. The summary is GNU Zebra's, which prints an address wider than its column on a line of its own and the fields on the next. None when BGP is not running: the device then prints nothing.
     */
    static rows(answer: string): Row[] {
        const lines = answer.replace(/\r/g, "").split("\n");
        const header = lines.findIndex((line) => /^Neighbor\s+V\s+AS\s/.test(line));
        if (header === -1) return [];

        const rows: Row[] = [];
        let alone: string | undefined;

        for (const line of lines.slice(header + 1)) {
            const words = line.trim().split(/\s+/).filter(Boolean);
            if (words[0] === "Total") break;
            if (words.length === 1) alone = words[0];
            if (words.length < 2) continue;

            const fields = alone ? [alone, ...words] : words;
            alone = undefined;
            const [address, , , , , , , , upDown, ...state] = fields;
            if (address && upDown && state.length) rows.push({ address, upDown, state: state.join(" ") });
        }

        return rows;
    }
}
