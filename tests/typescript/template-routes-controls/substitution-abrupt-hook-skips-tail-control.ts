/*---
description: "Explicit conversion control: An abrupt primitive hook in a typed template suppresses the later substitution."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-interfaces, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-to-string, ts-to-primitive, ts-this, ts-closures, ts-symbols, ts-computed-keys, ts-literal-types, ts-errors, ts-arrow-functions, ts-function-types, ts-iteration]
---*/
// A typed hook returns text, returns an object or throws a stored RangeError; node converts with string hint and reads the tail only after successful primitive conversion. The control uses ordered String calls and concatenation.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type Mode = "ok" | "object" | "throw";
interface Hook { [Symbol.toPrimitive](hint: string): string | object; toString(): string; valueOf(): number; }
const modes: Mode[] = ["ok", "object", "throw"], log: unknown[] = [];
function render(value: Hook, tail: () => string): string { return "[" + String(value) + String(tail()) + "]"; }
for (const input of ["", "x", "\ud83d\ude00"]) for (const mode of modes) {
  log.length = 0; const fault = new RangeError("hook"), objectResult = { input };
  const value: Hook = {
    [Symbol.toPrimitive](hint: string): string | object {
      log.push(this, hint, input, mode);
      if (mode === "throw") throw fault;
      return mode === "object" ? objectResult : input;
    },
    toString(): string { log.push("toString"); return "wrong"; },
    valueOf(): number { log.push("valueOf"); return 7; },
  };
  const tail: () => string = () => { log.push("tail"); return "!"; };
  const invoke = (): string => { try { return render(value, tail); } catch (error: unknown) { if (mode === "throw") same(error, fault); throw error; } };
  if (mode === "object") assert.throws(TypeError, invoke);
  else if (mode === "throw") assert.throws(RangeError, invoke);
  else assert.sameValue(invoke(), "[" + input + "!]");
  const wanted: unknown[] = [value, "string", input, mode]; if (mode === "ok") wanted.push("tail");
  assert.compareArray(log, wanted);
}
