# Tools

Studio's **Tools** answer the questions that come up when something does not reach where it should. They read each field of your files as Circuit does. A device can still behave otherwise, so they say what your config means, not what a device did.

## Trace an address

Give an address, such as `10.0.10.5`, and Studio shows:

- which device and interface have it, the segment it is in, and what else uses that segment;
- how each device would reach it: its own address, an address in the same prefix, or a static route, picked by the longest prefix in each routing table;
- every firewall rule and ACL that uses it, by address, prefix or address set.

Routes a device learns from BGP or OSPF are not in your files, so a device with no route here may still reach the address. A trace has its own address, such as `#tools/trace/10.0.10.5`, to bookmark or send.

## VLAN path

Pick a VLAN and two devices, and Studio finds the fewest cables that carry the VLAN from one to the other, from the ports' VLANs and links.
