import type { Device } from "../../model";
import type { JunosNames } from "./names";
import type { JunosStatements } from "./statements";

/** MPLS and LDP in the main instance. LDP knows the device by its router ID, so `unsupported()` requires the LSR ID to be the router ID. */
export class JunosMpls {
    static render(out: JunosStatements, device: Device, names: JunosNames): void {
        const ldp = device.routing?.mpls?.ldp;
        if (!ldp) return;

        for (const name of ldp.interfaces) {
            const unit = names.unit(name);
            const dot = unit.lastIndexOf(".");
            out.set("interfaces", unit.slice(0, dot), "unit", unit.slice(dot + 1), "family mpls");
            out.set("protocols mpls interface", unit);
            out.set("protocols ldp interface", unit);
        }
    }

    /** Junos has no LSR ID of its own for LDP in the main instance: it is the router ID. Targeted LDP and LDP's policies, the device's and its neighbors', wait for a router that runs MPLS. */
    static unsupported(device: Device): string[] {
        const ldp = device.routing?.mpls?.ldp;
        if (!ldp) return [];

        const found = (["targets", "import_policy", "export_policy", "neighbors"] as const)
            .filter((key) => ldp[key] !== undefined)
            .map((key) => `routing.mpls.ldp.${key}, not built for Junos yet: its MPLS is experimental, untested on a router that runs it`);
        if (ldp.lsr_id !== device.routing?.router_id)
            found.push(
                `routing.mpls.ldp.lsr_id ${ldp.lsr_id}, Junos takes the LSR ID from routing.router_id: write the same address in both`
            );
        return found;
    }
}
