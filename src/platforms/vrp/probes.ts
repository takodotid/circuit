// ICMP probes on VRP, which Huawei calls NQA (RFC 4560's ping test): an ICMP test of Circuit's own administrator, named after the probe, started at once. A CE6855 on V200R005C00SPC800 committed them, and ran them (TRAPS.md).

import { Address } from "../../core/address";
import type { Device } from "../../model";
import { LineDiff } from "../line-diff";
import type { Dialect, Group } from "../line-diff";

export class VrpProbes {
    /** The administrator every test of Circuit's is under, `nqa test-instance circuit <name>`. */
    private static readonly ADMIN = "circuit";

    /** A test name the switch takes: it refused a `-` ("includes invalid character"), and a name of 36 characters. */
    private static readonly NAME = /^[A-Za-z0-9_]{1,32}$/;

    private static readonly HEADER = `nqa test-instance ${VrpProbes.ADMIN} `;

    /** The line that runs a test, from now on. */
    private static readonly START = "start now";

    /** Each probe's test: ICMP to its target, from its source, in its VRF, every `interval` seconds, started now. */
    static lines(device: Device): string[] {
        const lines: string[] = [];

        for (const [name, probe] of Object.entries(device.monitoring?.probes ?? {})) {
            const body = ["test-type icmp", `destination-address ipv4 ${probe.target}`];
            if (probe.source_address) body.push(`source-address ipv4 ${probe.source_address}`);
            if (probe.vrf) body.push(`vpn-instance ${probe.vrf}`);
            body.push(`frequency ${probe.interval}`, VrpProbes.START);
            lines.push(`${VrpProbes.HEADER}${name}`, ...body.map((line) => ` ${line}`), "#");
        }

        return lines;
    }

    /** What the switch can't probe as the config says. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const [name, probe] of Object.entries(device.monitoring?.probes ?? {})) {
            const where = `monitoring.probes.${name}`;
            if (!VrpProbes.NAME.test(name))
                found.push(`${where}, a test name of letters, digits, and '_', 32 characters at most: the switch refuses a '-'`);
            for (const [field, address] of [
                ["target", probe.target],
                ["source_address", probe.source_address],
            ] as const)
                if (address && Address.family(address) === "ipv6") found.push(`${where}.${field}, IPv6 is not tested`);
        }

        return found;
    }

    /**
     * A running test can't change without a question, and can't be deleted at all: "The test is in progress, and it cannot be deleted". So a test that changes is stopped first and started again last, and one that goes is stopped, then deleted after every other step. Gives the tests to delete.
     */
    static order(groups: Group[], desired: string, current: string, dialect: Dialect): string[] {
        const headers = (text: string) =>
            new Set(
                LineDiff.entries(text, dialect).flatMap((entry) =>
                    !entry.path.length && entry.line.startsWith(VrpProbes.HEADER) ? [entry.line] : []
                )
            );
        const wanted = headers(desired);
        const had = headers(current);
        const top = groups.find((group) => group.path.length === 0);
        const gone = top?.remove.filter((line) => had.has(line) && !wanted.has(line)) ?? [];

        if (top) top.remove = top.remove.filter((line) => !gone.includes(line));
        for (const header of gone) groups.push({ path: [header], remove: [VrpProbes.START], add: [] });

        for (const group of groups) {
            const [header, ...deeper] = group.path;
            if (!header || deeper.length || !wanted.has(header) || !had.has(header)) continue;
            if (!group.add.length && !group.remove.length) continue;

            group.remove = [VrpProbes.START, ...group.remove.filter((line) => line !== VrpProbes.START)];
            group.add = [...group.add.filter((line) => line !== VrpProbes.START), VrpProbes.START];
        }

        return gone;
    }

    /** `start now` is undone as `undo start`, and a setting by its keyword. Undefined for any other line. */
    static undo(line: string, path: readonly string[]): string | undefined {
        if (!path[0]?.startsWith(VrpProbes.HEADER)) return undefined;
        if (line === VrpProbes.START) return "undo start";
        // `undo source-address ipv4` is `Too many parameters`.
        const keyword = /^(source-address|vpn-instance) /.exec(line);
        return keyword ? `undo ${keyword[1]}` : undefined;
    }
}
