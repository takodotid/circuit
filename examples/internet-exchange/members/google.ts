// member-b, AS64511: one port on ix-sw-02.

import { ix_1 } from "../sites/ix-1/site";

export const member_b = {
    parts: {
        "ix-sw-02": part("device", {
            interfaces: { ethernet: { "40g-1": { ...ix_1.member_port, description: "member-b, AS64511" } } },
        }),
    },
};
