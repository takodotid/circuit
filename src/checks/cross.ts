// What one device declares about another has to agree with what the other declares.

import { X509Certificate } from "node:crypto";
import { Address } from "../core/address";
import type { Device, Finding, Gre, Ipsec, Prefix, Routed, Switched, Vxlan } from "../model";
import { Derive } from "../core/derive";
import { Utils } from "../core/utils";
import { DeviceChecks } from "./device";
import { Topology } from "../core/topology";
import type { Holder } from "../core/topology";

/** What a port's settings are kept on, as a path: the LAG when the port is in one, otherwise the port. */
type Carrier = { where: string; settings: Routed & Switched & { mtu?: number } };

type TunnelEnd = { device: Device; where: string; kind: "gre" | "vxlan" | "ipsec"; tunnel: Gre | Vxlan | Ipsec };

export class CrossChecks {
    /** An interface's MTU when the config gives none. */
    private static readonly ETHERNET_MTU = 1500;
    /** IANA's VXLAN port (RFC 7348), when the config gives none. */
    private static readonly VXLAN_PORT = 4789;

    private static readonly TUNNEL_NAMES: Record<TunnelEnd["kind"], string> = { gre: "GRE", vxlan: "VXLAN", ipsec: "IPsec" };

    /** What both ends of an IPsec tunnel must agree on: everything in `ike` and `esp` but the lifetimes, which each end keeps for itself (RFC 7296). */
    private static algorithms(tunnel: Ipsec): unknown {
        const { lifetime: _ike, ...ike } = tunnel.ike;
        const { lifetime: _esp, ...esp } = tunnel.esp;
        return { ike, esp };
    }

    /** Both ends of an IPsec tunnel authenticate the same way, and with certificates each end's CA signed the other's certificate. A file that can't be read is reported where it is written. */
    private static authentication(end: TunnelEnd, mirror: TunnelEnd): string | undefined {
        const ours = end.tunnel as Ipsec;
        const theirs = mirror.tunnel as Ipsec;
        const far = mirror.device.name;
        const way = (tunnel: Ipsec) => (tunnel.pre_shared_key ? "pre_shared_key" : "a certificate");

        if (way(ours) !== way(theirs))
            return `it authenticates with ${way(ours)}, and ${far} ${mirror.where} with ${way(theirs)}. Write the same way at both ends`;
        if (!ours.ca_certificate || !theirs.certificate) return undefined;

        const pem = (device: Device, name: string): X509Certificate | undefined => {
            const file = device.system?.certificates?.[name]?.certificate_file;
            try {
                return file ? new X509Certificate(Utils.projectFile(file)) : undefined;
            } catch {
                return undefined;
            }
        };
        const ca = pem(end.device, ours.ca_certificate);
        const certificate = pem(mirror.device, theirs.certificate);
        if (!ca || !certificate || (certificate.checkIssued(ca) && certificate.verify(ca.publicKey))) return undefined;

        return `ca_certificate ${ours.ca_certificate} did not sign ${far}'s certificate ${theirs.certificate}. Write the CA that signed it`;
    }

    static run(devices: readonly Device[]): Finding[] {
        const holders = Topology.holders(devices);
        const owners = Topology.owners(holders);

        return [
            ...CrossChecks.links(devices),
            ...CrossChecks.addresses(holders),
            ...CrossChecks.sessions(devices, owners),
            ...CrossChecks.vrrp(holders),
            ...CrossChecks.tunnels(devices, owners),
        ];
    }

    /** The VLAN ids a port or LAG carries, by how it carries them, so two ends can be compared across devices. */
    private static carried(device: Device, settings: Switched) {
        const id = (vlan: string | undefined) => (vlan ? device.switching?.vlans?.[vlan]?.id : undefined);
        return {
            access: id(settings.access_vlan),
            native: id(settings.native_vlan),
            trunk: (settings.trunk_vlans ?? []).map(id).sort((a, b) => (a ?? 0) - (b ?? 0)),
        };
    }

    /** How a port carries its VLANs, in words: "VLANs 10, 20 tagged and VLAN 30 untagged as native". */
    private static describeCarried({ access, native, trunk }: ReturnType<typeof CrossChecks.carried>): string {
        const parts: string[] = [];
        const tagged = trunk.filter((id) => id !== undefined);

        if (access !== undefined) parts.push(`VLAN ${access} untagged`);
        if (tagged.length) parts.push(`${tagged.length === 1 ? "VLAN" : "VLANs"} ${tagged.join(", ")} tagged`);
        if (native !== undefined) parts.push(`VLAN ${native} untagged as native`);

        return parts.length ? parts.join(" and ") : "no VLANs";
    }

