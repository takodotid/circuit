// LLDP neighbors from `show lldp remote detail`, which spells each port in full. The short form abbreviates ports, `TGE1/3/3`, and pads columns, so a name with a space cannot be told apart there.

import type { Neighbor } from "../../core/cabling";
import { Catalog } from "../../core/catalog";
import type { Device } from "../../model";

export class RaisecomRosLldp {
    /** A `<port> has N remotes:` line per port, then a block per remote of `Key: value` lines. A long value wraps onto lines that start with spaces, cut mid-word. A remote without a system name is named by its chassis ID. A port the catalog does not have, such as the out-of-band port, is left out. */
    static remotes(text: string, device: Device): Neighbor[] {
        const tidy = (port: string) => port.replace(/\s+/g, "").toLowerCase();
        const ports = new Map(
            Catalog.ports(device.platform, device.model).map((port) => [tidy(Catalog.spell(device.platform, device.model, port)), port])
        );

        const neighbors: Neighbor[] = [];
        let port: string | undefined;
        let remote: Record<string, string> | undefined;
        let key: string | undefined;

        const finish = () => {
            const system = remote?.SysName?.trim() || remote?.ChassisId?.trim();
            if (port && system) neighbors.push({ port, system, remote_port: remote?.PortId?.trim() ?? "" });

            remote = undefined;
            key = undefined;
        };

        for (const line of text.replace(/\r/g, "").split("\n")) {
            const header = /^(\S+) has\s+\d+ remotes:/.exec(line);
            if (header) {
                finish();
                port = ports.get(tidy(header[1]!));
                continue;
            }

            if (/^Remote \d+\s*$/.test(line)) {
                finish();
                remote = {};
                continue;
            }

            if (!remote) continue;

            const field = /^([A-Za-z][^:]*?):\s*(.*)$/.exec(line);
            if (field) {
                key = field[1]!;
                remote[key] = field[2]!;
            } else if (key && /^\s+\S/.test(line)) remote[key] += line.trimStart();
            else key = undefined;
        }

        finish();
        return neighbors;
    }
}
