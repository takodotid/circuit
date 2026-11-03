---
description: See your secrets in Studio, decrypted in your browser only, with a password you type each time.
---

# Secrets in Studio

**Secrets** lists every secret, file by file, like `circuit secrets list` does: its name, how it's kept, and anything the config needs but the file lacks. No values until you ask.

## Seeing a value

1. Open **Secrets**.
2. Type the password of the file.
3. **Show the values**. **Hide them** when you're done.

<img class="screenshot light" src="/screenshots/studio-secrets-light.png" alt="Studio's Secrets page: each secret's name and how it is kept, and the field for the password.">
<img class="screenshot dark" src="/screenshots/studio-secrets-dark.png" alt="Studio's Secrets page: each secret's name and how it is kept, and the field for the password.">

- Decryption happens in your browser. The password never goes to the server.
- Nothing is kept. Reload, and you type the password again.
- 1Password values show where they live, never the value.
- A plain-text value shows **NOT ENCRYPTED**, with the fix.

## Reading a device

**Read from the device now** logs in to the device, so Studio needs the file's password. It takes it only from 1Password or `CIRCUIT_SECRETS_PASSWORD`, never from this page. Without either, run `circuit diff <device>`, which asks for it.

## Changing a value

Studio only reads. To change one: `circuit secrets`. See [Secrets](/guide/secrets).
