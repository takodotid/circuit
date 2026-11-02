// Every member, merged whole. A member joins by being added here, and leaves by being removed: the next apply turns its port off.

import { cloudflare } from "./cloudflare";
import { google } from "./google";

export const members = merge([cloudflare, google]);
