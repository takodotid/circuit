---
description: circuit sync librenms keeps every device monitored in LibreNMS, with its name, SNMP settings, location and a group per site.
---

# LibreNMS

[LibreNMS](https://www.librenms.org) monitors network devices over SNMP: traffic graphs, port status, alerts when something goes down.

`circuit sync librenms` keeps LibreNMS in step with your project. It adds every device LibreNMS doesn't monitor yet, and changes one whose name, SNMP credentials or location differ. A device you add to the project is monitored with one command, instead of being typed into LibreNMS by hand.

## Before you start

1. **Use LibreNMS 26.5 or later.** Older versions can't change a device's name through the API.
2. **Turn SNMP on** in each device's file, with `monitoring.snmp`. A device without it is not added, and the plan says so.
3. **Let LibreNMS reach SNMP**: its address in `management.allow`, or in `monitoring.snmp.allow` for SNMP alone.
4. **Make an API token** in LibreNMS, under your user's settings, API Settings, for a user who can add and change devices and device groups.

## Set it up

In `circuit.ts`:

```ts
integrations: {
    librenms: { url: "https://librenms.example.com", api_token: secret("LIBRENMS_API_TOKEN") },
},
```

Then keep the token in your secrets, encrypted:

```sh
circuit secrets set LIBRENMS_API_TOKEN
```

## Bring LibreNMS in step

```sh
circuit sync librenms             # shows what would change, then asks
circuit sync librenms --confirm   # sends without asking
```

```
LibreNMS: 3 change(s)
  ~ tor-01
      display_template: "10.0.99.2" to "tor-01"
      location: null to "Rack 1"
  + edge-02, 10.0.0.2, SNMP v3 user monitor
  ~ group dc-1
      add edge-02

Left alone:
  LibreNMS monitors 10.0.0.9, which no device in the project has. Remove it there by hand if it is gone.
  sw-03 has no monitoring.snmp, so LibreNMS can't poll it.
  console-01 has no connection.host, so LibreNMS has nothing to poll.
```

It never shows a password or a community: a secret that differs shows as `differs (not shown)`.

For each device:

- **The address** is its management address, `connection.host`. That is also how Circuit knows a device is already there. A device that moves to a new address shows up as one new device, and its old address as one LibreNMS has that the project doesn't.
- **The name** shown in LibreNMS is the device's `name`.
- **The credentials** are its first SNMP version 3 user, with authentication and encryption. Without a user, its version 2c community. Change a password in the project, apply it to the device, then run `circuit sync librenms` so LibreNMS polls with the new one.
- **The location** is its `monitoring.snmp.location`, when it has one. LibreNMS also reads it from the device; Circuit sets it so it shows before the next poll.

LibreNMS checks it can reach a device over SNMP before it adds it. If it can't, it refuses, and Circuit shows LibreNMS's reason.

A device LibreNMS monitors that is not in your project is listed, never deleted. Remove it in LibreNMS yourself if it is really gone.

## A group per site

Circuit keeps a static device group in LibreNMS for each site, named after it:

- A site without a group gets a new static group with its devices.
- A device missing from its site's group is added to it, and a device in another site's group is taken out of that one.
- Devices that are not in your project stay in a group, and Circuit never deletes a group.
- A group of that name that is dynamic, with rules instead of a list of devices, is left alone, and the plan says so.

Networks in one project that name the same LibreNMS `url` are planned together. [NetBox](/integrations/netbox) puts each device on the same site.
