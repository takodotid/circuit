---
description: Keep every device monitored in LibreNMS, with its name, SNMP settings, location, and a device group for each site.
---

# LibreNMS

`circuit sync librenms` adds each device that [LibreNMS](https://www.librenms.org) doesn't monitor yet. It changes a device whose name, SNMP credentials, or location differ. [How sync works](/integrations/) explains the plan, CI, and several networks.

## Before you start

1. **Use LibreNMS 26.5 or later.** Older versions can't change a device's name through the API.
2. **Turn SNMP on** in each device's file, with `monitoring.snmp`. Circuit doesn't add a device without it, and the plan says so.
3. **Let LibreNMS reach SNMP.** Put its address in `management.allow`, or in `monitoring.snmp.allow` for SNMP only.
4. **Make an API token** in LibreNMS, under your user's settings, API Settings. The user needs the right to add and change devices and device groups.

## Set it up

In `circuit.ts`:

```ts
integrations: {
    librenms: { url: "https://librenms.example.com", api_token: secret("LIBRENMS_API_TOKEN") },
},
```

Then set the token:

```sh
circuit secrets set LIBRENMS_API_TOKEN
```

## Sync LibreNMS

`circuit sync librenms` shows a plan such as this one, then asks:

```
LibreNMS: 3 change(s)
  ~ tor-01
      display_template: "192.0.2.12" to "tor-01"
      location: null to "Rack 1"
  + edge-02, 192.0.2.2, SNMP v3 user monitor
  ~ group dc-1
      add edge-02

Left alone:
  LibreNMS monitors 192.0.2.9, which no device in the project has. Remove it there by hand if it is gone.
  sw-03 has no monitoring.snmp, so LibreNMS can't poll it.
  console-01 has no connection.host, so LibreNMS has nothing to poll.
```

For each device, Circuit sends:

- **The address**, from `connection.host`. Circuit also finds the device in LibreNMS by this address. If a device moves to a new address, the plan adds it as a new device and lists the old address under Left alone.
- **The name**, from `name`.
- **The credentials** of its first SNMP version 3 user, or else its version 2c community.
- **The location**, from `monitoring.snmp.location`, if it has one.

If you change an SNMP password, apply it to the device first. Then run `circuit sync librenms`, so LibreNMS polls with the new one.

LibreNMS checks that it can reach a device over SNMP before it adds it. If it can't, it refuses, and Circuit shows LibreNMS's reason. Circuit never deletes a device from LibreNMS.

## A group for each site

Circuit keeps a static device group in LibreNMS for each site, with the site's name:

- If the group is missing, Circuit makes it.
- Circuit adds a device that is missing from its site's group, and takes it out of any other site's group.
- Devices that are not in your project stay in their group. Circuit never deletes a group.
- If a group with that name is dynamic, with rules instead of a list of devices, Circuit leaves it alone.
