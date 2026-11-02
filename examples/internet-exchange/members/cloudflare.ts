// Cloudflare, AS13335: one port on ix-sw-01. Its addresses on the peering LAN are for the route servers, which Circuit does not configure.

import { ix_1 } from "../sites/ix-1/site";

export const cloudflare = {
    parts: {
        "ix-sw-01": part("device", {
            interfaces: { ethernet: { "40g-1": { ...ix_1.member_port, description: "Cloudflare, AS13335" } } },
        }),
    },
};
