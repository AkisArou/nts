/*---
description: String-ID record control for A symbol accessor inherited by a subclass uses the typed parameter as its receiver.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-inheritance, ts-accessors]
---*/
// An AccessTarget parameter carries base and derived instances; node invokes the inherited symbol accessor on the receiver without creating an own symbol property.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const key = "token:value", missing = "token:missing";
interface AccessTarget { data: { value: number; label?: string }; members: string[]; own: string[]; }
function makeTarget(value: number, kind: string): AccessTarget { return { data: kind === "base" ? { value } : { value, label: "child" }, members: [key], own: [] }; }
function read(target: AccessTarget): number { if (!target.members.includes(key)) throw new Error("read"); return target.data.value; }
function state(target: AccessTarget): number { return target.data.value; }
function write(target: AccessTarget, value: number): void { if (!target.members.includes(key)) throw new Error("write"); target.data.value = value; }
function has(target: AccessTarget, token: string): boolean { return target.members.includes(token); }
function tokens(target: AccessTarget): string[] { return target.own.slice(); }
function names(target: AccessTarget): string[] { return Object.keys(target.data); }
for (const input of [-0, NaN, 17]) for (const kind of ["base", "derived"]) {
  const target = makeTarget(input, kind), other = makeTarget(61, kind);
  same(read(target), input); same(has(target, key), true); same(has(target, missing), false); same(Object.is(key, missing), false);
  assert.compareArray(tokens(target), []); assert.compareArray(names(target), kind === "base" ? ["value"] : ["value", "label"]);
  write(target, 43); same(read(target), 43); same(state(target), 43); same(read(other), 61);
  write(target, -0); same(read(target), -0); same(state(target), -0); same(read(other), 61);
  assert.compareArray(tokens(target), []); same(has(target, key), true); same(has(target, missing), false);
}
