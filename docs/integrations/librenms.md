# LibreNMS

[LibreNMS](https://www.librenms.org) monitors network devices over SNMP: traffic graphs, port status, alerts when something goes down.

`circuit librenms` keeps LibreNMS in step with your config. It adds every device LibreNMS does not monitor yet, and changes one whose name, SNMP credentials or location differ from its config. A device you add to the config can then be monitored with one command, instead of being typed into LibreNMS by hand.

## Before you start

1. **Use LibreNMS 26.5 or later.** Older versions cannot change a device's name through the API.
2. **Turn SNMP on** in each device's config, with `management.snmp`. A device without it is not added, and `circuit librenms` says so.
3. **Allow LibreNMS's address** to reach SNMP: in `management.allow`, or in `management.snmp.allow` for SNMP alone.
4. **Make an API token** in LibreNMS, under your user's settings, API Settings, for a user who can add and change devices and device groups.

## Set it up

Tell Circuit where LibreNMS is, in `circuit.config.ts`:

```ts
librenms: {
    url: "https://librenms.example.com",
    api_token: secret("LIBRENMS_TOKEN"),
},
```

and put the token in `.env`, or in [1Password](/integrations/1password):

```bash
LIBRENMS_TOKEN=...
```

## Bring LibreNMS in step

```bash
npx circuit librenms             # what would change
npx circuit librenms --confirm   # send it
```

The plan lists each device to add (`+`) and each device to change (`~`, with what differs). It never shows a password or community.

For each device:

- **The address** is the device's management address, `connection.host`. That is also how Circuit knows a device is already there.
- **The name** shown in LibreNMS is the device's `name`.
- **The credentials** are the device's first SNMP version 3 user, with authentication and encryption. Without a user, its version 2c community. Change a password in the config, apply it to the device, then run `circuit librenms --confirm` so LibreNMS polls with the new one.
- **The location** is the device's `management.snmp.location`, when it has one. LibreNMS also reads it from the device; Circuit sets it so it shows before the next poll.

LibreNMS checks it can reach a device over SNMP before it adds it. If it cannot, it refuses, and Circuit shows LibreNMS's reason.

A device LibreNMS monitors that is not in your config is reported, never deleted. Remove it in LibreNMS yourself if it is really gone.

## A group per site

When the network says which site each device is at, with `site`, Circuit keeps a device group in LibreNMS for each site, named after it:

```ts
site: (device) => (device.name.startsWith("jkt-") ? "Jakarta 1" : "Singapore 1"),
```

- A site without a group gets a new static group with its devices.
- A device missing from its site's group is added to it, and a device in another site's group is taken out of that one.
- Devices that are not in your config stay in a group, and Circuit never deletes a group.
- A group of that name that is dynamic, with rules instead of a list of devices, is left alone, and `circuit librenms` says so.

[NetBox](/integrations/netbox) puts each device on the same site.
