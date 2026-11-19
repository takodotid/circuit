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

/** A computer with the devices' console cables plugged into it, such as a laptop beside the rack. Circuit logs in to it over SSH, and it needs Python 3. */
export type Jump = {
    /** Its address or name. */
    host: string;
    /** The user Circuit logs in as. It must be allowed to open the serial ports. */
    user: string;
    /** The user's password. */
    password: Secret;
    /** SSH port. 22 when absent. */
    port?: number;
    /** Set it if the jump host is behind a Cloudflare Tunnel. Circuit then connects with `cloudflared access ssh`, so `cloudflared` must be installed on your computer. */
    cloudflared?: true;
};

/** A serial console, on a jump host or on the computer Circuit runs on. */
export type Console = {
    /** The jump host the console cable is plugged into. When absent, the cable is plugged into the computer Circuit runs on. */
    jump?: Jump;
    /** The serial port. On Linux or macOS it is a path under `/dev`. A path under `/dev/serial/by-path/` stays the same even if two adapters swap names. On Windows it is a COM port, such as `COM3`. */
    port: string;
    /** Line speed in bits per second, such as 9600 or 115200. */
    baud: number;
    /** Set it if the console asks only for a password, with no user name first. Circuit then types no user name, but still uses the password of `connection.user`. */
    password_only?: true;
};

/** How Circuit itself logs in. `U` is the device's user names. */
export type Connection<U extends string> = {
    /** The management address Circuit connects to. Circuit doesn't take it from an interface, so write it here. Leave it out for a device you reach only through its console. */
    host?: IP;
    /** The user Circuit logs in as, from `system.users`. Circuit logs in with its password, or with one of its `ssh_keys`. */
    user: U;
    /** SSH port. 22 when absent. */
    port?: number;
    /** The device's serial console, used with `--console`. It is the way in before the device has a management address, or when the management network is down. */
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
    /** Keys of `interfaces.bridge`, `.loopback`, `.gre`, `.vxlan`, `.wireguard`, and `.eoip`. */
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
    /** Every port and interface: `port`, `lag`, `vlanInterface`, and `interface` together. */
    anyInterface: string;
};

/**
 * The groups of a device. A part can add to each of them too. `N` holds the names the device declares, `Ethernet` its ports. `Part` is true in a part, where BGP holds only what the part adds. `Net` is what the network writes: whether it turns on the check `untrusted_vlans`, and its `communities`.
 */
export type Groups<N extends Names, Ethernet, Part extends boolean = false, Net extends NetworkFacts = AnyFacts> = {
    /** The device itself: banner, time, the DNS servers it uses, users, certificates, local logs, software, and hardware. */
    system?: System<N["user"], N["certificate"], NoInfer<N["anyInterface"]>, NoInfer<N["vrf"]>>;
    /** How people and tools log in, such as SSH, HTTPS, the API, the native protocol, and the console. */
    management?: Management<NoInfer<N["anyInterface"]>, NoInfer<N["certificate"]>, NoInfer<N["addressSet"]>, NoInfer<N["vrf"]>>;
    /** What the device reports to collectors: SNMP, syslog, flow export, and optics. */
    monitoring?: Monitoring<NoInfer<N["anyInterface"]>, NoInfer<N["certificate"]>, NoInfer<N["vrf"]>>;
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
    /** Layer 2 settings the ports share: VLANs, STP, LLDP, and ACLs. */
    switching?: Switching<N["vlan"], N["acl"], NoInfer<N["anyInterface"]>, Net["untrusted"]>;
    /** What the device serves to hosts: DHCP server, DHCP relay, DNS server, NTP server, and UPnP. */
    services?: Services<NoInfer<N["anyInterface"]>>;
    /** Where packets go: routing tables, VRFs, policy routing, static routes, BGP, OSPF, BFD, RPKI, route policies, and prefix sets. */
    routing?: Routing<N["policy"], N["prefixSet"], N["neighborGroup"], N["table"], N["vrf"], NoInfer<N["anyInterface"]>, Part, Net>;
    /** Which packets pass, and how they are rewritten: address sets, interface sets, filter, NAT, TCP MSS clamps, untracked prefixes, and connection-tracking helpers. */
    firewall?: Firewall<N["addressSet"], NoInfer<N["anyInterface"]>, N["interfaceSet"]>;
};

/**
 * Everything one device runs. Circuit removes from the device, or sets back to its default, anything not written here.
 *
 * `N` holds the names it declares, so a reference to a name it does not declare is an error. `Ethernet` is its ports, checked against the model. `Site` is the network's sites. `Net` is what the network writes: whether it turns on the check `untrusted_vlans`, and its `communities`.
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
    /** Its hostname. It is also its name in the network, and the key a source uses to give it a part. */
    name: Name;
    /** The site it is at, from the network's `sites`. It is also its site in NetBox and its group in LibreNMS. */
    site: Site;
    /** Its role in NetBox, such as `Core switch`. If NetBox has no role with that name, Circuit creates it. */
    role?: string;
    /** Its operating system. It decides how Circuit writes the config and talks to the device. */
    platform: Platform;
    /** Its hardware model, from the platform's list. It decides which port names exist. */
    model: Model;
    /** How Circuit itself logs in. */
    connection: Connection<NoInfer<N["user"]>>;
} & Groups<N, Ethernet, false, Net>;

/**
 * A part of a device, which a source gives it under its hostname. It holds what an upstream, a tenant, or a monitoring host adds to the device. The device or one of its parts must declare each name it uses.
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
 * A part of one or more devices, written in its own file. A source gives it to each device under the device's hostname. For example: an upstream's VLAN, sessions and policies on the router; a tenant's ports on a switch; or what every device sends to the monitoring hosts.
 *
 * It has a device's fields, except those only a whole device has: its site, platform, and model. Some fields a device needs are optional in a part, so a part can add BGP neighbors without the AS, or a console without the user.
 *
 * Circuit checks the names a part uses, such as a VLAN, an interface, or a policy, once the part reaches a device. That device or one of its parts must declare them.
 */
export type DevicePart = Part<AnyNames, Record<string, AnyPort>>;
