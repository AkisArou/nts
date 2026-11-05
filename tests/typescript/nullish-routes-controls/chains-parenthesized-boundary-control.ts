/*---
description: "Parentheses end an optional chain before its next member. Route: out-of-bounds array element as required inner field (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Parentheses end an optional chain before its next member. Route: out-of-bounds array element as required inner field. Node prints chains-parenthesized-boundary:ok.
interface Inner { x: number }
interface Outer { inner: Inner }
const list: Inner[] = [];
const outer: Outer = { inner: list[0] };
assert.throws(TypeError, () => {
  const saved = outer; const selected = saved === null || saved === undefined ? undefined : saved.inner; const result = selected.x; void result;
});
console.log("chains-parenthesized-boundary:ok");
