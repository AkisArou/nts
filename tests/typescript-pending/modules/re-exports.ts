/*---
description: `export *`, a renaming re-export and `export * as` re-export one module's bindings through another.
features: [ts-modules, ts-imports, ts-exports]
flags: [module]
---*/
import { pi, square, sq, all } from "./barrel_FIXTURE.js";
assert.sameValue(sq, square);
assert.sameValue(all.square, square);
assert.sameValue(all.pi, pi);
assert.sameValue(sq(5), 25);
