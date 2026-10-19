/*---
description: Two modules importing each other call each other's hoisted functions once both are evaluated.
features: [ts-modules, ts-imports, ts-functions]
flags: [module]
---*/
import { isEven } from "./cycle-a_FIXTURE.js";
import { isOdd } from "./cycle-b_FIXTURE.js";
assert.sameValue(isEven(10), true);
assert.sameValue(isOdd(7), true);
assert.sameValue(isEven(3), false);
