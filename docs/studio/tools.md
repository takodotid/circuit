# Tools

Studio's **Tools** help when something doesn't reach where it should. They read your files, so they show what your config means, not what a device did.

## Trace an address

Give an address, such as `192.0.2.5`, and Studio shows:

- which device and interface hold it, and the segment, block, or address space it is in, with what else uses that range;
- how each device would reach it: its own address, an address in the same prefix, or a static route, picked by the longest prefix in each routing table;
- every firewall rule, NAT rule, and ACL that matches it, by address, prefix, or address set.

Routes a device learns from BGP or OSPF are not in your files, so a device with no route here may still reach the address. A trace's address is like `/tools/trace/192.0.2.5`.

## VLAN path

Pick a VLAN and two devices, and Studio finds the fewest cables that carry the VLAN from one to the other. **Show in the graph** lights the path on the VLANs layer. A path's address is like `/tools/vlan?vlan=users&from=sw-01&to=sw-02`.

## Test a firewall

1. Pick the device and its filter chain: `input`, `forward`, or `output`.
2. Describe the packet: its protocol, addresses, ports, the interfaces it arrives on and leaves through, its connection state, how NAT translated it, and its TCP flags. Leave out what you don't know.
3. Press **Test**.

Studio shows, for each rule in order, whether the packet matches, and why not. The first rule that matches decides. When none does, the chain's `default_action` decides, and a chain with no `default_action` accepts.

Studio stops at a rule that needs something you left empty, such as the destination port, and says what it needs. A rule that fails on something you did give, such as the protocol, is passed over, even when it also names something you left empty.

A rule written with a list, such as several sources or an interface set, is one rule per value in the table, as the device gets it. The test's address is like `/tools/firewall?device=edge-01&chain=input&protocol=tcp&src=203.0.113.1&dst_port=179&state=new`.

## Test a route policy

1. Pick the device and the policy. Each policy says which BGP sessions use it for import or export.
2. Describe the route: its prefix, its AS path as it arrives (each AS, prepends too, such as `6939 64501`), its RPKI state, and its communities and large communities.
3. Press **Test**.

Studio shows, for each rule in order, what matched, what changed, and the decision, then what the route carries once accepted. A route no rule accepts is rejected. A `{ communities }` rule shows as the rules Circuit writes for it.

Two things your files can't tell:

- **A prefix set** holds a route when the route's prefix is one of the set's prefixes, or is inside one.
- **A prefix set from a registry** (one with `source`) is fetched only by `circuit diff` and `circuit apply`, so tick the ones the route is in.

The test's address is like `/tools/policy?device=edge-01&policy=transit-import&prefix=203.0.113.0/24&as_path=6939+64501&rpki=valid`.
