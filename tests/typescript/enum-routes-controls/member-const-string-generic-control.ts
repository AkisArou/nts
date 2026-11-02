/*---
description: "Control for member-const-string-generic; String const-enum member types survive a generic interface, factory return and method call without conversion."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-interfaces, ts-generics, ts-generic-constraints, ts-tuples, ts-literal-types, ts-this, ts-type-aliases, ts-unions]
---*/
// A tuple naming every InlineText member feeds a generic box and method helper; node logs the exact stored string and returns it through the same constrained type. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const InlineText = Object.freeze({ Empty: "", Ready: "ready", Astral: "😀", Alias: "ready" }); type InlineText = "" | "ready" | "😀";
interface InlineTextBox<T extends InlineText> { value: T; read(): T; }
function box<T extends InlineText>(value: T, log: unknown[]): InlineTextBox<T> { return { value, read() { log.push("method", this.value, typeof this.value); return this.value; } }; }
function call<T extends InlineText>(holder: InlineTextBox<T>): T { return holder.read(); }
const inputs: ["", "ready", "😀", "ready"] = [InlineText.Empty, InlineText.Ready, InlineText.Astral, InlineText.Alias], expected = ["", "ready", "😀", "ready"];
for (let at = 0; at < inputs.length; at++) {
  const log: unknown[] = [], holder = box(inputs[at], log), result = call(holder);
  same(holder.value, expected[at]); same(result, expected[at]); log.push("return", result); exact(log, ["method", expected[at], "string", "return", expected[at]]);
}
