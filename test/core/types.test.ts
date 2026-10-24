// What the types refuse while a device file is written. `bun run typecheck` checks these: each `@ts-expect-error` line must fail to compile, and every other line must compile. The test itself only makes sure the file loads.

import { expect, test } from "bun:test";
import { Bgp } from "../../src/helpers";
import type { ModelName, PlatformName, PortName } from "../../src";
import type {
    AlarmSeverity,
    Endpoint,
    IP,
    LargeCommunity,
    LargeCommunityPattern,
    MacAddress,
    OspfAreaId,
    Prefix,
    ReleaseChannel,
    StandardCommunity,
    StandardCommunityPattern,
    TimeZone,
} from "../../src/schema";

test("addresses take their shape", () => {
    const right: [IP, IP, Prefix, Prefix] = ["10.0.0.1", "2001:db8::1", "10.0.0.0/24", "2001:db8::/32"];

    // @ts-expect-error An IPv4 address has four numbers.
    const short: IP = "10.0.0";
    // @ts-expect-error A prefix has a length.
    const noLength: Prefix = "10.0.0.1";
    // @ts-expect-error Three numbers and a length is not a prefix.
    const shortPrefix: Prefix = "10.0.0/24";
    // @ts-expect-error A name is not an address.
    const name: IP = "router.example.net";

    expect([right, short, noLength, shortPrefix, name]).toHaveLength(5);
});

test("communities take their shape, and only a list to remove takes *", () => {
    const right: [StandardCommunity, LargeCommunity, StandardCommunityPattern, LargeCommunityPattern] = [
        "64500:100",
        "64500:1:6939",
        "64500:*",
        "64500:*:*",
    ];

    // @ts-expect-error A large community has three parts.
    const large: LargeCommunity = "64500:1";
    // @ts-expect-error A standard community has two parts.
    const standard: StandardCommunity = "64500:1:1";
    // @ts-expect-error `*` only matches, in a list of communities to remove.
    const wildcard: StandardCommunity = "64500:*";

    expect([right, large, standard, wildcard]).toHaveLength(4);
});

test("Bgp.communityScheme gives back the communities it makes", () => {
    const communities = Bgp.communityScheme({
        asn: 64500,
        learned_from: { function: 1, classes: { transit: 1, customer: 3 } },
        blackhole: { function: 666, upstreams: { 64501: "64501:666" } },
    });

    const customer: "64500:1:3" = communities.learned_from.customer;
    const own: "64500:200:0" = communities.community(200, 0);
    communities.tag("transit", 6939);

    // @ts-expect-error Only the classes the scheme declares.
    communities.tag("trasnit", 6939);
    // @ts-expect-error Only the classes the scheme declares.
    const missing = communities.learned_from.peer;
    // @ts-expect-error An upstream's blackhole community is a standard one.
    Bgp.communityScheme({ asn: 64500, blackhole: { function: 666, upstreams: { 64501: "64501:666:0" } } });
    // @ts-expect-error A misspelled field is refused.
    Bgp.communityScheme({ asn: 64500, do_not_anounce: 100 });

    expect([customer, own, missing]).toEqual(["64500:1:3", "64500:200:0", undefined]);
});

test("other fixed values are suggested and checked", () => {
    const right: [TimeZone, TimeZone, MacAddress, Endpoint, OspfAreaId, ReleaseChannel, AlarmSeverity] = [
        "Asia/Jakarta",
        "UTC",
        "02:00:00:00:00:01",
        "vpn.example.net:51820",
        "0.0.0.0",
        "long-term",
        "warning",
    ];

    // @ts-expect-error Not an IANA zone.
    const zone: TimeZone = "Asia/Bandung";
    // @ts-expect-error A MAC address has six parts.
    const mac: MacAddress = "02:00:00:00:01";
    // @ts-expect-error An endpoint has a port.
    const endpoint: Endpoint = "vpn.example.net";
    // @ts-expect-error An area ID is dotted.
    const area: OspfAreaId = "0";
    // @ts-expect-error Not a release channel.
    const channel: ReleaseChannel = "lts";
    // @ts-expect-error A log severity, not an alarm's.
    const severity: AlarmSeverity = "error";

    expect([right, zone, mac, endpoint, area, channel, severity]).toHaveLength(7);
});

test("a project names a model's ports in types of its own, for any platform and model", () => {
    /** A tenant's ports on one switch, typed by the switch's model. */
    type TenantPorts<P extends PlatformName, M extends ModelName<P>> = Partial<Record<PortName<P, M>, string>>;
    const tenant = <P extends PlatformName, M extends ModelName<P>>(_platform: P, _model: M, ports: TenantPorts<P, M>) => ports;

    const right = tenant("junos", "QFX5100-48S-6Q", { "10g-1": "Tenant A", "40g-6": "Tenant A uplink" });
    // @ts-expect-error The QFX5100-48S-6Q has 48 10G ports.
    const noPort = tenant("junos", "QFX5100-48S-6Q", { "10g-49": "Tenant B" });
    // @ts-expect-error Not a model of that platform.
    const noModel = tenant("junos", "CE6855-48S6Q-HI", {});

    expect([right, noPort, noModel]).toHaveLength(3);
});
