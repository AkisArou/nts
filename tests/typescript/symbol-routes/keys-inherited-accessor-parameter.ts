/*---
description: A symbol accessor inherited by a subclass uses the typed parameter as its receiver.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-inheritance, ts-accessors, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// An AccessTarget parameter carries base and derived instances; node invokes the inherited symbol accessor on the receiver without creating an own symbol property.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const key: unique symbol = Symbol("value"), missing: unique symbol = Symbol("value");
interface AccessTarget { value: number; [key]: number; }
class Base implements AccessTarget { value: number; constructor(value: number) { this.value = value; } get [key](): number { return this.value; } set [key](value: number) { this.value = value; } }
class Derived extends Base { label: string = "child"; }
function makeTarget(value: number, kind: string): AccessTarget { return kind === "base" ? new Base(value) : new Derived(value); }
function read(target: AccessTarget): number { return target[key]; }
function state(target: AccessTarget): number { return target.value; }
function write(target: AccessTarget, value: number): void { target[key] = value; }
function has(target: AccessTarget, token: symbol): boolean { return token in target; }
function tokens(target: AccessTarget): symbol[] { return Object.getOwnPropertySymbols(target); }
function names(target: AccessTarget): string[] { return Object.keys(target); }
for (const input of [-0, NaN, 17]) for (const kind of ["base", "derived"]) {
  const target = makeTarget(input, kind), other = makeTarget(61, kind);
  same(read(target), input); same(has(target, key), true); same(has(target, missing), false); same(Object.is(key, missing), false);
  assert.compareArray(tokens(target), []); assert.compareArray(names(target), kind === "base" ? ["value"] : ["value", "label"]);
  write(target, 43); same(read(target), 43); same(state(target), 43); same(read(other), 61);
  write(target, -0); same(read(target), -0); same(state(target), -0); same(read(other), 61);
  assert.compareArray(tokens(target), []); same(has(target, key), true); same(has(target, missing), false);
}
