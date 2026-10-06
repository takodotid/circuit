# TODO

- Internet exchange, when there is time: per member port, a MAC address limit and an ethertype filter allowing only IPv4, IPv6 and ARP; then route server config, for BIRD or OpenBGPD, from the member list. See docs/use-cases/internet-exchange.md.
- `circuit rename`: rename a device or a site in one command, everywhere it is named: its file, its `name`, the `link` on the far end of each cable, and the checks. Held: rename is what matters, a scaffold for new files is not.
- A web view to host, such as network.tako.id: `circuit serve`, in this repository and this package, with the interface built at release. First the inventory from config and snapshots, then live state over SNMP or SSH, then history. It needs a way to run in the background, as a service or a container. To be discussed before it starts.
- A stable 1.0.0, once the schema and the CLI stop changing.
- After 1.0.0: config in Pkl beside TypeScript, for those who would rather not write code. A Pkl schema generated from the TypeScript one, so both stay in step, and a loader that turns Pkl into the same devices. Pkl is typed, reads like data, and has editor support; CUE was judged too hard to learn, Jsonnet untyped.
