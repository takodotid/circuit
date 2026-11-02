---
description: See your secrets in Studio, decrypted in your browser only, with a key you type each time.
---

# Secrets in Studio

**Secrets** lists every secret, like `circuit secret` does: its name, how it's kept, and anything the config needs but `.env` lacks. No values until you ask.

## Seeing a value

1. Open **Secrets**.
2. Paste the key that unlocks `.env` (from `.env.keys` or 1Password).
3. **Show the values**. **Hide them** when you're done.

<img class="screenshot light" src="/screenshots/studio-secrets-light.png" alt="Studio's Secrets page: each secret's name and how it is kept, and the field for the key.">
<img class="screenshot dark" src="/screenshots/studio-secrets-dark.png" alt="Studio's Secrets page: each secret's name and how it is kept, and the field for the key.">

- Decryption happens in your browser. The key never goes to the server.
- Nothing is kept. Reload, and you paste the key again.
- 1Password values show where they live, never the value.
- A plain-text value shows **NOT ENCRYPTED**, with the fix.

## Changing a value

Studio only reads. To change one: `circuit secret set NAME`. See [Secrets](/guide/secrets).
