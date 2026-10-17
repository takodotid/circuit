# Devices

Each device is one file that calls `defineDevice`. The file says everything the device should run.

```ts
import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.168.10.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("SWITCH_PASSWORD") } },
    management: { allow: ["192.168.10.0/24"], ssh: {} },

    vlans: { mgmt: { id: 10 }, home: { id: 20 } },
    ports: {
        "10g-1": { description: "Router", trunk_vlans: ["mgmt", "home"] },
        "10g-2": { description: "Desk", access_vlan: "home" },
    },
    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["192.168.10.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "192.168.10.1" }] },
});
```

Hover any field in your editor to see what it does. The [schema reference](/reference/schema) lists every field.

## What a device can have

| Field                | What it is                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `name`               | The device's name. Circuit sets it as the hostname.                                                                     |
| `platform`, `model`  | The operating system, such as `routeros`, and the hardware model. Together they decide the commands and the port names. |
| `connection`         | How Circuit logs in: the management address, the SSH port, which of `users` it logs in as, and the serial console.      |
| `system`             | Timezone, login banner, DNS, NTP, logging and IP settings.                                                              |
| `users`              | Who can log in. A user not listed here is removed.                                                                      |
| `management`         | Which services are on (SSH, web, API, SNMP) and which addresses may use them.                                           |
| `certificates`       | Certificates the device shows to clients or trusts.                                                                     |
| `vlans`              | The VLANs the device has, by name.                                                                                      |
| `ports`              | The physical ports. A port not listed here is shut down.                                                                |
| `interfaces`         | VLAN interfaces, loopbacks, LAGs, bridges, and GRE, VXLAN and WireGuard tunnels.                                        |
| `vrfs`               | Separate routing tables.                                                                                                |
| `routing`            | Static routes, BGP, OSPF and RPKI.                                                                                      |
| `policies`           | Route policies: ordered rules that decide which routes are accepted, and change them.                                   |
| `prefix_sets`        | Lists of prefixes, written out or fetched from a registry.                                                              |
| `firewall`           | Filter rules, NAT and address lists.                                                                                    |
| `acls`               | Hardware ACLs, which filter in the switch chip. A port uses one with `acl`.                                             |
| `dhcp`, `dhcp_relay` | DHCP servers, and relays that forward DHCP to a server elsewhere.                                                       |
| `flow_export`        | NetFlow, IPFIX or sFlow, to see what traffic goes where.                                                                |
| `lldp`, `stp`        | Neighbor discovery and spanning tree, for the whole device. A port can override either.                                 |
| `hardware_offload`   | Forward in hardware where the device can. An interface can override it.                                                 |

## Reaching a device through its console

A serial console is the cable into a device's console port. It works when the device has no management address yet, such as a new device, and when the management network is down. The cable is plugged into one of two places:

- **This computer**, the one Circuit runs on, such as a laptop you carry to the rack.
- **A jump host**: a computer that stays beside the rack, with the console cable plugged into it and SSH running on it, so you can reach the console from anywhere.

### On this computer

1. Plug the console cable in and find its port. On Linux it is a path under `/dev/serial/by-path/`, which stays the same when a second adapter is plugged in, while names such as `/dev/ttyUSB0` can swap. On macOS it is a path such as `/dev/cu.usbserial-1410`. On Windows it is a COM port: Device Manager lists it under Ports, such as `COM3`.
2. Write the console into the device's `connection`, without a jump host:

    ```ts
    connection: {
        host: "192.0.2.4",
        user: "netops",
        console: { port: "COM3", baud: 9600 },
    },
    ```

3. Run `circuit snapshot <device> --console` or `circuit apply <device> --console`.

On Linux and macOS, Circuit needs Python 3, and your user must be allowed to open the port, such as by being in the `dialout` or `uucp` group. On Windows it uses PowerShell, which every Windows has.

### On a jump host

1. Plug the console cable into the jump host, and find the port's path under `/dev/serial/by-path/` there.
2. Write the jump host and the console into the device's `connection`:

    ```ts
    const jump = { host: "jump.example.com", user: "netops", password: secret("JUMP_PASSWORD") };

    connection: {
        host: "192.0.2.4",
        user: "netops",
        console: { jump, port: "/dev/serial/by-path/pci-0000:00:14.0-usb-0:2.4:1.0-port0", baud: 9600 },
    },
    ```

    Add `cloudflared: true` to the jump host when it is reached through a Cloudflare Tunnel; Circuit then connects with `cloudflared access ssh`.

3. Run `circuit snapshot <device> --console` or `circuit apply <device> --console`.

The jump host runs Linux or macOS with Python 3, and its user must be allowed to open the serial port.

### A device reached only through its console

A device with no management address, such as a firewall whose management port has no cable, leaves `host` out of its `connection` and gives only its `console`. Circuit then reads and applies it through the console without `--console`, and `librenms` and `prometheus` leave it out, since there is no address to poll.

### What happens on the console

