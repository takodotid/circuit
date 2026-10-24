// Writes each route server's config beside this file, for BIRD and for OpenBGPD: `bun route-servers.ts`. Run it again whenever the member list changes, copy the file for the software the server runs, and reload it there: `birdc configure` for BIRD, `bgpctl reload` for OpenBGPD.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { exchange, ROUTE_SERVERS } from "./exchange";

for (const server of ROUTE_SERVERS) {
    const bird = join(import.meta.dirname, `${server.name}.bird.conf`);
    const openbgpd = join(import.meta.dirname, `${server.name}.bgpd.conf`);

    writeFileSync(bird, exchange.bird(server));
    writeFileSync(openbgpd, exchange.openbgpd(server));
    console.log(`${server.name}: ${bird}, ${openbgpd}`);
}