    /** VLAN names by id, for the VLANs a port or LAG carries. */
    private static vlanNames(device: Device, settings: Switched): Map<number, string> {
        const names = [settings.access_vlan, settings.native_vlan, ...(settings.trunk_vlans ?? [])].filter((name) => name !== undefined);
        const vlans = device.switching?.vlans ?? {};

        return new Map(names.flatMap((name) => (vlans[name] ? [[vlans[name].id, name] as const] : [])));
    }

    private static carrierOf(device: Device, portName: string): Carrier {
        const port = device.interfaces!.ethernet![portName]!;
        const lag = port.in_lag ? device.interfaces?.lag?.[port.in_lag] : undefined;
        if (port.in_lag && lag) return { where: `interfaces.lag.${port.in_lag}`, settings: lag };

        return { where: `interfaces.ethernet.${portName}`, settings: port };
    }

    /** The plain addresses of one family on an interface, leaving out point-to-point ones. */
    private static plainAddresses(settings: Routed, family: string): string[] {
        return (settings.addresses ?? []).filter(
            (entry): entry is Prefix => typeof entry === "string" && Address.isCidr(entry) && Address.family(entry) === family
        );
    }

    /** Why the two ends of a cable cannot reach each other by address, or undefined when they can. */
    private static addressDisagreement(here: Routed, there: Routed, far: Device, farWhere: string): string | undefined {
        for (const family of ["ipv4", "ipv6"]) {
            const ours = CrossChecks.plainAddresses(here, family);
            const theirs = CrossChecks.plainAddresses(there, family);
            if (!ours.length || !theirs.length) continue;

            // A prefix includes its length, so 10.0.0.0/24 and 10.0.0.0/25 are not one.
            const theirPrefixes = new Set(theirs.map(Address.prefixOf));
            if (!ours.some((address) => theirPrefixes.has(Address.prefixOf(address)))) {
                return `has ${ours.join(", ")}, and ${far.name} ${farWhere} has ${theirs.join(", ")}: not one prefix of one length`;
            }
        }

        // A point-to-point address names the far end's own address as its peer.
        const farHosts = new Set((there.addresses ?? []).map((entry) => Topology.keyOf(Address.host(DeviceChecks.addressOf(entry)))));

        for (const entry of here.addresses ?? []) {
            if (typeof entry === "string" || !Topology.keyOf(entry.peer_address) || farHosts.has(Topology.keyOf(entry.peer_address)))
                continue;
            return `${entry.address} gives peer ${entry.peer_address}, which ${far.name} ${farWhere} does not hold`;
        }

        return undefined;
    }

    /** Both ends of a link carry the same VLANs the same way, through a LAG on both ends or neither, with the same MTU, speed and addresses. */
    private static links(devices: readonly Device[]): Finding[] {
        const findings: Finding[] = [];
        const byName = new Map(devices.map((device) => [device.name, device]));

        for (const device of devices) {
            for (const [portName, port] of Derive.ports(device)) {
                const link = port.link;
                if (!link) continue;

                // Reading the project stops on a far end that is missing or doesn't link back.
                const far = byName.get(link.device);
                const farPort = far?.interfaces?.ethernet?.[link.port];
                if (!far || !farPort || farPort.link?.device !== device.name || farPort.link.port !== portName) continue;

                const report = (message: string, level: Finding["level"] = "error") =>
                    findings.push({ level, device: device.name, message: `interfaces.ethernet.${portName}.link: ${message}` });

                const near = CrossChecks.carrierOf(device, portName);
                const away = CrossChecks.carrierOf(far, link.port);
                const farPortWhere = `${link.device} interfaces.ethernet.${link.port}`;

                // A LAG's VLANs are on the LAG, so its member ports are compared by what their LAGs carry.
                const inLag = near.where !== `interfaces.ethernet.${portName}`;
                const farInLag = away.where !== `interfaces.ethernet.${link.port}`;
                if (inLag !== farInLag) {
                    report(
                        inLag
                            ? `is in LAG ${port.in_lag}, and ${farPortWhere} is in no LAG`
                            : `is in no LAG, and ${farPortWhere} is in LAG ${farPort.in_lag}`
                    );
                }

                // Behind a QinQ port, the far end's VLANs are the customer's own.
                const here = CrossChecks.carried(device, near.settings);
                const there = CrossChecks.carried(far, away.settings);
                const qinq = near.settings.qinq_vlan || away.settings.qinq_vlan;
                if (!qinq && JSON.stringify(here) !== JSON.stringify(there)) {
                    report(
                        `${near.where} carries ${CrossChecks.describeCarried(here)}, and ${link.device} ${away.where} carries ${CrossChecks.describeCarried(there)}`
                    );
                }

                if (port.speed && farPort.speed && port.speed !== farPort.speed) {
                    report(`speed ${port.speed}, and ${farPortWhere} is ${farPort.speed}`);
                }

                const mtu = near.settings.mtu ?? CrossChecks.ETHERNET_MTU;
                const farMtu = away.settings.mtu ?? CrossChecks.ETHERNET_MTU;
                if (mtu !== farMtu) report(`MTU ${mtu} on ${near.where}, and ${link.device} ${away.where} has ${farMtu}`);

                const disagreement = CrossChecks.addressDisagreement(near.settings, away.settings, far, away.where);
                if (disagreement) report(`${near.where} ${disagreement}`);

                // One VLAN under two names works, but reads as two VLANs.
                const farNames = CrossChecks.vlanNames(far, away.settings);
                for (const [id, name] of CrossChecks.vlanNames(device, near.settings)) {
                    const farName = farNames.get(id);
                    if (farName && farName !== name) report(`VLAN ${id} is ${name} here and ${farName} on ${link.device}`, "warning");
                }
            }
        }

        return findings;
    }

