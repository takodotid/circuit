// Virtual domains: a management VDOM beside `root`. In multi-VDOM mode some sections are the device's own, under `config global`, and the rest belong to one VDOM, under `config vdom` and `edit <name>`. The render and the read write a management VDOM's sections as `@<name> <section>`, so both sides compare like any other section; a plan is made for each scope on its own, and each of its steps sent in that scope.

import type { Device } from "../../model";
import { Derive } from "../derive";
import type { Plan, Step } from "../platform";
import { FortiOsNames } from "./names";
import { FortiOsBlock, FortiOsTree } from "./tree";

/** Where a section lives in multi-VDOM mode: the device's own, or one VDOM's. */
type Scope = { kind: "global" } | { kind: "vdom"; vdom: string };

export class FortiOsVdoms {
    /** The VDOM everything is in unless named otherwise. */
    static readonly ROOT = "root";

    /**
     * Sections under `config global` in multi-VDOM mode, as a FG-3700D on FortiOS 6.2.2 has them: the device's identity, logins,
     * interfaces, name resolution, time, SNMP, syslog, flow export and session helpers. Every other section belongs to a VDOM, the
     * certificates and `log disk setting` too.
     */
    static readonly GLOBAL = new Set([
        "system global",
        'system replacemsg admin "pre_admin-disclaimer-text"',
        "system accprofile",
        "system admin",
        "system interface",
        "system dns",
        "system ntp",
        "system snmp sysinfo",
        "system snmp community",
        "system snmp user",
        ...["", "2", "3", "4"].flatMap((number) => [`log syslogd${number} setting`, `log syslogd${number} filter`]),
        "system sflow",
        "system netflow",
        "system session-helper",
    ]);

    /** What a management VDOM holds: its routes, and who reaches the device's own services through it, with the objects those name. */
    static readonly MANAGEMENT_SECTIONS = [
        "firewall address",
        "firewall address6",
        "firewall addrgrp",
        "firewall addrgrp6",
        "firewall service custom",
        "router static",
        "router static6",
        "firewall local-in-policy",
        "firewall local-in-policy6",
    ] as const;

    /** The management VDOM's name, when the device has one. */
    static managementOf(device: Device): string | undefined {
        return device.system?.vdoms?.management.name;
    }

    /** The VDOM a port or interface is in, by Circuit's name. A port in a LAG is where its LAG is. */
    static vdomOf(device: Device, name: string): string {
        const management = device.system?.vdoms?.management;
        if (!management) return FortiOsVdoms.ROOT;

        const lag = device.interfaces?.ethernet?.[name]?.in_lag;
        const holder = lag ?? name;
        return (management.interfaces as readonly string[]).includes(holder) ? management.name : FortiOsVdoms.ROOT;
    }

    /** A management VDOM's section as the render and the read write it. */
    static key(vdom: string, section: string): string {
        return `@${vdom} ${section}`;
    }

    /** A section's scope, and its name as the device writes it. */
    static scopeOf(key: string): { scope: Scope; section: string } {
        const named = /^@(\S+) (.+)$/.exec(key);
        if (named) return { scope: { kind: "vdom", vdom: named[1]! }, section: named[2]! };

        return FortiOsVdoms.GLOBAL.has(key)
            ? { scope: { kind: "global" }, section: key }
            : { scope: { kind: "vdom", vdom: FortiOsVdoms.ROOT }, section: key };
    }

    /** Whether a configuration runs in multi-VDOM mode. */
    static isMulti(tree: FortiOsBlock): boolean {
        return tree.blocks.get("system global")?.settings.get("vdom-mode") === "multi-vdom";
    }

    /** Lines sent in a scope: inside `config global`, or inside one VDOM. */
    static wrap(scope: Scope, lines: readonly string[]): string[] {
        return scope.kind === "global"
            ? ["config global", ...lines, "end"]
            : ["config vdom", `edit ${scope.vdom}`, ...lines, "next", "end"];
    }

    /** What `show` printed in a management VDOM, each top-level section named as the render names it. */
    static named(vdom: string, text: string): string {
        return text.replace(/^config /gm, `config @${vdom} `);
    }

