# Prometheus

[Prometheus](https://prometheus.io) collects numbers over time, such as how much traffic each port carries, and [Grafana](https://grafana.com) draws them. Prometheus reads network devices through the [SNMP exporter](https://github.com/prometheus/snmp_exporter), which asks each device over SNMP.

Your config already lists every device, its address and its SNMP credentials. Circuit turns that into the two things the SNMP exporter and Prometheus need, so a device you add to the config is monitored without a second list to keep up to date:

1. **The credentials**, for the SNMP exporter.
2. **The list of devices**, for Prometheus.

## Before you start

1. **Turn SNMP on** in each device's config, with `management.snmp`. Give it a version 3 user, with authentication and encryption. A device without SNMP is left out.
2. **Allow the SNMP exporter's address** to reach SNMP: in `management.allow`, or in `management.snmp.allow` for SNMP alone.

## The credentials

```bash
npx circuit prometheus --auths > /etc/snmp_exporter/circuit-auths.yml
```

It writes one auth for each device, named after the device, with its SNMP version 3 user:

```yaml
# Written by `circuit prometheus --auths`. Load it beside snmp.yml, with --config.expand-environment-variables.
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

The file holds no password. `${EDGE_01_SNMP_AUTH}` is the name of the secret, the same name as in your `.env`. The SNMP exporter fills it in from its environment when it starts.

So start the SNMP exporter with three things:

1. `--config.file` twice: once for its own `snmp.yml`, once for this file.
2. `--config.expand-environment-variables`, so it fills in the passwords.
3. The secrets in its environment, from the same `.env`.

With systemd:

```ini
# /etc/systemd/system/snmp_exporter.service
[Service]
EnvironmentFile=/opt/network/.env
ExecStart=/usr/local/bin/snmp_exporter \
    --config.file=/etc/snmp_exporter/snmp.yml \
    --config.file=/etc/snmp_exporter/circuit-auths.yml \
    --config.expand-environment-variables
```

If your secrets are in [1Password](/integrations/1password), `.env` holds references, not values. Start it through 1Password instead, which fills them in:

```bash
op run --env-file=/opt/network/.env -- snmp_exporter --config.file=... --config.expand-environment-variables
```

A device with only an SNMP version 2c community gets `community: FILL_IN`, and Circuit says so. The SNMP exporter cannot read a community from its environment, and Circuit never writes a secret's value, so write it in by hand, or better, give the device a version 3 user.

## The list of devices

```bash
npx circuit prometheus > /etc/prometheus/circuit-targets.json
```

It writes one entry per device, in the format Prometheus reads with `file_sd_configs`:

```json
[
    {
        "targets": ["10.0.0.1"],
        "labels": { "device": "edge-01", "platform": "routeros", "model": "CCR2216-1G-12XS-2XQ", "__param_auth": "edge-01" }
    }
]
```

- `device` is the name from your config, so a graph says `edge-01`, not an address.
- `__param_auth` tells the SNMP exporter which auth to use: the device's own, from the file above.

Prometheus notices when the file changes, without a restart.

## Tell Prometheus to use it

```yaml
# prometheus.yml
scrape_configs:
    - job_name: network
      metrics_path: /snmp
      params:
          module: [if_mib]
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

`module` is what to read from each device; `if_mib` is every port's traffic and status.

## Keeping it current

After you add or change a device, run both commands again. To do it every night, add them to your [scheduled refresh](/guide/scheduled-refresh).
