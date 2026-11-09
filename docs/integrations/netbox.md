---
description: circuit sync netbox writes your devices, ports, VLANs, addresses and cables into NetBox, from the project.
---

# NetBox

[NetBox](https://netbox.dev) is where many teams keep what their network is made of: sites, racks, devices, cables and addresses.

`circuit sync netbox` writes what your project says into NetBox, so nobody types it in twice. It goes one way: Circuit writes, NetBox shows. Racks, power and anything else you keep in NetBox stay yours.

## What it writes

For each device:

- **The device**, at its `site`, with its `role`, its device type (the `model`, made by the platform's vendor) and its platform.
- **Every port of its model.** A port gets the name the device itself uses, such as `sfp28-1`, with Circuit's name, such as `25g-1`, as its label. A port the file doesn't write is off, as on the device.
- **Its interfaces**: LAGs, VLAN interfaces, bridges, loopbacks and tunnels, each with its description, MTU, VRF, LAG, bridge and VLANs.
- **Its VLANs** (one per site and VLAN ID) **and VRFs.**
- **Its addresses**, each on its port or interface. The one equal to `connection.host` is the device's primary address.
- **A cable** for each `link`.

And for the whole network:

- **The site**, with its `description` from `circuit({ sites })`.
- **A prefix** for each subnet an interface is on, with its VLAN and site, and a container prefix for each prefix in `routing.bgp.originated_prefixes`.
- **Addresses on no interface of yours** that the project knows, as [`circuit addresses`](/guide/cli#addresses) lists them: BGP neighbors, next hops, DHCP reservations and VRRP addresses. Each DHCP pool is an IP range.

## What it never touches

Circuit puts the tag `circuit` on everything it makes, and only ever changes or deletes objects with that tag:

- An object with the tag that the project no longer has is deleted.
- An object NetBox already holds without the tag, such as a site or a role your team made, is used as it is and never changed. The plan lists each one under **Left alone**.
- Tags you add to an object are kept.

If a device type in NetBox has interface templates, NetBox makes the ports itself when Circuit makes the device. Those ports have no tag, so Circuit leaves them alone too. Use a device type without interface templates if you want Circuit to keep the ports up to date.

NetBox has no place for some things, so they are listed under Left alone instead of being skipped:

- BGP sessions: NetBox needs a plugin for them.
- A `link` to a device that is not in the project: there is nothing to put the cable's other end on.
- A `link` that goes `through` a carrier: NetBox keeps a carrier's line as a circuit, not a cable.
- Prefixes routed elsewhere that no interface of yours is on.

## Before you start

1. **Use NetBox 4.2 or later.** Circuit puts a prefix on its site the way NetBox 4.2 started to.
2. **Make an API token** in NetBox, under your user's API Tokens, that can write.
3. **Give every device a `role`**, such as `role: "Edge router"`. NetBox needs one for every device, and Circuit never makes one up: with NetBox set, `circuit validate` stops on a device without it. Circuit makes the role in NetBox when NetBox has none of that name.

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

Each device already says where it is and what it is for:

```ts
export default as64500.device({
    name: "edge-01",
    site: "dc-1",
    role: "Edge router",
    // ...
});
```

Then keep the token in your secrets, encrypted:

```sh
circuit secrets set NETBOX_API_TOKEN
```

A token that starts with `nbt_` (NetBox 4.5 and later) is sent after `Bearer`, an older one after `Token`.

## Bring NetBox in step

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

The plan lists each object to make (`+`), change (`~`, with each field before and after) and delete (`-`), then how many of each kind. Some fields can only be set once the object they point to exists, such as a device's primary address, so Circuit sends in up to three rounds. Then it reads NetBox again; if something still differs, it shows what and stops with an error.

Without a terminal and without `--confirm`, Circuit shows the plan and exits 1 without sending, so `circuit sync netbox` in CI tells you when NetBox has drifted.

IPv6 addresses are compared in one spelling, RFC 5952's, so `2001:DB8:0:0::1` in NetBox matches `2001:db8::1` in your project.

## Several networks, one NetBox

Networks in one project that name the same NetBox `url` are planned together. So syncing one never deletes what the other made.

[LibreNMS](/integrations/librenms) uses the same `site` for its device groups.
