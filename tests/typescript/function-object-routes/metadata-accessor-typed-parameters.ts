/*---
description: Getter and setter function parameters retain prefixed names and distinct arities.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-accessors, ts-computed-keys, ts-record, ts-errors]
---*/
// Typed getter and setter parameters carry computed own accessors; node reports get plus the key with arity zero and set plus the key with arity one.
function make(key: string): Record<string, number> { return { get [key](): number { return 1; }, set [key](value: number) {} }; }
function observe(read: () => number, write: (value: number) => void): [string, number, string, number] { return [read.name, read.length, write.name, write.length]; }
function inspect(source: Record<string, number>, key: string): [string, number, string, number] {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined || descriptor.get === undefined || descriptor.set === undefined) throw new Error("missing accessor");
  const read: () => number = descriptor.get, write: (value: number) => void = descriptor.set;
  return observe(read, write);
}
for (const key of ["", "x", "7", "read value", "\u00e9"]) {
  const actual = inspect(make(key), key);
  assert.sameValue(actual[0], "get " + key); assert.sameValue(actual[1], 0);
  assert.sameValue(actual[2], "set " + key); assert.sameValue(actual[3], 1);
  assert.compareArray(actual, ["get " + key, 0, "set " + key, 1]);
}
