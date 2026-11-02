// Google, AS15169: one port on ix-sw-02.

import { ix_1 } from "../sites/ix-1/site";

export const google = {
    parts: {
        "ix-sw-02": part("device", {
            interfaces: { ethernet: { "40g-1": { ...ix_1.member_port, description: "Google, AS15169" } } },
        }),
    },
};
