// The path check before an apply: reading what `ping` printed on each system, and deciding from the numbers whether to go ahead.

import { expect, test } from "bun:test";
import { PathCheck } from "../../src/transport/path-check";

const windows = [
    "Pinging 192.0.2.1 with 32 bytes of data:",
    "Reply from 192.0.2.1: bytes=32 time=12ms TTL=60",
    "Request timed out.",
    "Reply from 192.0.2.1: bytes=32 time<1ms TTL=60",
    "Reply from 192.0.2.9: Destination host unreachable.",
    "",
    "Ping statistics for 192.0.2.1:",
    "    Packets: Sent = 4, Received = 3, Lost = 1 (25% loss),",
    "Approximate round trip times in milli-seconds:",
    "    Minimum = 0ms, Maximum = 12ms, Average = 6ms",
].join("\r\n");

const windowsIpv6 = [
    "Pinging 2001:db8::1 with 32 bytes of data:",
    "Reply from 2001:db8::1: time=3ms",
    "Reply from 2001:db8::1: time=5ms",
].join("\r\n");

const linux = [
    "PING 192.0.2.1 (192.0.2.1) 56(84) bytes of data.",
    "64 bytes from 192.0.2.1: icmp_seq=1 ttl=60 time=10.4 ms",
    "64 bytes from 192.0.2.1: icmp_seq=2 ttl=60 time=11.6 ms",
    "",
    "--- 192.0.2.1 ping statistics ---",
    "3 packets transmitted, 2 received, 33.3333% packet loss, time 2003ms",
    "rtt min/avg/max/mdev = 10.400/11.000/11.600/0.600 ms",
].join("\n");

test("a reply is a line with one time in milliseconds; summaries and unreachable lines are not", () => {
    expect(PathCheck.parse(windows)).toEqual([12, 1]);
    expect(PathCheck.parse(windowsIpv6)).toEqual([3, 5]);
    expect(PathCheck.parse(linux)).toEqual([10.4, 11.6]);
});

/** `received` replies of 20, each `ms` long. */
const measured = (received: number, ms: number) => ({ sent: 20, times: Array.from({ length: received }, () => ms) });

test("a clean, quick path goes ahead, and one lost ping of 20 is allowed", () => {
    expect(PathCheck.verdict("192.0.2.1", measured(20, 12))).toEqual({
        refuse: false,
        summary: "192.0.2.1: 0 of 20 pings lost (0%), 12 ms on average",
    });
    expect(PathCheck.verdict("192.0.2.1", measured(19, 12)).refuse).toBe(false);
});

test("a path that loses two pings of 20, or is slow, is refused", () => {
    expect(PathCheck.verdict("192.0.2.1", measured(18, 12))).toEqual({
        refuse: true,
        summary: "192.0.2.1: 2 of 20 pings lost (10%), 12 ms on average",
    });
    expect(PathCheck.verdict("192.0.2.1", measured(20, PathCheck.MAX_AVERAGE_MS + 1)).refuse).toBe(true);
});

test("a device that answers no ping is not refused for that alone", () => {
    expect(PathCheck.verdict("192.0.2.1", measured(0, 0))).toEqual({
        refuse: false,
        summary: "192.0.2.1 answers no ping, so the path to it was not measured",
    });
});
