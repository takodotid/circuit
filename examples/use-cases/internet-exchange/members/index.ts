// Every member. A member joins by being added here, and leaves by being removed: the next apply shuts its port.

import exampleCdn from "./example-cdn";
import exampleIsp from "./example-isp";

export const MEMBERS = [exampleIsp, exampleCdn];
