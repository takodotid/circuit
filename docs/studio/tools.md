# Tools

Studio's **Tools** answer the questions that come up when something does not reach where it should. They read your files as the schema describes each field. A device can still behave otherwise, so they say what your config means, not what a device did.

## Trace an address

Give an address, such as `10.0.10.5`, and Studio shows:

- which device and interface hold it, the segment it is in, and what else uses that segment;
- how each device would reach it: its own address, an address in the same prefix, or a static route, picked by the longest prefix in each routing table;
- every firewall rule and ACL that names it, by address, prefix or address set.

Routes a device learns from BGP or OSPF are not in your files, so a device with no route here may still reach the address. A trace has its own address, such as `#tools/trace/10.0.10.5`, to bookmark or send.

## VLAN path

Pick a VLAN and two devices, and Studio finds the fewest cables that carry the VLAN from one to the other, from the ports' VLANs and links. **Show in the graph** lights them up on the VLANs layer.

## Test a firewall

Describe a packet: the device and its filter chain, protocol, source and destination, ports, the interfaces it arrives on and leaves through, its connection state and TCP flags. Studio goes through the chain's rules in order and shows, for each one, whether the packet matches and why not. The first rule that matches decides; when none does, the chain's default does, and a chain with no default accepts.

When a rule depends on something you left empty, such as the source port, Studio stops there and says what it needs.

## Test a route policy

Describe a route: the device and the policy, picked by the BGP sessions that use it, the prefix, the AS path length as the route arrives, its RPKI state and its communities. Studio goes through the policy rule by rule, `call`, then `match`, then `set`, then `action`, and shows what matched, what changed and the decision. A route the policy never accepts is rejected.

Two things the files cannot tell:

- **Prefix sets from a registry** are filled by [`circuit refresh`](/guide/scheduled-refresh), so tick the ones the route is in.
- **A prefix set** holds a route whose prefix is one of the set's own, or inside one.
