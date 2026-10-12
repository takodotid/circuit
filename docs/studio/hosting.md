# Hosting studio

Studio can run on a server, so your whole team opens one address and sees the network as your repository has it now. A copy of the repository on the server is pulled every minute, and studio shows each change as it does on your own machine.

::: warning Put it behind a login
Studio has no login of its own. It shows your network's whole design: devices, addresses, firewall rules, policies and the names of users and secrets. It never shows a secret's value. Never put it on the internet as it is: reach it only through something that asks who people are, such as a reverse proxy with a login, or only over your VPN.
:::

## The command

```bash
npx circuit studio --host=0.0.0.0 --allow-host=studio.example.com --no-open
```

| Option         | What it does                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--host`       | The address studio listens on. `0.0.0.0` is every address the server has. `127.0.0.1` by default, this machine only.                                                                                                         |
| `--allow-host` | The names people reach studio by, several with commas. Studio refuses a request addressed to any other name, so a web page elsewhere cannot read your network through a name it points at your server. Needed with `--host`. |
| `--port`       | The port. `4600` by default.                                                                                                                                                                                                 |

Compare and a device's history need `git` on the server, and the copy of your repository needs its history: clone it, do not copy only its files.

## With Docker Compose

This runs three containers: one keeps the copy of your repository pulled, one runs studio, and one is [Caddy](https://caddyserver.com), which gets a certificate for your name and asks for a password.

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
            image: node:24-alpine
            working_dir: /network
            command: >
                sh -c "apk add --no-cache git &&
                git config --global --add safe.directory '*' &&
                npm ci &&
                npx circuit studio --host=0.0.0.0 --allow-host=studio.example.com --no-open"
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

When a pull changes `package.json`, such as a new Circuit version, restart studio so it installs it: `docker compose restart studio`. If your repository uses pnpm or Bun, put its install command in place of `npm ci`.

## Without Docker

Any way of keeping a clone pulled and the command running works: a service manager such as systemd for `circuit studio`, a timer or cron job for `git pull --ff-only`, and the reverse proxy you already run. Behind a proxy, studio tells it not to hold back the stream that announces changes, so nginx needs no setting of its own for it.
