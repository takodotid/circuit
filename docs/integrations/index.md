---
description: What Circuit works with today, and what's coming.
---

# Integrations

| Integration                            | What it does                                                                  | Status                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [1Password](/integrations/1password)   | Reads the password that opens your secrets, or the secrets themselves.        | Works                                                           |
| git                                    | A commit check: every secret encrypted, and a project that validates.         | Works. See [The commit check](/guide/secrets#the-commit-check). |
| VS Code                                | Completes and checks every field; tidies on save with the Prettier extension. | Works. See [Your editor](/guide/install#your-editor).           |
| [NetBox](/integrations/netbox)         | Devices, ports, VLANs, addresses and cables, from the project.                | Works: `circuit sync netbox`                                    |
| [LibreNMS](/integrations/librenms)     | Every device monitored, with its SNMP settings and site.                      | Works: `circuit sync librenms`                                  |
| [PeeringDB](/integrations/peeringdb)   | Your exchange presence, from the project.                                     | Works: `circuit sync peeringdb`                                 |
| [Prometheus](/integrations/prometheus) | Targets for Prometheus, and auths for snmp_exporter, as files in the project. | Works: `circuit sync prometheus`                                |

Each sync goes in `circuit({ integrations })`, and `circuit validate` checks its settings. `circuit sync <target>` shows what would change and asks before it sends. See [sync](/guide/cli#sync).
