---
description: Write a targets file for Prometheus and a credentials file for the SNMP exporter, from the devices in your project.
---

# Prometheus

[Prometheus](https://prometheus.io) collects numbers over time, such as how much traffic each port carries. It reads network devices through the [SNMP exporter](https://github.com/prometheus/snmp_exporter), which asks each device over SNMP.

Your project already lists every device, its address, and its SNMP credentials. `circuit sync prometheus` turns that into two files in your project, so you don't keep a second list of devices:

1. **The targets file**, the list of devices for Prometheus.
2. **The `auths` file**, the credentials for the SNMP exporter.

Neither file holds a secret, so you commit and review them like any other change. Deploy them to the monitoring host as you deploy anything else. [How sync works](/integrations/) explains the plan, CI, and several networks.

## Before you start

1. **Turn SNMP on** in each device's file, with `monitoring.snmp`. Give it a version 3 user. Circuit leaves out a device without SNMP, and the plan says so.
2. **Let the SNMP exporter reach SNMP.** Put its address in `management.allow`, or in `monitoring.snmp.allow` for SNMP only.

## Set it up

In `circuit.ts`, say where the two files go, relative to the project:

```ts
integrations: {
    prometheus: { targets: "monitoring/targets.json", auths: "monitoring/snmp-auths.yml" },
},
```

You can leave out `auths` if you write the SNMP exporter's credentials yourself.

## Write the files

```sh
circuit sync prometheus             # shows the lines that would change, then asks
circuit sync prometheus --confirm   # writes without asking
```

A new file shows every line with `+`. A file that differs shows the lines that go (`-`) and the lines that come (`+`). Run it again after you add or change a device.

## The targets file

It has one entry for each device with SNMP and a `connection.host`, in the format Prometheus reads with `file_sd_configs`:

```json
[
    {
        "targets": ["192.0.2.1"],
        "labels": {
            "device": "edge-01",
            "platform": "routeros",
            "model": "CCR2216-1G-12XS-2XQ",
            "__param_auth": "edge-01"
        }
    }
]
```

- `device` is the name from your project, so a graph says `edge-01`, not an address.
- `__param_auth` tells the SNMP exporter to use the device's own auth, from the `auths` file.

Point Prometheus at the file. It notices when the file changes, without a restart.

```yaml
# prometheus.yml
scrape_configs:
    - job_name: network
      metrics_path: /snmp
      params:
          module: [if_mib] # what to read: the traffic and status of every port
      file_sd_configs:
          - files: [/etc/prometheus/targets.json]
      relabel_configs:
          # Ask the SNMP exporter, at 127.0.0.1:9116, about each device in the list.
          - source_labels: [__address__]
            target_label: __param_target
          - source_labels: [__param_target]
            target_label: instance
          - target_label: __address__
            replacement: 127.0.0.1:9116
```

## The `auths` file

It has one auth for each device, named after it, with the device's first SNMP version 3 user:

```yaml
# Written by `circuit sync prometheus`. Load it beside snmp.yml, with --config.expand-environment-variables.
auths:
    edge-01:
        version: 3
        username: monitor
        security_level: authPriv
        password: ${EDGE_01_SNMP_AUTH}
        auth_protocol: SHA
        priv_protocol: AES
        priv_password: ${EDGE_01_SNMP_PRIVACY}
```

`${EDGE_01_SNMP_AUTH}` is the name of the secret, from `secret("EDGE_01_SNMP_AUTH")`. If the SNMP exporter starts with `--config.expand-environment-variables`, it fills in the value from its environment:

```sh
snmp_exporter \
    --config.file=/etc/snmp_exporter/snmp.yml \
    --config.file=/etc/snmp_exporter/snmp-auths.yml \
    --config.expand-environment-variables
```

The values are in your [secrets file](/guide/secrets), encrypted, so the monitoring host needs them in its environment. There are two ways to put them there:

1. **From your secrets, when you deploy.** `circuit secrets get EDGE_01_SNMP_AUTH` prints one value. Your deploy step writes each value into an environment file that only the exporter's user can read, such as systemd's `EnvironmentFile=`.
2. **From 1Password.** If the values are in [1Password](/integrations/1password), write an environment file of references, such as `EDGE_01_SNMP_AUTH=op://Network/edge-01/snmp-auth`. Then start the exporter with `op run --env-file=<that file> -- snmp_exporter ...`.

A device with only an SNMP version 2c community gets `community: FILL_IN`, and the plan says so. The SNMP exporter can't read a community from its environment, and Circuit never writes a secret's value. So write the community in where you deploy the file, or better, give the device a version 3 user. The same goes for a password kept in a file with `secretFile()`.