    /** The VDOMs `diagnose sys vd list` names, such as `name=mgmt/mgmt index=1`. */
    static listed(text: string): string[] {
        return [...text.matchAll(/^name=([^/\s]+)\//gm)].map((match) => match[1]!);
    }

    /**
     * A plan for a device that may run in multi-VDOM mode. In one VDOM it is `planOne` as it is. In several, each scope is planned on its own and its steps sent in that scope: the global steps first, then each VDOM's, then the global removals, so an interface is gone only once no VDOM names it.
     *
     * Turning multi-VDOM mode on or off, and moving an interface into another VDOM, are left to an operator: the first moves everything into `root` and ends every session, and the second can cut the way in. A plan that needs either holds only the problem.
     */
    static plan(desired: string, current: string, planOne: (desired: string, current: string) => Plan): Plan {
        const want = FortiOsTree.parse(desired);
        const have = FortiOsTree.parse(current);
        const wantMulti = FortiOsVdoms.isMulti(want);
        const haveMulti = FortiOsVdoms.isMulti(have);

        const refused = (problem: string): Plan => ({ steps: [], problems: [problem] });

        if (wantMulti && !haveMulti) {
            return refused(
                "the config has vdoms and the device runs one VDOM. Turn multi-VDOM mode on by hand: `config system global`, `set vdom-mode multi-vdom`, `end`, then `y`. It moves everything into root and logs every session out; the traffic keeps flowing"
            );
        }
        if (!wantMulti && haveMulti) {
            return refused(
                "the device runs several VDOMs and the config has no vdoms. Write system.vdoms.management, or turn multi-VDOM mode off by hand"
            );
        }
        if (!wantMulti) return planOne(desired, current);

        const moved = FortiOsVdoms.moved(want, have);
        if (moved.length) {
            return refused(
                `${moved.map(({ name, from, to }) => `${name} from ${from} to ${to}`).join(", ")}: move an interface into another VDOM by hand, from a session on another interface or the console, since it may carry the way in`
            );
        }

        const scopes = new Map<string, { scope: Scope; want: FortiOsBlock; have: FortiOsBlock }>();
        const scopeFor = (scope: Scope) => {
            const name = scope.kind === "global" ? "" : scope.vdom;
            if (!scopes.has(name)) scopes.set(name, { scope, want: new FortiOsBlock(), have: new FortiOsBlock() });
            return scopes.get(name)!;
        };

        for (const [side, tree] of [
            ["want", want],
            ["have", have],
        ] as const) {
            for (const [key, block] of tree.blocks) {
                const { scope, section } = FortiOsVdoms.scopeOf(key);
                scopeFor(scope)[side].blocks.set(section, block);
            }
        }

        const global = scopes.get("");
        const globalPlan: Plan = global
            ? planOne(FortiOsTree.print(global.want), FortiOsTree.print(global.have))
            : { steps: [], problems: [] };
        const inScope = (scope: Scope, step: Step): Step => ({ ...step, send: FortiOsVdoms.wrap(scope, step.send) });
        const removal = (step: Step) => step.title.endsWith(", removed");

        const vdomPlans = [...scopes.values()]
            .filter(({ scope }) => scope.kind === "vdom")
            .map(({ scope, want: wanted, have: had }) => ({ scope, plan: planOne(FortiOsTree.print(wanted), FortiOsTree.print(had)) }));
        const vdomSteps = vdomPlans.flatMap(({ scope, plan }) =>
            plan.steps.map((step) => inScope(scope, { ...step, title: `${scope.kind === "vdom" ? scope.vdom : ""}: ${step.title}` }))
        );

        return {
            problems: [...globalPlan.problems, ...vdomPlans.flatMap(({ plan }) => plan.problems)],
            steps: [
                ...globalPlan.steps.filter((step) => !removal(step)).map((step) => inScope({ kind: "global" }, step)),
                ...vdomSteps,
                ...globalPlan.steps.filter(removal).map((step) => inScope({ kind: "global" }, step)),
            ],
        };
    }

    /** Interfaces the config puts in another VDOM than the device has them in. */
    private static moved(want: FortiOsBlock, have: FortiOsBlock): { name: string; from: string; to: string }[] {
        const wanted = want.blocks.get("system interface");
        const had = have.blocks.get("system interface");
        if (!wanted || !had) return [];

        return [...wanted.entries.entries()].flatMap(([name, { block }]) => {
            const from = had.entries.get(name)?.block.settings.get("vdom");
            const to = block.settings.get("vdom");
            return from && to && FortiOsTree.bare(from) !== FortiOsTree.bare(to)
                ? [{ name, from: FortiOsTree.bare(from), to: FortiOsTree.bare(to) }]
                : [];
        });
    }

    /** What makes a management VDOM wrong, whatever the platform can express: it is not `root`, it lists a LAG rather than its ports, and each of its routes has a next hop and leaves through one of its interfaces. */
    static problems(device: Device): string[] {
        const management = device.system?.vdoms?.management;
        if (!management) return [];

        const found: string[] = [];
        const where = "system.vdoms.management";

        if (management.name === FortiOsVdoms.ROOT)
            found.push(`${where}.name is root, the VDOM everything else is in; give it a name of its own`);

        for (const name of management.interfaces) {
            const lag = device.interfaces?.ethernet?.[name]?.in_lag;
            if (lag) found.push(`${where}.interfaces ${name} is in LAG ${lag}; list the LAG`);
        }

        for (const route of management.static_routes ?? []) {
            const at = `${where}.static_routes ${route.prefix}`;
            if (!route.next_hop && !route.interface && !route.blackhole) found.push(`${at} has no next hop`);
            if (route.interface && !(management.interfaces as readonly string[]).includes(route.interface))
                found.push(`${at} leaves through ${route.interface}, which is not in the VDOM`);
        }

        return found;
    }

    /** What a management VDOM can't hold yet, or a config with one can't have. */

    static gaps(device: Device): string[] {
        const management = device.system?.vdoms?.management;
        if (!management) return [];

        const found: string[] = [];
        const tunnels = FortiOsNames.interfacesOf(device).filter(({ kind }) => kind === "gre" || kind === "vxlan");
        if (tunnels.length)
            found.push(
                `system.vdoms with GRE or VXLAN tunnels (${tunnels.map(({ name }) => name).join(", ")}), whose tables belong to a VDOM`
            );
        if (FortiOsNames.isTransparent(device)) found.push("system.vdoms with a bridge, which needs transparent mode");

        const inManagement = (name: string | undefined) =>
            name !== undefined && (management.interfaces as readonly string[]).includes(name);

        for (const route of device.routing?.static_routes ?? []) {
            if (inManagement(route.interface))
                found.push(
                    `routing.static_routes ${route.prefix} leaves through ${route.interface}, in system.vdoms.management; write it in its static_routes`
                );
        }
        for (const name of management.interfaces) {
            const vrf = Derive.settings(device, name)?.vrf;
            if (vrf) found.push(`system.vdoms.management interface ${name} in VRF ${vrf}`);
        }

        return found;
    }
}
