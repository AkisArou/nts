/*---
description: "includes uses SameValueZero for NaN and zero while keeping object identity and distinct strings."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-type-aliases, ts-unions, ts-strings, ts-null-undefined, ts-objects, ts-readonly, ts-tuples, ts-destructuring]
---*/

// includes uses SameValueZero for NaN and zero while keeping object identity and distinct strings. Route: a private dense union-array field. Node prints reads-includes-private-equality:ok.
type SearchValue = number | string | null | undefined | { id: number };
const marker = { id: 7 }, clone = { id: 7 };
class IncludesReader {
  #items: SearchValue[] = [NaN, -0, "text", marker, null, undefined];
  contains(value: SearchValue): boolean { return this.#items.includes(value); }
}
const reader = new IncludesReader();
const queries: readonly [SearchValue, boolean][] = [[NaN, true], [0, true], [-0, true], ["text", true], ["missing", false], [clone, false], [marker, true], [null, true], [undefined, true]];
for (const [needle, expected] of queries) assert.sameValue(reader.contains(needle), expected);
console.log("reads-includes-private-equality:ok");
