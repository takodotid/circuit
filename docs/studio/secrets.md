# Secrets in Studio

The **Secrets** view lists every secret in the project's `.env`, the way `circuit env` does: its name, how it is kept, and the secrets the config needs that `.env` lacks. It shows no value until you ask.

## Seeing a value

1. Open **Secrets**, and press **Show values**.
2. Type the private key, the one in `.env.keys` or in 1Password.
3. Studio shows each encrypted value, decrypted.

The values are decrypted in your browser. The key you type never goes to the Studio server, and Studio keeps neither the key nor the values: leave the page or reload it, and you type the key again.

A value kept in 1Password shows where it is, such as **In 1Password: vault Network, item SNMP**, never the value itself.

## Changing a value

Studio only reads. To add or change a secret, run `circuit env set NAME`. See [Secrets](/guide/secrets).
