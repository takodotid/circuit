# Secrets in Studio

The **Secrets** view lists every secret in the project's `.env`, the way `circuit env` does: its name, how it is kept, and the secrets the config needs that `.env` lacks. It shows no value until you ask.

## Seeing a value

1. Open **Secrets**.
2. Type the key that decrypts `.env`, the one in `.env.keys` or in 1Password.
3. Press **Show the values**. Studio shows each encrypted value, decrypted. **Hide them** hides them again.

<img class="screenshot light" src="/screenshots/studio-secrets-light.png" alt="Studio's Secrets page: each secret's name and how it is kept, and the field for the key.">
<img class="screenshot dark" src="/screenshots/studio-secrets-dark.png" alt="Studio's Secrets page: each secret's name and how it is kept, and the field for the key.">

The values are decrypted in your browser: no value is sent to the page in plain text, and the key you type never goes to the Studio server. Studio keeps neither the key nor the values: leave the page or reload it, and you type the key again.

A value kept in 1Password shows as **kept in 1Password**, never the value itself. A value written in plain text shows as **NOT ENCRYPTED**, with what to run.

## Changing a value

Studio only reads. To add or change a secret, run `circuit env set NAME`. See [Secrets](/guide/secrets).
