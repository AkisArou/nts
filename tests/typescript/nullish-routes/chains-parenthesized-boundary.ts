/*---
description: "Parentheses end an optional chain before its next member. Route: captured typed nullable binding changed by closure"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Parentheses end an optional chain before its next member. Route: captured typed nullable binding changed by closure. Node prints chains-parenthesized-boundary:ok.
interface Inner { x: number }
interface Outer { inner: Inner }
let outer: Outer | null = { inner: { x: 7 } };
function clear(): void { outer = null; }
clear();
assert.throws(TypeError, () => {
  const result = (outer?.inner).x; void result;
});
console.log("chains-parenthesized-boundary:ok");
