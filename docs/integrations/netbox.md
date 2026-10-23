# NetBox

[NetBox](https://netbox.dev) is where many teams keep what their network is made of: sites, racks, devices, cables and addresses.

`circuit netbox` writes what your config says into NetBox, so it shows there without being typed in twice. It goes one way: Circuit writes, NetBox shows. Racks, power and anything else you keep in NetBox stay yours.

## What it writes

For each device:

- **The device**, on its site, with its role, its device type (the model, made by the platform's vendor) and its platform.
- **Every port of its model.** A port gets the name the device itself uses, such as `sfp28-1`, with Circuit's name, such as `25g-1`, as its label. A port the config does not declare is off, as on the device.
- **Its interfaces**: LAGs, VLAN interfaces, loopbacks, tunnels and bridges. Ports and interfaces carry their description, MTU, VRF, LAG and VLANs.
- **Its VLANs and VRFs.**
- **Its addresses**, each on its port or interface. The address Circuit reaches the device at, `connection.host`, is its primary address.
- **A cable** for each `link`.

And for the whole network:

- **A prefix** for each subnet an interface is on, with its VLAN and site, and a container prefix for each prefix you announce in BGP.
- **Addresses on no interface of yours** that the config knows, as `circuit addresses` lists them: BGP neighbors, next hops, DHCP reservations and VRRP addresses. Each DHCP pool is an IP range.

BGP sessions are left out: NetBox has no place for them without a plugin.

## What it never touches

Circuit puts the tag `circuit` on everything it makes, and only ever changes or deletes objects with that tag:

- An object the config no longer has, and that has the tag, is deleted.
- An object NetBox already holds without the tag, such as a site or a device role your team made, is used as it is and never changed. `circuit netbox` lists each one as `left alone`.
- Tags you add to an object are kept.

If the device type in NetBox has interface templates, NetBox makes the ports itself when Circuit makes the device. Those ports have no tag, so Circuit leaves them alone too. Use a device type without interface templates if you want Circuit to keep the ports up to date.

## Before you start

1. **Use NetBox 4.2 or later.** Circuit puts a prefix on its site the way NetBox 4.2 started to.
2. **Make an API token** in NetBox, under your user's API Tokens, that can write.
3. **Say where each device is and what it is for.** NetBox needs a site and a role for every device, which a device's config does not hold.

## Set it up

In `circuit.config.ts`, give each device a site, and tell Circuit where NetBox is and the role of each device:

```ts
export default defineNetwork({
    devices: [edge, core, tor],

    // The site each device is at, by name.
    site: (device) => (device.name.startsWith("jkt-") ? "Jakarta 1" : "Singapore 1"),

    netbox: {
        url: "https://netbox.example.com",
        api_token: secret("NETBOX_TOKEN"),
        // The role of each device, by name.
        device: (device) => ({ role: device.name.includes("-edge-") ? "Edge router" : "Switch" }),
    },
});
```

`site` and `device` are functions, so they can follow whatever naming your network uses. Circuit makes a site or a role when NetBox has none of that name, with the tag.

`device` can also give a `device_type`, the model name NetBox should use, when it differs from the device's `model`.

Put the token in `.env`, or in [1Password](/integrations/1password):

```bash
NETBOX_TOKEN=...
```

## Bring NetBox in step

```bash
npx circuit netbox             # what would change
npx circuit netbox --confirm   # send it
```

Without `--confirm`, nothing is sent. The plan lists each object to make (`+`), change (`~`, with each field that differs) and delete (`-`), then how many of each kind.

With `--confirm`, Circuit sends the changes and plans again. Some fields can only be set once the object they point to exists, such as a device's primary address, so a second round sets them. If NetBox still differs after three rounds, Circuit lists what is left and stops with an error.

IPv6 addresses are compared in one spelling, RFC 5952's, so `2001:DB8:0:0::1` in NetBox matches `2001:db8::1` in your config.
