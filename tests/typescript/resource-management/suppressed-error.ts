/*---
description: When disposal throws during an exception, a SuppressedError carries both errors.
features: [ts-using, ts-errors]
---*/
let caught: unknown;
try {
  using broken = {
    [Symbol.dispose](): void {
      throw new TypeError("dispose failed");
    },
  };
  throw new RangeError("body failed");
} catch (error) {
  caught = error;
}
assert.sameValue(caught instanceof SuppressedError, true);
const suppressed = caught as SuppressedError;
assert.sameValue(suppressed.error instanceof TypeError, true);
assert.sameValue(suppressed.suppressed instanceof RangeError, true);