    /** No address is held by two devices in one VRF. Two loopbacks may hold one on purpose, for anycast, so that is a warning. */
    private static addresses(holders: Holder[]): Finding[] {
        const findings: Finding[] = [];
        const first = new Map<string, Holder>();

        for (const holder of holders) {
            const key = `${holder.vrf ?? ""} ${Topology.keyOf(Address.host(holder.address))!}`;
            const earlier = first.get(key);

            if (!earlier) {
                first.set(key, holder);
                continue;
            }

            // Two on one device are reported by the device's own checks.
            if (earlier.device === holder.device) continue;

            const anycast = earlier.loopback && holder.loopback;

            findings.push({
                level: anycast ? "warning" : "error",
                device: holder.device.name,
                message: `${Address.host(holder.address)} on ${holder.where} is also on ${earlier.device.name} ${earlier.where}${anycast ? ", which is right only for anycast" : ""}`,
            });
        }

        return findings;
    }

    /** Each BGP neighbor's address, AS and source, with what it takes from its group. */
    private static sessionsOf(device: Device) {
        const bgp = device.routing?.bgp;

        return Object.entries(bgp?.neighbors ?? {}).map(([name, neighbor]) => {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;

            return {
                name,
                address: neighbor.address,
                remoteAs: neighbor.remote_as ?? group?.remote_as,
                localAddress: neighbor.local_address ?? group?.local_address,
            };
        });
    }

    /** A BGP session to an address another of our devices holds needs that device's session back, in the AS it expects, from the address it uses. */
    private static sessions(devices: readonly Device[], owners: Map<string, Holder>): Finding[] {
        const findings: Finding[] = [];

        for (const device of devices) {
            for (const session of CrossChecks.sessionsOf(device)) {
                const far = owners.get(Topology.keyOf(session.address) ?? "")?.device;
                if (!far || far === device) continue;

                const report = (message: string) =>
                    findings.push({ level: "error", device: device.name, message: `routing.bgp.neighbors.${session.name}: ${message}` });

                const farBgp = far.routing?.bgp;
                if (!farBgp) {
                    report(`${session.address} is ${far.name}'s, which runs no BGP`);
                    continue;
                }

                // A confederation shows its identifier to every router outside it (RFC 5065).
                const identifier = farBgp.confederation?.identifier;
                const inside = identifier === undefined || device.routing?.bgp?.confederation?.identifier === identifier;
                const farAs = inside ? farBgp.asn : identifier;
                if (session.remoteAs !== undefined && session.remoteAs !== farAs) {
                    report(`expects AS${session.remoteAs}, and ${far.name} is AS${farAs}`);
                }

                // Two routers often hold one session per family, and a session of the other family does not answer this one.
                const back = CrossChecks.sessionsOf(far).find(
                    (other) =>
                        owners.get(Topology.keyOf(other.address) ?? "")?.device === device &&
                        Address.family(other.address) === Address.family(session.address)
                );
                if (!back) {
                    report(`${far.name} has no session back to ${device.name}`);
                    continue;
                }

                // The far end only accepts the session from the address it uses.
                if (session.localAddress && Topology.keyOf(session.localAddress) !== Topology.keyOf(back.address)) {
                    report(
                        `starts from ${session.localAddress}, and ${far.name}'s routing.bgp.neighbors.${back.name} expects ${back.address}`
                    );
                }
            }
        }

        return findings;
    }

