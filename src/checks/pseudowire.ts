import { Address } from "../core/address";
import type { Device } from "../model";

type Report = (message: string) => void;

/** Ethernet pseudowires (RFC 4448), which LDP sets up between the LSR IDs of two PEs (RFC 8077). */
export class PseudowireChecks {
    /** A PW ID is a non-zero 32-bit number (RFC 8077, section 5.2). */
    private static readonly MAX_PW_ID = 4_294_967_295;

    /** The MTU a pseudowire tells the far PE takes 2 bytes (RFC 8077, section 6.4). */
    private static readonly MAX_MTU = 65_535;

    static check(device: Device, report: Report): void {
        const lsrId = device.routing?.mpls?.ldp?.lsr_id;
        const seen = new Map<string, string>();

        for (const [name, pseudowire] of Object.entries(device.interfaces?.pseudowire ?? {})) {
            if (!pseudowire) continue;
            const at = `interfaces.pseudowire.${name}`;
            const { peer, pw_id: id, mtu } = pseudowire;

            if (!lsrId)
                report(
                    `${at} needs routing.mpls: LDP sets up the pseudowire, and its frames cross the core by label. Write routing.mpls.ldp`
                );

            if (!Address.isValid(peer) || Address.family(peer) !== "ipv4")
                report(`${at}.peer ${peer} is not an IPv4 address. Write the far PE's LSR ID, such as 192.0.2.2`);
            else if (peer === lsrId) report(`${at}.peer ${peer} is this router's own LSR ID. Write the far PE's`);

            if (!Number.isInteger(id) || id < 1 || id > PseudowireChecks.MAX_PW_ID)
                report(`${at}.pw_id ${id}: write a whole number from 1 to ${PseudowireChecks.MAX_PW_ID}, the same at both ends`);

            if (mtu !== undefined && (!Number.isInteger(mtu) || mtu < 1 || mtu > PseudowireChecks.MAX_MTU))
                report(`${at}.mtu ${mtu}: write a whole number of bytes from 1 to ${PseudowireChecks.MAX_MTU}, the same at both ends`);

            const key = `${peer} ${id}`;
            const other = seen.get(key);
            if (other)
                report(
                    `${at} has pw_id ${id} to ${peer}, as interfaces.pseudowire.${other} has. Give each pseudowire to one peer its own pw_id`
                );
            else seen.set(key, name);
        }
    }
}
