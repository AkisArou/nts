/*---
description: "Explicit construction control: Three constrained generic hook returns preserve coercion order across nested templates."
features: [ts-template-routes, ts-template-route-nesting-composition, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-generics, ts-generic-constraints, ts-symbols, ts-to-primitive, ts-conversions, ts-strings, ts-numbers, ts-closures]
---*/
// Generic hook returns log object identities and string hints; Node converts first, inner and last once each and appends state values 1, 2 and 3. Control: use explicit strings and ordinary calls with frozen, reused arrays for each site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
interface NestHook { text: string; [Symbol.toPrimitive](hint: string): string }
interface NestHooks { first: NestHook; inner: NestHook; last: NestHook }
const inputs: string[] = ["", "abc", "\u00e9", "\ud83d\ude42", "\ud800", "\n"];
const log: unknown[] = []; let state = 0;
function hook(label: string, text: string): NestHook { return { text, [Symbol.toPrimitive](hint: string): string { state++; log.push("coerce", label, hint, state); return this.text + String(state); } }; }
function read<T extends NestHook>(label: string, value: T): T { log.push("read", label, value); return value; }
function render<T extends NestHooks>(source: T): string {
  return "A" + String(read("first", source.first)) + "B" + ("I" + String(read("inner", source.inner)) + "J") + "C" + String(read("last", source.last)) + "D";
}
for (const text of inputs) {
  log.length = 0; state = 0; const source = { first: hook("first", text), inner: hook("inner", text), last: hook("last", text) };
  const result = render(source), expected = "A" + text + "1BI" + text + "2JC" + text + "3D";
  same(result, expected); same(result.length, expected.length); same(state, 3);
  same(source.first.text, text); same(source.inner.text, text); same(source.last.text, text);
  exact(log, ["read", "first", source.first, "coerce", "first", "string", 1, "read", "inner", source.inner, "coerce", "inner", "string", 2, "read", "last", source.last, "coerce", "last", "string", 3]);
}
