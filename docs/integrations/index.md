---
description: What Circuit works with today, and what's coming.
---

# Integrations

| Integration                          | What it does                                                                  | Status                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [1Password](/integrations/1password) | Reads the password that opens your secrets, or the secrets themselves.        | Works                                                                                         |
| git                                  | A commit check: every secret encrypted, and a project that validates.         | Works. See [The commit check](/guide/secrets#the-commit-check).                               |
| VS Code                              | Completes and checks every field; tidies on save with the Prettier extension. | Works. See [Your editor](/guide/install#your-editor).                                         |
| NetBox                               | Devices, ports, VLANs, addresses and cables, from the project.                | Coming as `circuit sync netbox` ([#170](https://github.com/takodotid/circuit/issues/170))     |
| LibreNMS                             | Every device monitored, with its SNMP settings and site.                      | Coming as `circuit sync librenms` ([#170](https://github.com/takodotid/circuit/issues/170))   |
| PeeringDB                            | Your exchange presence, from the project.                                     | Coming as `circuit sync peeringdb` ([#170](https://github.com/takodotid/circuit/issues/170))  |
| Prometheus                           | Targets for snmp_exporter.                                                    | Coming as `circuit sync prometheus` ([#170](https://github.com/takodotid/circuit/issues/170)) |

The settings for NetBox, LibreNMS, PeeringDB and Prometheus already go in `circuit({ integrations })`, and `circuit validate` checks them. Nothing syncs yet.
