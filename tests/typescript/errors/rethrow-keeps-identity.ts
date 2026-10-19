/*---
description: Rethrowing a caught error passes the same object outwards, through nested handlers.
features: [ts-errors, ts-unknown]
---*/
const original = new RangeError("deep");
let middleSaw: unknown;
let outerSaw: unknown;
try {
  try {
    throw original;
  } catch (error) {
    middleSaw = error;
    throw error;
  }
} catch (error) {
  outerSaw = error;
}
assert.sameValue(middleSaw, original);
assert.sameValue(outerSaw, original);
