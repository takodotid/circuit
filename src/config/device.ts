// One device: its name, where it is, what it is, how Circuit logs in, and its groups. A part of a device, written in another file and given to it by a source.

import type { IP, Secret } from "./common";
import type { Firewall } from "./firewall";
import type { Interfaces, Port } from "./interfaces";
import type { Management } from "./management";
import type { Monitoring } from "./monitoring";
import type { AnyFacts, NetworkFacts } from "./network";
import type { Routing } from "./routing";
import type { Services } from "./services";
import type { Switching } from "./switching";
import type { System } from "./system";

/** A computer with SSH that holds the serial consoles of devices, such as a laptop beside the rack. It runs Python 3. */
export type Jump = {
    /** Its address or name. */
    host: string;
    /** The user Circuit logs in as. It must be allowed to open the serial ports. */
    user: string;
    /** The user's password. */
    password: Secret;
    /** SSH port. 22 when absent. */
    port?: number;
    /** The jump host is reached through a Cloudflare Tunnel, so Circuit connects with `cloudflared access ssh`, which must be installed. */
    cloudflared?: true;
};

/** A serial console, on a jump host or on the computer Circuit runs on. */
export type Console = {
    /** The jump host the console cable is plugged into. When absent, the cable is plugged into the computer Circuit runs on. */
    jump?: Jump;
    /** The serial port: on Linux or macOS a path under `/dev`, where a path under `/dev/serial/by-path/` stays the same when two adapters swap names; on Windows a COM port, such as `COM3`. */
    port: string;
    /** Line speed in bits per second, such as 9600 or 115200. */
    baud: number;
    /** The console asks only for a password, with no name first. Circuit then types no name; `connection.user` still picks the password. */
    password_only?: true;
};

/** How Circuit itself logs in. `U` is the device's user names. */
export type Connection<U extends string> = {
    /** Management address. Absent for a device reached only through its console. Its own value, apart from any interface's address. */
    host?: IP;
    /** One of `system.users`. Its password is the login. */
    user: U;
    /** SSH port. 22 when absent. */
    port?: number;
    /** The device's serial console, for `--console`: the way in before the device has a management address, or when its management network is down. */
    console?: Console;
};

/** The names a device declares, by kind. A field that refers to a name takes only one of these. */
export type Names = {
    /** Keys of `interfaces.ethernet`. */
    port: string;
    /** Keys of `interfaces.lag`. */
    lag: string;
    /** Keys of `interfaces.vlan_interface`. */
    vlanInterface: string;
    /** Keys of `interfaces.bridge`, `.loopback`, `.gre`, `.vxlan`, `.wireguard` and `.eoip`. */
    interface: string;
    /** Keys of `switching.vlans`. */
    vlan: string;
    /** Keys of `switching.acls`. */
    acl: string;
    /** Keys of `routing.policies`. */
    policy: string;
    /** Keys of `routing.prefix_sets`. */
    prefixSet: string;
    /** Keys of `routing.bgp.neighbor_groups`. */
    neighborGroup: string;
    /** Keys of `routing.tables`. */
    table: string;
    /** Keys of `routing.vrfs`. */
    vrf: string;
    /** Keys of `firewall.address_sets`. */
    addressSet: string;
    /** Keys of `firewall.interface_sets`. */
    interfaceSet: string;
    /** Keys of `system.users`. */
    user: string;
    /** Keys of `system.certificates`. */
    certificate: string;
    /** Every port and interface: `port`, `lag`, `vlanInterface` and `interface` together. */
    anyInterface: string;
};

/**
 * The groups of a device, what a part may add to as well. `N` holds the names the device declares, `Ethernet` its ports. `Part` is true in a part, where BGP holds only what the part adds.
 * `Net` is what the network writes: whether it turns on the check `untrusted_vlans`, and its `communities`.
 */
