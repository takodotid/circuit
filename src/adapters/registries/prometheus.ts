// Prometheus targets for snmp_exporter, in its file-based discovery format: one entry per device that answers SNMP, labelled with what the config knows about it.

import type { Network } from "../../core/define";
import type { Device } from "../../schema";

export type PrometheusTarget = { targets: string[]; labels: Record<string, string> };

/** The targets, and the devices left out because their config turns SNMP off. */
export function prometheusTargets(network: Network): { targets: PrometheusTarget[]; withoutSnmp: Device[] } {
    return {
        targets: network.devices
            .filter((device) => device.management?.snmp)
            .map((device) => ({
                targets: [device.connection.host],
                labels: { device: device.name, platform: device.platform, model: device.model },
            })),
        withoutSnmp: network.devices.filter((device) => !device.management?.snmp),
    };
}
