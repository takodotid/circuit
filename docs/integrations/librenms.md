# LibreNMS

[LibreNMS](https://www.librenms.org) monitors network devices over SNMP: traffic graphs, port status, alerts when something goes down.

`circuit librenms` adds every device in your config that LibreNMS does not monitor yet, with the SNMP credentials from its config. A device you add to the config can then be monitored with one command, instead of being typed into LibreNMS by hand.

## Before you start

1. **Turn SNMP on** in each device's config, with `management.snmp`. A device without it is not added, and `circuit librenms` says so.
2. **Allow LibreNMS's address** to reach SNMP: in `management.allow`, or in `management.snmp.allow` for SNMP alone.
3. **Make an API token** in LibreNMS, under your user's settings, API Settings, for a user who can add devices.

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

## Add your devices

```bash
npx circuit librenms             # what would be added
npx circuit librenms --confirm   # add them
```

For each device it adds:

- **The address** is the device's management address, `connection.host`. That is also how Circuit knows a device is already there.
- **The name** shown in LibreNMS is the device's `name`.
- **The credentials** are the device's first SNMP version 3 user, with authentication and encryption. Without a user, its version 2c community.

LibreNMS checks it can reach each device over SNMP before it adds it. If it cannot, it refuses, and Circuit shows LibreNMS's reason.

A device LibreNMS monitors that is not in your config is reported, never deleted. Remove it in LibreNMS yourself if it is really gone.
