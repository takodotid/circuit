# 1Password

Your devices' passwords can stay in 1Password instead of in a file on your computer. `.env` then only holds references to them, and Circuit reads each value from 1Password when it sends a command.

This means:

- a new laptop, or a new person on the team, needs no copy of the secrets, only access to the vault;
- a changed password is changed once, in 1Password;
- an AI agent working in the project finds no password in `.env`, because it holds none.

## Set it up

1. **Install the 1Password CLI**, `op`, from [1Password's guide](https://developer.1password.com/docs/cli/get-started/). Check it works:
    ```bash
    op --version
    ```
2. **Sign it in.** The easiest way is to turn on "Integrate with 1Password CLI" in the 1Password desktop app, under Settings, Developer. Then `op` asks the app, and you approve with your fingerprint or password.
3. **Store each secret in 1Password.** For example, make a vault called `Network`, and an item for each device with its password.
4. **Point `.env` at them.** Each line is the secret's name, then a reference to where it is in 1Password: `op://<vault>/<item>/<field>`.
    ```bash
    # .env
    ROUTER_PASSWORD=op://Network/router/password
    SWITCH_PASSWORD=op://Network/switch/password
    ```
    In the 1Password app, the menu of any field has "Copy Secret Reference", which gives you the exact reference.
5. **Check every secret can be read:**
    ```bash
    npx circuit secrets
    ```
    It shows `1Password, through .env` next to each one it read from 1Password. It never prints a value.

A project started with `npx @takodotid/circuit new --1password` already has a `.env` with a reference for every secret its files use. Change each one to where the secret really is.

## In CI or on a server

Nobody is there to approve with a fingerprint, so use a [1Password service account](https://developer.1password.com/docs/service-accounts/) instead. Give it read access to the vault, and set its token in the environment:

```bash
export OP_SERVICE_ACCOUNT_TOKEN=...
npx circuit secrets
```

`op` uses the token on its own; nothing changes in your project.

## Without `.env`

Circuit reads a variable from the environment before `.env`. So `op run` works as well, if you prefer it:

```bash
op run --env-file=.env -- npx circuit apply router
```
