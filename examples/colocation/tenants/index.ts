// Every tenant, merged whole. A new tenant joins the list.

import { acme } from "./acme";

export const tenants = merge([acme]);