export type Groups<N extends Names, Ethernet, Part extends boolean = false, Net extends NetworkFacts = AnyFacts> = {
    /** The box itself: banner, time, DNS it uses, users, certificates, logs kept on it, software, hardware. */
    system?: System<N["user"], N["certificate"], NoInfer<N["anyInterface"]>>;
    /** How people and tools log in: ssh, https, api, native protocol, console. */
    management?: Management<NoInfer<N["anyInterface"]>, NoInfer<N["certificate"]>, NoInfer<N["addressSet"]>>;
    /** What the box reports to collectors: snmp, syslog, flow export, optics. */
    monitoring?: Monitoring<NoInfer<N["anyInterface"]>>;
    /** Every port and interface, by kind: ethernet, lag, vlan_interface, bridge, loopback, gre, vxlan, wireguard, eoip. */
    interfaces?: Interfaces<
        Ethernet,
        N["lag"],
        N["vlanInterface"],
        N["interface"],
        NoInfer<N["vlan"]>,
        NoInfer<N["vrf"]>,
        NoInfer<N["table"]>
    >;
    /** Layer 2 shared by ports: vlans, stp, lldp, acls. */
    switching?: Switching<N["vlan"], N["acl"], NoInfer<N["anyInterface"]>, Net["untrusted"]>;
    /** What the box serves to hosts: dhcp server, dhcp relay, dns server, ntp server. */
    services?: Services<NoInfer<N["anyInterface"]>>;
    /** Where packets go: tables, vrfs, policy routing, static routes, bgp, ospf, bfd, rpki, policies, prefix sets. */
    routing?: Routing<N["policy"], N["prefixSet"], N["neighborGroup"], N["table"], N["vrf"], NoInfer<N["anyInterface"]>, Part, Net>;
    /** Which packets pass and how they are rewritten: address sets, interface sets, filter, nat, untracked, conntrack helpers. */
    firewall?: Firewall<N["addressSet"], NoInfer<N["anyInterface"]>, N["interfaceSet"]>;
};

/**
 * Everything one device runs. What is not written here is removed from the device or returned to its default.
 *
 * `N` holds the names it declares, so a reference to a name it does not declare is an error. `Ethernet` is its ports, checked against the model.
 * `Site` is the network's sites. `Net` is what the network writes: whether it turns on the check `untrusted_vlans`, and its `communities`.
 */
export type Device<
    Platform extends string,
    Model extends string,
    Site extends string,
    N extends Names,
    Ethernet,
    Name extends string = string,
    Net extends NetworkFacts = AnyFacts,
> = {
    /** Its hostname: its name in the network, and the key under which each source gives it a part. */
    name: Name;
    /** The site it is at, one of the network's `sites`. The NetBox site and LibreNMS group of that name. */
    site: Site;
    /** Its role in NetBox, such as `Core switch`. Circuit makes the role when NetBox has none of that name. */
    role?: string;
    /** Operating system. It decides which adapter renders and applies the device. */
    platform: Platform;
    /** Hardware model, one of the platform's. It decides which port names exist. */
    model: Model;
    /** How Circuit itself logs in. */
    connection: Connection<NoInfer<N["user"]>>;
} & Groups<N, Ethernet, false, Net>;

/**
 * A part of a device, which a source gives it under its hostname: what an upstream, a tenant or a monitoring host adds to it. The names it refers to must be declared by the device or by one of its parts.
 */
export type Part<N extends Names, Ethernet, Net extends NetworkFacts = AnyFacts> = {
    /** How Circuit itself logs in. In a part, only what the part adds, such as the console. */
    connection?: Partial<Connection<NoInfer<N["user"]>>>;
} & Groups<N, Ethernet, true, Net>;

/** Any name: what a part, or a device seen from the network, holds. */
type AnyNames = { [K in keyof Names]: string };

/** A port as a part writes it, before the device it goes to checks its names. */
export type AnyPort = Port<string, string, string, string, string>;

/** Any device, as the network holds it. */
export type AnyDevice = Device<string, string, string, AnyNames, Record<string, AnyPort>>;

/**
 * A part of one or more devices, written apart from them and given to each device that carries it, under its hostname in a source: an upstream's VLAN, sessions and policies on the router, a tenant's ports on a switch, what every device sends to the monitoring hosts.
 *
 * It has a device's shape and docs. What only a whole device has (its site, platform, model) is not here, and what a part writes alone stays optional: a part can add BGP neighbors without the AS, or a console without the user.
 *
 * Names a part refers to (a VLAN, an interface, a policy) are checked once the part reaches a device: there they must be declared.
 */
export type DevicePart = Part<AnyNames, Record<string, AnyPort>>;
