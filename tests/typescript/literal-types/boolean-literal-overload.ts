/*---
description: Overloads on `true` and `false` literal parameters return different types from one implementation.
features: [ts-literal-types, ts-overloads]
---*/
function split(text: string, asNumbers: true): number[];
function split(text: string, asNumbers: false): string[];
function split(text: string, asNumbers: boolean): number[] | string[] {
  const parts = text.split(",");
  return asNumbers ? parts.map(Number) : parts;
}
const numbers = split("1,2,3", true);
const strings = split("1,2,3", false);
assert.sameValue(numbers[0] + numbers[1], 3);
assert.sameValue(strings[0] + strings[1], "12");
