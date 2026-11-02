/*---
description: Explicit metadata record control for Getter and setter function parameters retain prefixed names and distinct arities.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces]
---*/
// Explicit records: Typed getter and setter parameters carry computed own accessors; node reports get plus the key with arity zero and set plus the key with arity one.
interface Metadata { label: string; arity: number; }
interface AccessorRecord { read: Metadata; write: Metadata; }
function make(key: string): AccessorRecord { return { read: { label: "get " + key, arity: 0 }, write: { label: "set " + key, arity: 1 } }; }
function observe(read: Metadata, write: Metadata): [string, number, string, number] { return [read.label, read.arity, write.label, write.arity]; }
function inspect(source: AccessorRecord, key: string): [string, number, string, number] { return observe(source.read, source.write); }
for (const key of ["", "x", "7", "read value", "\u00e9"]) {
  const actual = inspect(make(key), key);
  assert.sameValue(actual[0], "get " + key); assert.sameValue(actual[1], 0);
  assert.sameValue(actual[2], "set " + key); assert.sameValue(actual[3], 1);
  assert.compareArray(actual, ["get " + key, 0, "set " + key, 1]);
}
