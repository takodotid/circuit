# Tools

Studio's **Tools** answer the questions that come up when something does not reach where it should. They read each field of your files as Circuit does. A device can still behave otherwise, so they say what your config means, not what a device did.

Each tool has its own address, to bookmark or send.

## Trace an address

Give an address, such as `192.0.2.5`, and Studio shows:

- which device and interface hold it;
- how each device would reach it: its own address, an address in the same prefix, or a static route, picked by the longest prefix in each routing table;
- every firewall rule, NAT rule and ACL that names it, by address, prefix or address set.

Routes a device learns from BGP or OSPF are not in your files, so a device with no route here may still reach the address. A trace's address is like `#tools/trace/192.0.2.5`.

## VLAN path

Pick a VLAN and two devices, and Studio finds the fewest cables that carry the VLAN from one to the other, from the ports' VLANs and links.

## Test a firewall

1. Pick the device and its filter chain: `input`, `forward` or `output`.
2. Describe the packet: protocol, source and destination, ports, the interface it arrives on and the one it leaves through, its connection state, how its connection was translated, and its TCP flags. Leave out what you don't know.
3. Press **Test**.

Studio goes through the chain's rules in order and shows, for each one, whether the packet matches and why not. The first rule that matches decides. When none does, the chain's `default_action` decides, and a chain with no `default_action` accepts.

When a rule needs something you left empty, such as the destination port, Studio stops at that rule and says what it needs. A rule that fails on something you did give, such as the protocol, is passed over, even when it also names something you left empty.

A rule written with a list, such as several sources or an interface set, is one rule per value in the table, as the device gets it. The test's address is like `#tools/firewall/device=edge-01&chain=input&protocol=tcp&src=203.0.113.1&dst_port=179&state=new`.

## Test a route policy

1. Pick the device and the policy. Each policy says which BGP sessions use it, as their import or export.
2. Describe the route: its prefix, its AS path as it arrives (each AS, prepends too, such as `6939 64501`), its RPKI state, and its communities and large communities.
3. Press **Test**.

Studio goes through the policy rule by rule. A `call` runs the policy it names: a route that policy accepts or rejects stops there, and any other goes on, with what that policy changed. Every other rule checks its `if`, then applies `set`, then `then` decides. Studio shows what matched, what changed and the decision, then what the route carries once accepted. A route no rule accepts is rejected.

A `{ communities: "import" }` or `{ communities: "export" }` rule shows as the rules Circuit writes for it, since those are what the device runs.

Two things your files can't tell:

- **A prefix set** holds a route when the route's prefix is one of the set's prefixes, or is inside one.
- **A prefix set from a registry** (one with `source`) is fetched only by `circuit diff` and `circuit apply`, so tick the ones the route is in.

The test's address is like `#tools/policy/device=edge-01&policy=transit-import&prefix=203.0.113.0%2F24&as_path=6939+64501&rpki=valid`.
