# Prometheus

[Prometheus](https://prometheus.io) collects numbers over time, such as how much traffic each port carries, and [Grafana](https://grafana.com) draws them. Prometheus reads network devices through the [SNMP exporter](https://github.com/prometheus/snmp_exporter), which asks each device over SNMP.

Your config already lists every device and its address. `circuit prometheus` turns that into the list of devices Prometheus asks, so a device you add to the config is monitored without a second list to keep up to date.

## Before you start

1. **Turn SNMP on** in each device's config, with `management.snmp`. A device without it is left out, and `circuit prometheus` says so.
2. **Allow the SNMP exporter's address** to reach SNMP: in `management.allow`, or in `management.snmp.allow` for SNMP alone.
3. **Give the SNMP exporter the same credentials** as your devices, in the `auths` section of its `snmp.yml`. Circuit does not write that file, because it would hold your secrets.

## Make the target list

```bash
npx circuit prometheus > /etc/prometheus/circuit-targets.json
```

It prints one entry per device, in the format Prometheus reads with `file_sd_configs`:

```json
[
    {
        "targets": ["10.0.0.1"],
        "labels": { "device": "edge-01", "platform": "routeros", "model": "CCR2216-1G-12XS-2XQ" }
    }
]
```

The `device` label carries the name from your config, so a graph says `edge-01`, not an address.

Run it again after every change to your devices. Prometheus notices the file has changed on its own; it does not need a restart. Run it from the same schedule as your [refresh](/guide/scheduled-refresh) if you like.

## Tell Prometheus to use it

```yaml
# prometheus.yml
scrape_configs:
    - job_name: network
      metrics_path: /snmp
      params:
          module: [if_mib]
          auth: [circuit]
      file_sd_configs:
          - files: [/etc/prometheus/circuit-targets.json]
      relabel_configs:
          # Ask the SNMP exporter, at 127.0.0.1:9116, about each device in the list.
          - source_labels: [__address__]
            target_label: __param_target
          - source_labels: [__param_target]
            target_label: instance
          - target_label: __address__
            replacement: 127.0.0.1:9116
```

`module` is what to read; `if_mib` is every port's traffic and status. `auth` is the name you gave your devices' credentials in `snmp.yml`.
