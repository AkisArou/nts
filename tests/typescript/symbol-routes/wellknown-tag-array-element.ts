/*---
description: Tagged arrays reached through a typed array element retain Array branding for absent or non-string tags.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-interfaces, ts-optional-properties, ts-unions, ts-numbers, ts-strings, ts-symbols]
---*/
// Symbol.toStringTag: An array of TaggedArray values carries empty and populated arrays; node uses string tags and otherwise keeps the Array builtin tag.
const hookKey = Symbol.toStringTag;
interface TaggedArray extends Array<number> { [Symbol.toStringTag]?: string | number; }
function make(values: number[], tag: string | number | undefined): TaggedArray {
  const target: TaggedArray = values.slice(); if (tag !== undefined) target[Symbol.toStringTag] = tag; return target;
}
function describe(sources: TaggedArray[]): string { return Object.prototype.toString.call(sources[0]); }
function hookKeys(target: TaggedArray): symbol[] { return Object.getOwnPropertySymbols(target); }
function items(target: TaggedArray): number[] { return target; }
for (const input of ["", "Batch", 9, undefined]) for (const values of [[], [-0, NaN], [1, 2, 3]]) {
  const sources: TaggedArray[] = [make(values, input)];
  assert.sameValue(describe(sources), `[object ${typeof input === "string" ? input : "Array"}]`);
  assert.compareArray(hookKeys(sources[0]), input === undefined ? [] : [hookKey]);
  assert.compareArray(items(sources[0]), values);
}
