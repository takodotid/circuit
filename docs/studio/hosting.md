---
description: Run Studio on a server for the whole team, behind a login.
---

# Hosting Circuit Studio

Run Studio on a server, and the whole team opens one address to see the network as the repo has it now. The server pulls the repo every minute.

::: warning Put it behind a login
Studio has no login. It shows your whole design: devices, addresses, rules, user and secret names. Never put it on the internet as is. Put a login in front (a reverse proxy) or keep it on your VPN.
:::

Studio tells search engines to stay away (`noindex`, `robots.txt`). That's not a lock, so you still need the login. A hosted Studio never logs in to devices.

## The command

```bash
circuit studio --host 0.0.0.0 --allow-host studio.example.com --no-open
```

| Option         | Does                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| `--host`       | Where it listens. `0.0.0.0` = every address. Default: this machine only.                   |
| `--allow-host` | The names people use to reach it. Anything else is refused, so other sites can't sneak in. |
| `--port`       | The port. Default `4600`.                                                                  |

Compare and history need `git` on the server, and a real clone with its history.

## With Docker Compose

This runs three containers: one keeps the copy of your repository pulled, one runs Studio, and one is [Caddy](https://caddyserver.com), which gets a certificate for your name and asks for a password.

1. Point a name, such as `studio.example.com`, at the server.
2. On the server, clone your network's repository into a directory named `network`. Use a deploy key that can only read it, saved beside `network` as `deploy-key` and readable by its owner only (`chmod 600 deploy-key`), with the git host's key in `known_hosts`.
3. Beside `network`, write `compose.yaml`:

    ```yaml
    services:
        # Pulls the network's repository every minute. Studio sees each change.
        sync:
            image: alpine/git
            entrypoint: ["sh", "-c", "while true; do git -c safe.directory=/network -C /network pull --ff-only --quiet; sleep 60; done"]
            volumes:
                - ./network:/network
                - ./deploy-key:/root/.ssh/id_ed25519:ro
                - ./known_hosts:/root/.ssh/known_hosts:ro
            restart: unless-stopped

        studio:
            image: debian:stable-slim
            working_dir: /network
            command: >
                sh -c "apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git &&
                git config --global --add safe.directory '*' &&
                curl -fsSL https://circuit.tako.id/install | CIRCUIT_NO_SETUP=1 sh &&
                /root/.local/bin/circuit studio --host 0.0.0.0 --allow-host studio.example.com --no-open"
            volumes:
                - ./network:/network
            restart: unless-stopped

        proxy:
            image: caddy:2
            ports: ["80:80", "443:443"]
            volumes:
                - ./Caddyfile:/etc/caddy/Caddyfile:ro
                - caddy-data:/data
            restart: unless-stopped

    volumes:
        caddy-data:
    ```

4. Make a password hash for the login:

    ```bash
    docker run --rm caddy:2 caddy hash-password --plaintext 'a long password'
    ```

5. Beside it, write `Caddyfile`, with the hash in place of `<hash>`:

    ```
    studio.example.com {
        basic_auth {
            noc <hash>
        }
        reverse_proxy studio:4600
    }
    ```

6. Run `docker compose up -d`, and open `https://studio.example.com`.

Studio runs the version in the project's `.circuit/version`. To move it, run `circuit update` in the project and push.

## Without Docker

Anything that keeps a clone pulled and the command running works: systemd for `circuit studio`, cron for `git pull --ff-only`, and the proxy you already have. nginx needs no extra setting.
