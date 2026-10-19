/*---
description: An exported class is in its temporal dead zone until its declaration runs; a function using it earlier throws ReferenceError.
features: [ts-modules, ts-exports, ts-class]
flags: [module]
---*/
function make(): Later {
  return new Later();
}
assert.throws(ReferenceError, () => {
  make();
});
export class Later {
  readonly ready = true;
}
assert.sameValue(make().ready, true);
