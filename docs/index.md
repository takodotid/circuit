---
layout: home

hero:
    name: Circuit
    text: Your network, declared.
    tagline: Describe each device in TypeScript. Circuit renders it for the platform, compares it with what the device runs, and makes the device match.
    actions:
        - theme: brand
          text: Get started
          link: /guide/getting-started
        - theme: alt
          text: Why Circuit
          link: /guide/introduction

features:
    - title: The config is the whole truth
      details: Whatever a device runs that its config does not say is removed or returned to its default. Nothing drifts because nobody described it.
    - title: One vocabulary, many vendors
      details: The schema says access_vlan, https, hardware_offload. Each adapter translates, and a field a platform cannot express fails validation instead of being skipped.
    - title: Typos do not compile
      details: Every reference to a VLAN, interface, policy or port is type-checked, and the editor suggests the names that exist.
    - title: Guarded applies
      details: Each platform is applied the safest way it allows, with a rollback or a commit and a fresh login before anything is saved.
---

::: warning Alpha
Circuit runs a production network, but it is not yet stable: the schema, the CLI and the adapters can still change in breaking ways between releases. Pin an exact version and read the [release notes](https://github.com/takodotid/circuit/releases) before upgrading.
:::
