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

## Protecting your access

The most dangerous change is one that cuts off the management access Circuit itself uses. So after every change, Circuit logs in again, in a new session. A change is only kept for good once that login works.

| Platform       | How the change becomes active | If Circuit cannot log in again                                                                       |
| -------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `routeros`     | each command, as it is sent   | A backup is made first. The device restores it on its own after `--rollback` minutes, 10 by default. |
| `vrp`          | all at once, with `commit`    | The change is not saved. Restarting the device brings back the last saved configuration.             |
| `raisecom-ros` | each command, as it is sent   | The change is not saved. Restarting the device brings back the last saved configuration.             |

## Versions of a platform

Each platform is written for one major version of its operating system, and Circuit refuses a device that runs another. `routeros` is RouterOS 7. RouterOS 6 writes BGP and firewall rules differently, so it would need its own platform.
