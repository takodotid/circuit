// Every tenant. A tenant joins by being added here, and leaves by being removed: the next apply takes away everything it had.

import type { Tenant } from "../tenancy";
import acme from "./acme";

export const TENANTS: readonly Tenant[] = [acme];
