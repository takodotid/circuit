// `circuit sync <target>`: picks the target, puts together the networks that name the same system, unlocks the secrets it needs, and runs each through `Sync.run`.

import { Secrets } from "../core/secrets";
import type { Device } from "../model";
import { LibreNms } from "../integrations/librenms";
import { NetBox } from "../integrations/netbox";
import { PeeringDb } from "../integrations/peeringdb";
import { Prometheus } from "../integrations/prometheus";
import { Sync, type SyncNetwork, type SyncOutcome, type SyncTarget } from "../integrations/sync";
import { type ProjectNetwork, type ProjectRead, secretsFileOf } from "../project/project";
import { Remember } from "./remember";
import { SecretsPassword } from "./secrets-password";
import { type Choice, Ui } from "./ui";

export type SyncTargetName = (typeof Sync.TARGETS)[number];

export class SyncCommand {
    /** Each target's name as people write it, and what it sends, for the list. */
    private static readonly LABELS: Record<SyncTargetName, { label: string; hint: string }> = {
        netbox: { label: "NetBox", hint: "devices, ports, VLANs, addresses and cables" },
        librenms: { label: "LibreNMS", hint: "every device monitored, with its SNMP settings and site" },
        peeringdb: { label: "PeeringDB", hint: "your exchange presence" },
        prometheus: { label: "Prometheus", hint: "the targets and snmp_exporter auths files, in the project" },
    };

    /** How each target is set in `circuit.ts`, for a message. */
    private static readonly EXAMPLES: Record<SyncTargetName, string> = {
        netbox: 'netbox: { url: "https://netbox.example.com", api_token: secret("NETBOX_API_TOKEN") }',
        librenms: 'librenms: { url: "https://librenms.example.com", api_token: secret("LIBRENMS_API_TOKEN") }',
        peeringdb: 'peeringdb: { api_key: secret("PEERINGDB_API_KEY") }',
        prometheus: 'prometheus: { targets: "monitoring/targets.json", auths: "monitoring/snmp-auths.yml" }',
    };

    /** Keep the target in step with the project: each group of networks naming the same system in turn. Exits 1 when something was not sent, or is still left. */
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
                outcomes.push(await Sync.run(target, { confirmed, interactive: Ui.interactive, ask: (question) => Ui.confirm(question) }));
            } catch (error) {
                Ui.fail(`${target.where}: ${(error as Error).message}`);
            }
        }

        if (outcomes.some((outcome) => outcome === "not-sent" || outcome === "left")) process.exitCode = 1;
    }

    /** The target named, or one a person picks; a script must name it. */
    private static async pick(project: ProjectRead, given: string | undefined): Promise<SyncTargetName> {
        const all = Sync.TARGETS.join(", ").replace(/, (\w+)$/, " or $1");
        const isSet = (name: SyncTargetName) => project.networks.some((network) => network.settings.integrations?.[name]);

        if (given !== undefined) {
            const name = Sync.TARGETS.find((target) => target === given) ?? Ui.fail(`No target ${given}. Name the target: ${all}.`);
            if (!isSet(name))
                Ui.fail(
                    `No network in circuit.ts sets integrations.${name}. Write it in circuit({ integrations }), such as ${SyncCommand.EXAMPLES[name]}.`
                );
            return name;
        }

        if (!Ui.interactive) Ui.fail(`Name the target: ${all}.`);
        if (!Sync.TARGETS.some(isSet))
            Ui.fail(
                `No network in circuit.ts sets integrations. Write them in circuit({ integrations }), such as ${SyncCommand.EXAMPLES.netbox}.`
            );

        const choices: Choice<SyncTargetName>[] = Sync.TARGETS.map((name) => ({
            value: name,
            label: SyncCommand.LABELS[name].label,
            hint: isSet(name) ? SyncCommand.LABELS[name].hint : "not set in circuit.ts",
            disabled: !isSet(name),
        }));
        return Ui.select("Which system?", choices);
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

            Secrets.useFile(secretsFileOf(network));
            await SecretsPassword.unlock(Secrets.lockedFor(needed));
        }

        await Remember.offer();
    }

    /** A network as the sync targets read it, its secrets read from its own file. */
    private static syncNetwork(network: ProjectNetwork): SyncNetwork {
        const file = secretsFileOf(network);
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
