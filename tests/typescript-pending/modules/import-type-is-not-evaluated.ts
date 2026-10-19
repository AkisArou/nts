/*---
description: An `import type` is erased, so the module it names is not evaluated.
features: [ts-modules, ts-imports, ts-import-type]
flags: [module]
---*/
import type { Shape } from "./shape-types_FIXTURE.js";
const square: Shape = { area: () => 4 };
assert.sameValue(square.area(), 4);
assert.sameValue((globalThis as { evaluated?: string[] }).evaluated, undefined);
