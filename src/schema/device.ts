import type { IP, Secret } from "./common";
import type { AclRule, Firewall } from "./firewall";
import type { Interface, Port, Vlan } from "./interfaces";
import type { PrefixSet, RoutePolicy } from "./policy";
import type { Routing } from "./routing";
import type { Certificate, DhcpRelay, DhcpServer, FlowExport, Management, System, User } from "./system";

/** How the framework reaches the device. */
export type Connection<U extends string> = {
    /** Management address. Absent for a device reached only through its console, `console`. */
    host?: IP;
    /** One of the device's `users`. Its password is the login. */
    user: U;
    /** SSH port. 22 when absent. */
    port?: number;
    /** The device's serial console, for `--console`: the way in before the device has a management address, or when its management network is down. */
    console?: Console;
};

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
};

/** A separate routing table, with the interfaces that route in it. */
export type Vrf = {
    /** What the VRF is for. */
    description?: string;
};

/**
 * Everything one device runs. What is not written here is removed from the device or returned to its default.
 *
 * Type parameters are the names the device declares, so a reference to a name that does not exist fails to compile: N ports, V VLANs, I interfaces, P policies, S prefix sets, G BGP groups, A ACLs, AS address sets, U users, F VRFs, C certificates.
 */
export type Device<
    Pl extends string = string,
    M extends string = string,
    N extends string = string,
    V extends string = string,
    I extends string = string,
    P extends string = string,
    S extends string = string,
    G extends string = string,
    A extends string = string,
    AS extends string = string,
    U extends string = string,
    F extends string = string,
    C extends string = string,
> = {
    /** Hostname. */
    name: string;
    /** Operating system. It decides which adapter renders and applies the device. */
    platform: Pl;
    /** Hardware model. Decides which port names exist. */
    model: M;
    /** How the framework logs in. */
    connection: Connection<NoInfer<U>>;
    /** Device-wide settings. */
    system?: System;
    /** Logins, keyed by user name. Users not listed are removed. */
    users?: Record<U, User>;
    /** Ways in, and who may use them. */
    management?: Management<NoInfer<I | N>, NoInfer<C>>;
    /** Certificates, keyed by name. */
    certificates?: Record<C, Certificate>;
    /** VLANs, keyed by name. */
    vlans?: Record<V, Vlan>;
    /** Physical ports, keyed by `<speed>-<position>`. */
    ports?: Partial<Record<N, Port<NoInfer<V>, NoInfer<A>, NoInfer<I>, NoInfer<F>>>>;
    /** Interfaces that are not physical ports, keyed by name. */
    interfaces?: Record<I, Interface<NoInfer<V>, NoInfer<F>>>;
    /** Separate routing tables, keyed by name. */
    vrfs?: Record<F, Vrf>;
    /** Static routes, BGP, OSPF and route validation. */
    routing?: Routing<NoInfer<P>, G, NoInfer<I | N>, NoInfer<F>>;
    /** Route policies, keyed by name. */
    policies?: Record<P, RoutePolicy<NoInfer<P>, NoInfer<S>>>;
    /** Prefix sets that policies match on, keyed by name. */
    prefix_sets?: Record<S, PrefixSet>;
    /** Packet filtering and address translation. */
    firewall?: Firewall<NoInfer<I | N>, AS>;
    /** Hardware ACLs, keyed by name, applied to a port with `acl`. */
    acls?: Record<A, readonly AclRule<NoInfer<V>>[]>;
    /** DHCP servers, keyed by name. */
    dhcp?: Record<string, DhcpServer<NoInfer<I | N>>>;
    /** DHCP relays, keyed by name. */
    dhcp_relay?: Record<string, DhcpRelay<NoInfer<I | N>>>;
    /** Flow records or packet samples sent to collectors. */
    flow_export?: FlowExport<NoInfer<I | N>>;
    /** Advertise and learn neighbors with LLDP on every port, or only on the interfaces listed. A port may override it. */
    lldp?: true | { interfaces: readonly NoInfer<I | N>[] };
    /** Spanning tree on every switched port. A port may override it. */
    stp?: {
        /** Which variant runs. RSTP when absent. */
        mode?: "stp" | "rstp" | "mstp";
        /** Bridge priority, 0 to 61440 in steps of 4096. Lower wins the root election. */
        priority?: number;
    };
    /** Forward in hardware where the platform can. An interface may override it. */
    hardware_offload?: boolean;
};
