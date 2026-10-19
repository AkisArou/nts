/*---
description: A function whose return type is conditional on its argument's type returns the value the condition names.
features: [ts-type-operators, ts-conditional-types, ts-generics, ts-overloads]
---*/
type Parsed<T> = T extends string ? number : T extends number ? string : never;
function flip<T extends string | number>(value: T): Parsed<T>;
function flip(value: string | number): number | string {
  return typeof value === "string" ? value.length : String(value);
}
const fromText: number = flip("abcd");
const fromNumber: string = flip(42);
assert.sameValue(fromText + 1, 5);
assert.sameValue(fromNumber + "!", "42!");
