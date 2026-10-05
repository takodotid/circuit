---
layout: home

hero:
    name: Circuit
    text: Your network, written down.
    tagline: Write how each router and switch should be configured, in one file per device. Circuit shows you what would change, then makes the device match.
    actions:
        - theme: brand
          text: Get started
          link: /guide/getting-started
        - theme: alt
          text: What Circuit is
          link: /guide/introduction

features:
    - title: The file is the whole truth
      details: Whatever a device runs that its file does not mention is removed or turned off. Nobody's forgotten change stays behind on a device.
    - title: One way to write it, for every vendor
      details: You write access_vlan once, and Circuit turns it into MikroTik, Huawei or Raisecom commands. If a device cannot do what you wrote, Circuit tells you before anything is sent.
    - title: Typos are caught before they reach a device
      details: A VLAN, port or policy name that does not exist is an error in your editor, and the editor suggests the names that do.
    - title: Changes you can undo
      details: Each device is changed the safest way it allows, and a change is kept only after Circuit can still log in. A MikroTik router that loses you goes back on its own.
---

::: warning Alpha
Circuit runs a production network, but it is not stable yet: the way you write config, the commands and the supported devices can still change between releases. Install an exact version, and read the [release notes](https://github.com/takodotid/circuit/releases) before you upgrade.
:::