    /** On one segment, a VRRP id has one address and an address has one id, on every device. */
    private static vrrp(holders: Holder[]): Finding[] {
        const findings: Finding[] = [];
        const bySegment = new Map<string, { holder: Holder; id: number; address: string }[]>();

        for (const holder of holders) {
            const segment = Address.prefixOf(holder.address);

            for (const group of holder.vrrp) {
                if (!Topology.keyOf(group.address) || Address.family(group.address) !== Address.family(holder.address)) continue;
                if (!Address.contains(segment, group.address)) continue;

                bySegment.set(segment, [...(bySegment.get(segment) ?? []), { holder, id: group.id, address: group.address }]);
            }
        }

        for (const members of bySegment.values()) {
            for (const member of members) {
                const where = `${member.holder.device.name} ${member.holder.where}`;
                const others = members.filter((other) => other.holder.device !== member.holder.device);

                const sameId = others.find(
                    (other) => other.id === member.id && Topology.keyOf(other.address) !== Topology.keyOf(member.address)
                );
                if (sameId) {
                    findings.push({
                        level: "error",
                        device: member.holder.device.name,
                        message: `VRRP ${member.id} on ${member.holder.where} is ${member.address}, and on ${sameId.holder.device.name} ${sameId.holder.where} it is ${sameId.address}`,
                    });
                }

                const sameAddress = others.find(
                    (other) => Topology.keyOf(other.address) === Topology.keyOf(member.address) && other.id !== member.id
                );
                if (sameAddress) {
                    findings.push({
                        level: "error",
                        device: member.holder.device.name,
                        message: `VRRP address ${member.address} is id ${member.id} on ${where}, and id ${sameAddress.id} on ${sameAddress.holder.device.name} ${sameAddress.holder.where}`,
                    });
                }
            }
        }

        return findings;
    }

    /** A GRE, VXLAN, or IPsec tunnel to another of our devices has a tunnel back there, with the endpoints mirrored. VXLAN's has the same VNI and port, and IPsec's the same algorithms. */
    private static tunnels(devices: readonly Device[], owners: Map<string, Holder>): Finding[] {
        const findings: Finding[] = [];

        const ends: TunnelEnd[] = devices.flatMap((device) => [
            ...Object.entries(device.interfaces?.gre ?? {}).flatMap(([name, tunnel]) =>
                tunnel ? [{ device, where: `interfaces.gre.${name}`, kind: "gre" as const, tunnel }] : []
            ),
            ...Object.entries(device.interfaces?.vxlan ?? {}).flatMap(([name, tunnel]) =>
                tunnel ? [{ device, where: `interfaces.vxlan.${name}`, kind: "vxlan" as const, tunnel }] : []
            ),
            ...Object.entries(device.interfaces?.ipsec ?? {}).flatMap(([name, tunnel]) =>
                tunnel ? [{ device, where: `interfaces.ipsec.${name}`, kind: "ipsec" as const, tunnel }] : []
            ),
        ]);

        const same = (a: string, b: string) => Topology.keyOf(a) !== undefined && Topology.keyOf(a) === Topology.keyOf(b);
        const vniOf = (end: TunnelEnd) => (end.kind === "vxlan" ? (end.tunnel as Vxlan).vni : undefined);

        for (const end of ends) {
            const far = owners.get(Topology.keyOf(end.tunnel.remote_address) ?? "")?.device;
            if (!far || far === end.device) continue;

            const report = (message: string) =>
                findings.push({ level: "error", device: end.device.name, message: `${end.where}: ${message}` });
            const kind = CrossChecks.TUNNEL_NAMES[end.kind];

            // Two routers may run several VXLAN tunnels between them, one for each VNI, so a tunnel pairs with the one of its own VNI first.
            const back = ends.filter(
                (other) =>
                    other.device === far &&
                    other.kind === end.kind &&
                    same(other.tunnel.local_address, end.tunnel.remote_address) &&
                    same(other.tunnel.remote_address, end.tunnel.local_address)
            );
            const mirror = back.find((other) => vniOf(other) === vniOf(end)) ?? back[0];

            if (!mirror) {
                report(
                    `${end.tunnel.remote_address} is ${far.name}'s, which has no ${kind} tunnel from there back to ${end.tunnel.local_address}`
                );
                continue;
            }

            if (end.kind === "ipsec") {
                const algorithms = (tunnel: Ipsec) => JSON.stringify(CrossChecks.algorithms(tunnel));
                if (algorithms(end.tunnel as Ipsec) !== algorithms(mirror.tunnel as Ipsec))
                    report(`its algorithms differ from ${far.name} ${mirror.where}'s. Write the same ike and esp, but for their lifetimes`);

                const authentication = CrossChecks.authentication(end, mirror);
                if (authentication) report(authentication);
                continue;
            }

            if (end.kind !== "vxlan" || mirror.kind !== "vxlan") continue;

            const ours = end.tunnel as Vxlan;
            const theirs = mirror.tunnel as Vxlan;
            if (ours.vni !== theirs.vni) report(`VNI ${ours.vni}, and ${far.name} ${mirror.where} has ${theirs.vni}`);

            const port = ours.port ?? CrossChecks.VXLAN_PORT;
            const farPort = theirs.port ?? CrossChecks.VXLAN_PORT;
            if (port !== farPort) report(`UDP port ${port}, and ${far.name} ${mirror.where} has ${farPort}`);
        }

        return findings;
    }
}
