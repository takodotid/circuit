// Runs vue-tsc with tsc's arguments on TypeScript 6: vue-tsc needs TypeScript's JavaScript API, which TypeScript 7 doesn't have.

import { run } from "vue-tsc";

run(require.resolve("typescript-6/lib/tsc"));
