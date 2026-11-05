/*---
description: "Parentheses terminate an optional chain, so a null base throws when the next member is read. Route: declared nonnullable helper given a captured binding cleared by closure (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Parentheses terminate an optional chain, so a null base throws when the next member is read. Route: declared nonnullable helper given a captured binding cleared by closure. Node prints chains-parenthesized-boundary:ok.
interface Inner { x: number }
interface Outer { inner: Inner }
function read(base: Outer): number {
  const saved = base;
  if (saved === null || saved === undefined) throw new TypeError();
  return saved.inner.x;
}
let outer: Outer | null = { inner: { x: 7 } };
function clear(): void { outer = null; }
clear();
const selected = outer;
assert.throws(TypeError, () => { read(selected); });
console.log("chains-parenthesized-boundary:ok");
