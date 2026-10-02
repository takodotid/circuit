# Introduction

Circuit is declarative network configuration. A device is described once, in plain TypeScript data, and Circuit does the rest: it renders the description in the platform's own language, reads what the device runs, plans the difference, and applies it.

Network gear has no Terraform provider worth the name for most platforms, and hand-written configuration drifts. Circuit treats the repository as the source of truth, the way infrastructure-as-code treats cloud resources.

## Principles

1. **The config is the whole truth.** Whatever a device runs that its config does not say is removed, or returned to its default. There are no exceptions and nothing is left alone.
2. **Absent means off.** A field is written when it has a value. An undeclared port is shut down, an undeclared service is disabled, an undeclared feature is not running. There is no `enabled: false` and no placeholder.
3. **Neutral words only.** The schema says `access_vlan`, `https`, `hardware_offload`. Each adapter translates, and a field a platform cannot express fails validation instead of being skipped.
4. **Names are checked.** A device declares its VLANs, interfaces, policies and the rest; every reference to one is type-checked, so a typo does not compile and the editor suggests the names that exist. Port names come from the hardware model.
5. **Secrets are references.** A password or key is resolved from the environment, `.env.local` or a file only when a command is sent. Rendered config, plans and snapshots never hold a secret.

Every adapter was proved on production devices before it was released.
