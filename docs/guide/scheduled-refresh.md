# Scheduled refresh

A prefix set fetched from a registry, such as every prefix a customer's AS announces, changes on its own, often every day. `circuit refresh <device> --confirm` puts the current list on the device. Run it on a schedule, so nobody has to remember.

`refresh` only replaces those lists. It never changes the rest of the device's config. It refuses a list that is empty or holds more than 100,000 prefixes, because that is a broken feed, not a real change.

## Where to run it

On a machine that can reach your devices' management addresses, such as a small server in your management network. GitHub's own runners cannot reach them, so in GitHub Actions use a runner of your own.

The machine needs:

1. The network's repository, with its dependencies installed.
2. The secrets: a `.env`, or a [1Password service account](/integrations/1password#in-ci-or-on-a-server) token in the environment.

Run `npx circuit secrets` once there, to check every secret can be read.

## With systemd

A service that refreshes each device, and a timer that starts it every night. Replace `/opt/network` with where the repository is, and the device names with yours.

```ini
# /etc/systemd/system/circuit-refresh.service
[Unit]
Description=Refresh prefix sets from the registries

[Service]
Type=oneshot
WorkingDirectory=/opt/network
ExecStart=/usr/bin/npx circuit refresh edge-01 --confirm
ExecStart=/usr/bin/npx circuit refresh edge-02 --confirm
```

```ini
# /etc/systemd/system/circuit-refresh.timer
[Unit]
Description=Refresh prefix sets every night

[Timer]
OnCalendar=*-*-* 03:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now circuit-refresh.timer
systemctl list-timers circuit-refresh.timer   # when it runs next
journalctl -u circuit-refresh.service          # what it did
```

`Persistent=true` runs a refresh the machine missed while it was off. A refresh that fails leaves the service failed, so your monitoring can watch for it.

## With cron

One line, if the machine has no systemd:

```bash
0 3 * * * cd /opt/network && npx circuit refresh edge-01 --confirm >> /var/log/circuit-refresh.log 2>&1
```

## With GitHub Actions

Put a [self-hosted runner](https://docs.github.com/actions/hosting-your-own-runners) on a machine in your management network, labelled `network`. Store each secret as an Actions secret; Circuit reads the environment before `.env`.

```yaml
# .github/workflows/refresh.yml
name: refresh

on:
    schedule:
        - cron: "0 3 * * *"
    workflow_dispatch:

jobs:
    refresh:
        runs-on: [self-hosted, network]
        steps:
            - uses: actions/checkout@v4
            - run: npm ci
            - run: npx circuit refresh edge-01 --confirm
              env:
                  EDGE_01_PASSWORD: ${{ secrets.EDGE_01_PASSWORD }}
```

`workflow_dispatch` lets you also run it by hand, from the Actions tab. A failed run is reported by GitHub like any other.
