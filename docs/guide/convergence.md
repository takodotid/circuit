# How a change is applied

This page explains what happens between `apply --confirm` and a device that matches its file, and what protects you when a change goes wrong.

## Making the plan

1. Circuit turns the device's file into the vendor's own commands. `build` prints this.
2. It logs in and reads the configuration the device runs.
3. It compares the two. Whatever the device runs that the file does not describe is planned for removal, or for a return to its default. Nothing is kept just because it is already there.

## The order of the plan

The plan runs in two stages:

1. **Things that are new or changed come first,** in the order they depend on each other. For example, a VLAN is created before a port is added to it.
2. **Things being removed come last,** in the reverse order. For example, a port leaves a VLAN before the VLAN is deleted. This way nothing is removed while something still uses it.

An ordered list, such as a firewall chain or a route policy, is replaced as a whole. The new rules are put in place first, and only then are the old ones removed, so there is never a moment with no rules at all.

## Checking before sending

Each platform gets a dry run where it allows one:

- **RouterOS** compiles every command on the device without running it. A typo or an unknown setting fails here, before anything changes.
- **VRP** puts every line into a candidate configuration, which is not active yet. If the device refuses any line, the whole candidate is thrown away.
- **Raisecom ROS** has neither, so it runs each command as it is sent and stops at the first one it refuses.
- **Junos** loads the whole plan into a locked candidate configuration and checks it with `commit check`. If the device refuses any line, or the check fails, the candidate is thrown away.
- **FortiOS** runs each line as it is sent. If the device refuses one, Circuit stops and has the device reload its saved configuration, which undoes what was sent.

## Protecting your access

The most dangerous change is one that cuts off the management access Circuit itself uses. So after every change, Circuit logs in again, in a new session. A change is only kept for good once that login works.

| Platform       | How the change becomes active        | If Circuit cannot log in again                                                                                                                                                                            |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routeros`     | each command, as it is sent          | A backup is made first. The device restores it on its own after `--rollback` minutes, 10 by default.                                                                                                      |
| `vrp`          | all at once, with `commit`           | The change is not saved. Restarting the device brings back the last saved configuration.                                                                                                                  |
| `raisecom-ros` | each command, as it is sent          | The change is not saved. Restarting the device brings back the last saved configuration.                                                                                                                  |
| `junos`        | all at once, with `commit confirmed` | Circuit restores the previous configuration over the session still open. If it cannot, the device rolls back on its own after `--rollback` minutes, 10 by default.                                        |
| `fortios`      | each line, as it is sent             | The change is not saved yet. Circuit has the device reload its saved configuration over the session still open. If it cannot, the device reloads it on its own after `--rollback` minutes, 10 by default. |

## Checking the device afterwards

A device can take every command and still not work as it should. So after the apply and the new snapshot, Circuit checks the device on platforms that have checks, and `apply` fails when one finds a problem. The change stays on the device: read what the problem says, fix it, and apply again.

On RouterOS, `apply` checks two things:

1. **Switch rules.** When the plan changed a switch rule, no switch rule may be invalid. A switch chip can hold far fewer rules than MikroTik lists: a CCR2216 stopped at 66 rules, at its sixth distinct port range. When one rule does not fit, it and every rule after it are marked invalid and do nothing, with no log line. A port ACL is made of switch rules, so its drops silently stop. The fix is fewer distinct port ranges in the device's ACLs.
2. **BGP sessions.** Before sending anything, Circuit notes which BGP sessions are established. After the apply, each of them must be established again within 180 seconds; Circuit reads them every 10 seconds, so an apply that left them up does not wait. A session still down at the end is named with why: one closed on its prefix limit is reported as that, with the `circuit bgp <device> <neighbor> --clear-limit` to run once you know why, and for any other `circuit bgp <device> --log` shows more. A session that was down before the apply is not waited for.

The other platforms have no checks yet.

## Versions of a platform

Each platform is written for one major version of its operating system, and Circuit refuses a device that runs another. `routeros` is RouterOS 7. RouterOS 6 writes BGP and firewall rules differently, so it would need its own platform.
