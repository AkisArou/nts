/*---
description: Calling an absent optional method through a non-null assertion throws TypeError at the call.
features: [ts-errors, ts-non-null, ts-optional-properties]
---*/
interface Addon {
  name: string;
  init?(): string;
}
const withInit: Addon = { name: "a", init: () => "ready" };
const without: Addon = { name: "b" };
assert.sameValue(withInit.init!(), "ready");
assert.throws(TypeError, () => {
  without.init!();
});
