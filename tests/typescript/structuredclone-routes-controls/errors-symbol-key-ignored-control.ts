/*---
description: Memoized recursive control for A symbol-keyed value on an interface is omitted without rejecting its supported string-keyed graph.
features: [ts-structuredclone-route-errors, ts-errors, ts-objects, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-interfaces, ts-index-signatures, ts-map-set, ts-arrays, ts-tuples, ts-numbers, ts-null-undefined, ts-unknown, ts-narrowing, ts-symbols]
---*/
// An interface carries a symbol key with an uncloneable symbol value; node drops that key and copies only the cyclic string-keyed graph.
type CloneValue = number | undefined | symbol | CloneCell;
interface CloneCell { [key: string]: CloneValue; }
const hidden = Symbol("hidden");
interface SymbolCarrier extends CloneCell { [hidden]: symbol; }
function copyValue(value: CloneValue, memo = new Map<CloneCell, CloneCell>()): CloneValue {
  if (typeof value === "symbol") throw new DOMException("uncloneable value", "DataCloneError");
  if (typeof value !== "object") return value;
  const prior = memo.get(value); if (prior !== undefined) return prior;
  const copy: CloneCell = {}; memo.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = copyValue(value[key], memo); return copy;
}
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
for (const value of [undefined, -0, NaN, 8]) {
  const child: CloneCell = { value }, source: SymbolCarrier = { [hidden]: Symbol("unsupported"), other: child, value: child };
  child.other = source;
  const saved = source[hidden], copy = copyValue(source);
  if (typeof copy !== "object" || typeof copy.value !== "object" || typeof copy.other !== "object") throw new Error("shape");
  const inner = copy.value;
  assert.compareArray(Object.keys(copy), ["other", "value"]); assert.compareArray(Object.getOwnPropertySymbols(copy), []);
  assert.compareArray(Object.keys(inner), ["value", "other"]); assert.compareArray(Object.getOwnPropertySymbols(inner), []);
  same(Object.getPrototypeOf(copy), Object.prototype); same(Object.getPrototypeOf(inner), Object.prototype);
  same(Object.is(copy, source), false); same(Object.is(inner, child), false); same(copy.other, inner); same(inner.other, copy); same(inner.value, value);
  same(source[hidden], saved); same(source.other, child); same(source.value, child); same(child.value, value); same(child.other, source);
  assert.compareArray(Object.keys(source), ["other", "value"]); assert.compareArray(Object.getOwnPropertySymbols(source), [hidden]);
  inner.value = 17; same(child.value, value); child.value = 23; same(inner.value, 17);
  copy.extra = -0; same(Object.hasOwn(source, "extra"), false); source.extra = NaN; same(copy.extra, -0);
}
