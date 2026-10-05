# TODO

- An internet exchange's fabric needs, per member port, a MAC address limit and an ethertype filter allowing only IPv4, IPv6 and ARP. Then route server config, for BIRD or OpenBGPD, from the member list. See docs/use-cases/internet-exchange.md.
- A stable 1.0.0, once the schema and the CLI stop changing.
- After 1.0.0: config in Pkl beside TypeScript, for those who would rather not write code. A Pkl schema generated from the TypeScript one, so both stay in step, and a loader that turns Pkl into the same devices. Pkl is typed, reads like data, and has editor support; CUE was judged too hard to learn, Jsonnet untyped.
