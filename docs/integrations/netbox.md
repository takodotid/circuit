---
description: Sync the devices, ports, VLANs, addresses, and cables in your project into NetBox.
---

# NetBox

[NetBox](https://netbox.dev) is where many teams keep what their network is made of: sites, racks, devices, cables, and addresses.

`circuit sync netbox` writes what your project says into NetBox, so nobody types it in twice. Racks, power, and anything else you keep in NetBox stay yours. [How sync works](/integrations/) explains the plan, CI, and several networks.

## What it writes

For each device:

- **The device**, at its `site`, with its `role`, its platform, and its device type. The device type is the `model`, made by the platform's vendor.
- **Every port of its model.** A port gets the name the device uses, such as `sfp28-1`, and Circuit's name, such as `25g-1`, as its label. A port the file doesn't write is off, as on the device.
- **Its interfaces**: LAGs, VLAN interfaces, bridges, loopbacks, and tunnels. Each has its description, MTU, VRF, LAG, bridge, and VLANs.
- **Its VLANs and VRFs.** There is one VLAN for each site and VLAN ID.
- **Its addresses.** Each address is on its port or interface. The address equal to `connection.host` is the device's primary address.
- **A cable** for each `link`.

For the whole network:

- **Each site**, with its `description` from `circuit({ sites })`.
- **A prefix** for each subnet an interface is on. The prefix gets the subnet's VLAN and site. Each prefix in `routing.bgp.originated_prefixes` becomes a container prefix.
- **The other addresses the project knows**, as [`circuit addresses`](/reference/cli#addresses) lists them: BGP neighbors, next hops, DHCP reservations, and VRRP addresses. Each DHCP pool becomes an IP range.

## What it leaves alone

Circuit puts the tag `circuit` on everything it makes. It changes or deletes only objects with that tag:

- It deletes an object with the tag if the project no longer has it.
- It uses an object without the tag, such as a site your team made, but never changes it. The plan lists each one under **Left alone**.
- It keeps the tags you add to an object.

If a device type in NetBox has interface templates, NetBox makes the ports itself when Circuit makes the device. Those ports have no tag, so Circuit leaves them alone too. If you want Circuit to keep the ports up to date, use a device type without interface templates.

NetBox has no place for some things, so the plan lists them under Left alone:

- BGP sessions, because NetBox needs a plugin for them.
- A `link` to a device that is not in the project, because the cable has nothing to end on.
- A `link` that goes `through` a carrier, because NetBox keeps a carrier's line as a circuit, not a cable.
- Prefixes routed elsewhere that no interface of yours is on.

## Before you start

1. **Use NetBox 4.2 or later.**
2. **Make an API token that can write**, under your user's API Tokens in NetBox.
3. **Give every device a `role`**, such as `role: "Edge router"`. NetBox needs one, and Circuit never makes one up, so `circuit validate` stops on a device without a role. If NetBox has no role of that name yet, Circuit adds it.

## Set it up

In `circuit.ts`:

```ts
export const as64500 = circuit({
    asn: 64500,
    sites: {
        "dc-1": { description: "The data centre" },
    },
    integrations: {
        netbox: { url: "https://netbox.example.com", api_token: secret("NETBOX_API_TOKEN") },
    },
});
```

Then keep the token in your secrets, encrypted:

```sh
circuit secrets set NETBOX_API_TOKEN
```

## Sync NetBox

```sh
circuit sync netbox             # shows what would change, then asks
circuit sync netbox --confirm   # sends without asking
```

```
NetBox: 3 change(s)
  + dcim/devices edge-02
  ~ dcim/interfaces edge-01/sfp28-2
      description: null to "edge-02 25g-1"
  - dcim/devices edge-old

  dcim/devices: 1 to create, 0 to change, 1 to delete
  dcim/interfaces: 0 to create, 1 to change, 0 to delete

Left alone:
  dcim/sites dc-1: in NetBox without the tag circuit, so it is used as it is.
  BGP sessions (4): NetBox has no place for them without a plugin.
```