Circuit logs in with the device's own login, whatever state the last session left the console in, and logs out when it is done, so no session stays open. Only one session can hold a console at a time; a second waits a little, then stops. After a change, Circuit logs out and in again on the same console before it keeps the change: that proves the logins still work, but not the management network. A console is slow: at 9600 bits per second, reading a FortiGate takes about two minutes, so give an apply a longer `--rollback`.

| Platform | Through a console                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FortiOS  | Proved on a FortiGate 3700D through a jump host.                                                                                                                 |
| RouterOS | Proved on a CCR2216 through a jump host. A certificate is installed from a file, which only SSH can write, so apply one without `--console`.                     |
| Junos    | Proved on a QFX5100 through a jump host, from a factory default with only its logins set: a snapshot, and an apply of 390 lines committed, proved and confirmed. |
| Raisecom | Written, not yet proved on a device.                                                                                                                             |
| VRP      | Written, not yet proved on a device.                                                                                                                             |

A console on this computer under Windows has been tried only as far as opening a COM port.

### A console that asks only for a password

Some consoles show `Password:` straight after Enter, with no `Username:` first. Add `passwordOnly: true` to the console, and Circuit types no name:

```ts
console: { port: "COM3", baud: 9600, passwordOnly: true },
```

`connection.user` still says whose password Circuit types. If the console asks for a name anyway, `--console` stops and says so.

## Port names

Ports are named by speed and position: `10g-1` is the first 10G port, `100g-2` the second 100G port. Circuit knows what each vendor calls them, so `10g-1` becomes `10GE1/0/1` on a Huawei switch and `sfp28-1` on a MikroTik router.

The model decides which ports exist. A port the model does not have is an error in your editor.

## Names are checked

A device can only use names that it defines itself:

```ts
vlans: { mgmt: { id: 99 } },
ports: {
    "10g-1": { access_vlan: "mgmt" },   // fine
    "10g-2": { access_vlan: "mgnt" },   // an error: there is no VLAN called mgnt
},
```

The same is true for interfaces, policies, prefix sets, BGP groups, ACLs, address lists, users, VRFs and certificates.

## Sharing values between devices

A device file is ordinary TypeScript, so a value two devices share is a constant in one file that both import:

```ts
// site.ts
import type { Vlan } from "@takodotid/circuit";

export const vlans = {
    mgmt: { id: 10, description: "Management" },
    home: { id: 20, description: "Home" },
} as const satisfies Record<string, Vlan>;
```

`satisfies Record<string, Vlan>` checks each VLAN where it is written, so a mistake shows up in `site.ts` instead of in every device that uses it.

Anything you would otherwise copy and paste can be a function that returns config. The [colocation pattern](/patterns/colocation) does this for its tenants.

## Combining config from several places

Sometimes a device's ports come partly from its own file and partly from a function, for example one that works out each customer's ports. Spreading both with `...` is risky: if both have a port called `10g-1`, one silently replaces the other.

`merge` combines them and stops with an error when two of them have the same name:

```ts
import { defineDevice, merge } from "@takodotid/circuit";

export default defineDevice({
    // ...
    ports: merge(customerPorts("tor-01"), {
        "40g-1": { description: "Uplink", trunk_vlans: ["mgmt", "servers"] },
    }),
});
```

## Renaming a device

A device's name is written in more places than its own file: the `link` at the far end of each cable, your checks, and anything that looks a device up by name, such as `customerPorts("tor-01")` above. `circuit rename` changes all of them at once.

1. Run `npx circuit rename tor-01 rack-a-01`. It shows every line it would change, and that the device's snapshot moves to the new name. Nothing is written yet.
2. Read the list. Below it are the lines that still mention the old name inside a longer text, such as a description. Change those by hand if they mean the device.
3. Run `npx circuit rename tor-01 rack-a-01 --confirm` to write the change.
4. Run `npx circuit validate`, then `npx circuit apply rack-a-01`. Only then does the device take its new hostname.

Every string that is exactly the old name changes, in every file of the project outside `node_modules` and `.circuit/`. That includes a BGP neighbor with the device's name, so the BGP session is renamed on the router that has that neighbor. `circuit diff` shows that before anything is sent.

The device's file keeps its name, since a file's name need not match the hostname. Add `--file` to rename it to `rack-a-01.ts` as well; every import of it follows. Circuit finds the device's file by its `defineDevice` call: the first `name` after the call is the device's name. So a file that only links to the device, or uses its name for a peer, is not mistaken for it. Circuit Studio finds a device's history the same way.

A name built from parts, such as `` `tor-0${n}` ``, cannot be found this way. Circuit stops and says so, and you rename it by hand.

## When a device cannot do what you wrote

Circuit uses the same field names for every vendor, but not every device can do everything. For example, a Huawei switch has no firewall, and a Raisecom switch has no BGP.

If you write a field that the device's platform cannot do, `circuit validate` reports it as an error, with the field and the reason. `diff` and `apply` refuse to run for that device until you remove the field. Circuit never skips a field quietly, so what you read in the file is always what the device runs.

[Platforms](/platforms/) has a table of what each platform can do.
