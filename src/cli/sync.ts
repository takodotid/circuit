// `circuit sync <target>`: picks the target, puts together the networks that use the same system, and unlocks the secrets it needs. For each system it reads, prints the plan, asks, sends, then reads and plans again. The targets in src/integrations only read, plan and send.

import { Secrets } from "../core/secrets";
import type { Device } from "../model";
import { LibreNms } from "../integrations/librenms";
import { NetBox } from "../integrations/netbox";
import { PeeringDb } from "../integrations/peeringdb";
import { Prometheus } from "../integrations/prometheus";
import type { SyncNetwork, SyncPlan, SyncTarget } from "../integrations/sync";
import { type ProjectNetwork, type ProjectRead, Project } from "../project";
import { Remember } from "./remember";
import { SecretsPassword } from "./secrets-password";
import { type Choice, Ui } from "./ui";

export type SyncTargetName = (typeof SyncCommand.TARGETS)[number];

/** How a sync ended: `matches` and `sent` and `declined` exit 0; `not-sent` and `left` exit 1. */
export type SyncOutcome = "matches" | "declined" | "not-sent" | "sent" | "left";

/** Whether to send without asking, whether a person can answer, and how to ask them. */
export type SyncAnswers = {
    /** `--confirm`: send without asking. */
    confirmed: boolean;
    /** A person is at a terminal. */
    interactive: boolean;
    /** Ask a yes or no question, No by default. */
    ask: (question: string) => Promise<boolean>;
};

export class SyncCommand {
    /** The targets, in the order Circuit lists them. */
    static readonly TARGETS = ["netbox", "librenms", "peeringdb", "prometheus"] as const;

    /** Each target's name as people write it, and what it sends, for the list. */
    private static readonly LABELS: Record<SyncTargetName, { label: string; hint: string }> = {
        netbox: { label: "NetBox", hint: "devices, ports, VLANs, addresses, and cables" },
        librenms: { label: "LibreNMS", hint: "the devices to monitor, with SNMP settings and sites" },
        peeringdb: { label: "PeeringDB", hint: "your exchange presence" },
        prometheus: { label: "Prometheus", hint: "the targets and snmp_exporter auths files" },
    };

    /** How each target is set in `circuit.ts`, for a message. */
    private static readonly EXAMPLES: Record<SyncTargetName, string> = {
        netbox: 'netbox: { url: "https://netbox.example.com", api_token: secret("NETBOX_API_TOKEN") }',
        librenms: 'librenms: { url: "https://librenms.example.com", api_token: secret("LIBRENMS_API_TOKEN") }',
        peeringdb: 'peeringdb: { api_key: secret("PEERINGDB_API_KEY") }',
        prometheus: 'prometheus: { targets: "monitoring/targets.json", auths: "monitoring/snmp-auths.yml" }',
    };

    /** Keep the target in sync with the project: each group of networks naming the same system in turn. Exits 1 when something was not sent, or is still left. */
    static async run(root: string, project: ProjectRead, given: string | undefined, confirmed: boolean): Promise<void> {
        const name = await SyncCommand.pick(project, given);
        const outcomes: SyncOutcome[] = [];

        for (const networks of SyncCommand.groups(project, name)) {
            await SyncCommand.unlock(networks, name);

            const synced = networks.map(SyncCommand.syncNetwork);
            let target: SyncTarget;
            try {
                target = SyncCommand.target(root, name, synced);
            } catch (error) {
                Ui.fail((error as Error).message);
            }

            try {
                outcomes.push(
                    await SyncCommand.apply(target, { confirmed, interactive: Ui.interactive, ask: (question) => Ui.confirm(question) })
                );
            } catch (error) {
                Ui.fail(`${target.where}: ${(error as Error).message}`);
            }
        }

        if (outcomes.some((outcome) => outcome === "not-sent" || outcome === "left")) process.exitCode = 1;
    }

    /** The target named, or one a person picks; a script must name it. */
    private static async pick(project: ProjectRead, given: string | undefined): Promise<SyncTargetName> {
        const all = SyncCommand.TARGETS.join(", ").replace(/, (\w+)$/, ", or $1");
        const isSet = (name: SyncTargetName) => project.networks.some((network) => network.settings.integrations?.[name]);

        if (given !== undefined) {
            const name = SyncCommand.TARGETS.find((target) => target === given) ?? Ui.fail(`No target ${given}. Give one of: ${all}.`);
            if (!isSet(name))
                Ui.fail(
                    `No network in circuit.ts sets integrations.${name}. Write it in circuit({ integrations }), such as ${SyncCommand.EXAMPLES[name]}.`
                );
            return name;
        }

        if (!Ui.interactive) Ui.fail(`Give the target: ${all}.`);
        if (!SyncCommand.TARGETS.some(isSet))
            Ui.fail(
                `No network in circuit.ts sets integrations. Write them in circuit({ integrations }), such as ${SyncCommand.EXAMPLES.netbox}.`
            );

        const choices: Choice<SyncTargetName>[] = SyncCommand.TARGETS.map((name) => ({
            value: name,
            label: SyncCommand.LABELS[name].label,
            hint: isSet(name) ? SyncCommand.LABELS[name].hint : "not set in circuit.ts",
            disabled: !isSet(name),
        }));
        return Ui.select("Which system?", choices);
    }

