// VRRP on a VRP VLAN interface or routed port. A CE6855 on V200R005C00SPC800 kept an old virtual address beside a new one, and forgot a group's other settings once its last address was undone (TRAPS.md).

import type { Vrrp } from "../../model";
import type { Step } from "../platform";

export class VrpVrrp {
    /** A group's address, `vrrp vrid 1 virtual-ip 192.0.2.6`, with the group's number. */
    private static readonly ADDRESS = /^(undo )?vrrp vrid (\d+) virtual-ip /;

    /** A group's lines: its address, its priority, whether it preempts, and how often it advertises. */
    static lines(group: Vrrp): string[] {
        const lines = [`vrrp vrid ${group.id} virtual-ip ${group.address}`];
        if (group.priority !== undefined) lines.push(`vrrp vrid ${group.id} priority ${group.priority}`);
        // The platform preempts by default, and the config only does when asked.
        if (!group.preempt) lines.push(`vrrp vrid ${group.id} preempt disable`);
        if (group.interval !== undefined && group.interval !== 1) lines.push(`vrrp vrid ${group.id} timer advertise ${group.interval}`);
        return lines;
    }

    /** The steps, with a group's new address before the undo of its old one, so the group and its other settings stay. */
    static order(steps: Step[]): Step[] {
        for (const step of steps) {
            const send = step.send;
            for (let index = 0; index < send.length; index++) {
                const undone = VrpVrrp.ADDRESS.exec(send[index]!);
                if (!undone?.[1]) continue;

                const fresh = send.findIndex(
                    (line, at) => at > index && VrpVrrp.ADDRESS.exec(line)?.[2] === undone[2] && !line.startsWith("undo ")
                );
                if (fresh !== -1) send.splice(index, 0, ...send.splice(fresh, 1));
            }
        }
        return steps;
    }
}
