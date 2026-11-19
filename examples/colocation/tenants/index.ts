// Every tenant, merged whole. A new tenant joins the list.
// `empty` holds no tenant. It keeps tenants.parts and tenants.rules there for the devices when the last tenant leaves.

import { argon } from "./argon";

const empty = { parts: {}, rules: { edge_acl: part("acl", []) } };

export const tenants = merge([empty, argon]);
