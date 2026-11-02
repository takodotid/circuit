// member-a, AS64510: one port on ix-sw-01. Its addresses on the peering LAN are for the route servers, which Circuit does not configure.

import { ix_1 } from "../sites/ix-1/site";

export const member_a = {
    parts: {
        "ix-sw-01": part("device", {
            interfaces: { ethernet: { "40g-1": { ...ix_1.member_port, description: "member-a, AS64510" } } },
        }),
    },
};
