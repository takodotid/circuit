// Every tenant. A tenant joins by being added here, and leaves by being removed: the next apply takes away everything it had.

import acme from "./acme";

export const TENANTS = [acme] as const;
