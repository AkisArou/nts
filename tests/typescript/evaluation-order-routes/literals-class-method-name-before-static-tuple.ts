/*---
description: "A computed method name is captured before an earlier static field initializer runs."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-static, ts-computed-keys, ts-tuples, ts-type-aliases]
---*/
// A tuple carries the mutable key and value state; node resolves a later method key before a static computed field changes that state.
const log: string[] = [];
type Route = [string, number];
const fieldName: "value" = "value";
function key(route: Route): string { log.push("key"); return route[0]; }
function change(route: Route): number { log.push("field"); route[0] = "later"; route[1] += 10; return route[1]; }
for (const text of ["first", "second"]) for (const input of [2, 8]) {
  log.length = 0; const route: Route = [text, input];
  class Built {
    static [fieldName]: number = change(route);
    static [key(route)](): number { log.push("method"); return 1; }
  }
  assert.compareArray(log, ["key", "field"]);
  assert.sameValue(text in Built, true); assert.sameValue("later" in Built, false); assert.sameValue(Built.value, input + 10);
  assert.compareArray(route, ["later", input + 10]); assert.compareArray(Object.keys(Built), ["value"]);
}
