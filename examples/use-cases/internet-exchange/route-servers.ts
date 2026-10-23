// Writes each route server's BIRD config beside this file: `bun route-servers.ts`. Run it again whenever the member list changes, then copy the files to the servers the way you copy any file, and reload BIRD there with `birdc configure`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { exchange, ROUTE_SERVERS } from "./exchange";

for (const server of ROUTE_SERVERS) {
    const path = join(import.meta.dirname, `${server.name}.conf`);

    writeFileSync(path, exchange.bird(server));
    console.log(`${server.name}: ${path}`);
}
