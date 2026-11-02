/*---
description: Plain string-hook record control for Tagged arrays reached through a typed array element retain Array branding for absent or non-string tags.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-interfaces, ts-optional-properties, ts-unions, ts-numbers, ts-strings, ts-record]
---*/
// String hook record: An array of TaggedArray values carries empty and populated arrays; node uses string tags and otherwise keeps the Array builtin tag.
const hookKey = "hook:tag";
interface TaggedArray { values: number[]; keys: string[]; fields: Record<string, string | number>; }
function make(values: number[], tag: string | number | undefined): TaggedArray {
  const target: TaggedArray = { values: values.slice(), keys: [], fields: {} };
  if (tag !== undefined) { target.keys.push(hookKey); target.fields[hookKey] = tag; } return target;
}
function describe(sources: TaggedArray[]): string {
  const target = sources[0], tag = target.keys.includes(hookKey) ? target.fields[hookKey] : undefined;
  return `[object ${typeof tag === "string" ? tag : "Array"}]`;
}
function hookKeys(target: TaggedArray): string[] { return target.keys.slice(); }
function items(target: TaggedArray): number[] { return target.values; }
for (const input of ["", "Batch", 9, undefined]) for (const values of [[], [-0, NaN], [1, 2, 3]]) {
  const sources: TaggedArray[] = [make(values, input)];
  assert.sameValue(describe(sources), `[object ${typeof input === "string" ? input : "Array"}]`);
  assert.compareArray(hookKeys(sources[0]), input === undefined ? [] : [hookKey]);
  assert.compareArray(items(sources[0]), values);
}
