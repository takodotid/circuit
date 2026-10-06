// Every member. A member joins by being added here, and leaves by being removed: the next apply shuts its port.

import acme from "./acme";
import akamai from "./akamai";
import cloudflare from "./cloudflare";

export const MEMBERS = [cloudflare, akamai, acme];
