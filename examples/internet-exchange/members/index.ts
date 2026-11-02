// Every member, merged whole. A member joins by being added here, and leaves by being removed: the next apply turns its port off.

import { member_a } from "./member-a";
import { member_b } from "./member-b";

export const members = merge([member_a, member_b]);
