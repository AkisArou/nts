/*---
description: "A computed method name cannot replace a heritage constructor already selected."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-computed-keys, ts-inheritance, ts-typeof-type, ts-instanceof]
---*/
// A constructor crosses a class field into extends; node retains that constructor when evaluating a method name replaces the field.
const log: string[] = [];
class First { label: string = "first"; }
class Second { label: string = "second"; }
class Holder { base: typeof First = First; }
function choose(holder: Holder): typeof First { log.push("extends"); return holder.base; }
function key(holder: Holder, replacement: typeof First): string { log.push("key"); holder.base = replacement; return "method"; }
for (const reverse of [false, true]) {
  log.length = 0; const holder = new Holder(); holder.base = reverse ? Second : First; const original = holder.base, replacement = reverse ? First : Second;
  class Child extends choose(holder) { [key(holder, replacement)](): number { log.push("method"); return 1; } }
  const result = new Child();
  assert.compareArray(log, ["extends", "key"]);
  assert.sameValue(result.label, reverse ? "second" : "first"); assert.sameValue(result instanceof original, true); assert.sameValue(result instanceof replacement, false);
  assert.sameValue(holder.base, replacement); assert.sameValue("method" in result, true); assert.compareArray(Object.keys(result), ["label"]);
}
