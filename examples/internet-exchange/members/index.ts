// Every member, merged whole. A member joins by being added here, and leaves by being removed: the next apply turns its port off.
// `empty` holds no member. It keeps members.parts there for the switches when the last member leaves.

import { cloudflare } from "./cloudflare";
import { google } from "./google";

const empty = { parts: {} };

export const members = merge([empty, cloudflare, google]);
