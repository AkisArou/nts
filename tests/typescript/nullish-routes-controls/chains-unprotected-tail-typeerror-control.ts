/*---
description: "An optional base does not protect an undefined inner field. Route: unchecked indexed array read through a required interface field (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// An optional base does not protect an undefined inner field. Route: unchecked indexed array read through a required interface field. Node prints chains-unprotected-tail-typeerror:ok.
interface Inner { x: number }
interface Outer { inner: Inner }
const list: Inner[] = [];
const outer: Outer = { inner: list[0] };
assert.throws(TypeError, () => {
  const saved = outer; const result = saved === null || saved === undefined ? undefined : saved.inner.x; void result;
});
console.log("chains-unprotected-tail-typeerror:ok");