    /** The plan as the lines Circuit prints: the changes, the counts, then what is left alone. */
    static text(heading: string, plan: SyncPlan): string[] {
        const lines: string[] = [];

        if (plan.changes.length) {
            lines.push(Ui.bold(`${heading}: ${plan.changes.length} change(s)`));

            for (const change of plan.changes) {
                const paint = change.sign === "+" ? Ui.green : change.sign === "-" ? Ui.red : Ui.yellow;
                lines.push(`  ${paint(change.sign)} ${change.what}`);
                for (const detail of change.details) lines.push(`      ${detail}`);
            }

            if (plan.summary.length) lines.push("", ...plan.summary.map((line) => `  ${line}`));
        }

        if (plan.leftAlone.length) {
            if (lines.length) lines.push("");
            lines.push("Left alone:", ...plan.leftAlone.map((line) => `  ${line}`));
        }

        return lines;
    }

    /** Read, plan, print, ask, send, then read and plan again. Returns how it ended; the caller sets the exit code. */
    static async apply<P extends SyncPlan>(target: SyncTarget<P>, answers: SyncAnswers): Promise<SyncOutcome> {
        const plan = await Ui.step(`Reading ${target.where}`, () => target.plan());
        const lines = SyncCommand.text(target.heading, plan);
        if (lines.length) console.log(`\n${lines.join("\n")}\n`);

        if (!plan.changes.length) {
            Ui.done(`${target.name} already matches the project.`);
            return "matches";
        }

        if (!answers.confirmed) {
            if (!answers.interactive) {
                console.error(Ui.red("Not sent. Without a terminal, add --confirm to send.", process.stderr));
                return "not-sent";
            }
            if (!(await answers.ask(`Send these changes to ${target.name}?`))) {
                console.log("Nothing sent.");
                return "declined";
            }
        }

        await Ui.step(`Sending the changes to ${target.name}`, () => target.send(plan));

        const left = await Ui.step(`Reading ${target.where} again`, () => target.plan());
        if (left.changes.length) {
            console.log(`\n${SyncCommand.text(target.heading, left).join("\n")}\n`);
            console.error(Ui.red(`Sent, but ${target.name} still differs from the project as shown above.`, process.stderr));
            return "left";
        }

        Ui.done(`${target.name} matches the project now.`);
        return "sent";
    }

    /** The networks that set the target, put together when they name the same system: the same NetBox or LibreNMS, the same AS, the same files. */
    static groups(project: ProjectRead, name: SyncTargetName): ProjectNetwork[][] {
        const setting = (network: ProjectNetwork) => network.settings.integrations?.[name];
        const groups = new Map<string, ProjectNetwork[]>();

        if (name === "peeringdb") {
            // Every network of the AS counts, so one without the key isn't taken for a presence the project doesn't have. The one with the key comes first.
            for (const network of project.networks.filter(setting)) {
                if (network.asn === undefined) Ui.fail(`${network.name}: integrations.peeringdb needs asn in circuit.ts.`);

                const key = String(network.asn);
                if (!groups.has(key))
                    groups.set(key, [network, ...project.networks.filter((other) => other !== network && other.asn === network.asn)]);
            }
            return [...groups.values()];
        }

        for (const network of project.networks.filter(setting)) {
            const settings = setting(network);
            const key = name === "prometheus" ? `${settings.targets} ${settings.auths ?? ""}` : String(settings.url).replace(/\/+$/, "");
            groups.set(key, [...(groups.get(key) ?? []), network]);
        }

        return [...groups.values()];
    }

    /** Open each network's secrets file when what the target needs is encrypted in it: its token, and for LibreNMS each device's SNMP secrets. */
    private static async unlock(networks: readonly ProjectNetwork[], name: SyncTargetName): Promise<void> {
        if (name === "prometheus") return;

        for (const network of networks) {
            const devices = Object.values(network.devices);
            const needed = [
                network.settings.integrations?.[name],
                name === "librenms" ? devices.map((device) => device.monitoring?.snmp) : [],
            ];

            Secrets.useFile(Project.secretsFile(network));
            await SecretsPassword.unlock(Secrets.lockedFor(needed));
        }

        await Remember.offer();
    }

    /** A network as the sync targets read it, its secrets read from its own file. */
    private static syncNetwork(network: ProjectNetwork): SyncNetwork {
        const file = Project.secretsFile(network);
        const devices: Device[] = Object.values(network.devices);

        return {
            name: network.name,
            ...(network.asn === undefined ? {} : { asn: network.asn }),
            sites: network.settings.sites ?? {},
            integrations: network.settings.integrations ?? {},
            devices,
            reveal: (secret) => {
                if (Secrets.file().name !== file) Secrets.useFile(file);
                return Secrets.reveal(secret);
            },
        };
    }

    private static target(root: string, name: SyncTargetName, networks: SyncNetwork[]): SyncTarget {
        if (name === "netbox") return new NetBox(networks);
        if (name === "librenms") return new LibreNms(networks);
        if (name === "peeringdb") return new PeeringDb(networks);
        return new Prometheus(root, networks);
    }
}
