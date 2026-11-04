/*---
description: "A throwing computed object key stops before its value and later properties. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-tuples, ts-readonly, ts-objects, ts-record, ts-computed-keys, ts-errors, ts-closures]
---*/
// A readonly boolean tuple controls the computed key; node retains the earlier property effect and stops exactly at the throwing key. The control names each ordered part.
const log: string[] = [];
let current = 0;
function mark(label: string): number { log.push(label); current += 1; return current; }
function choose(route: readonly [boolean]): string { log.push("key"); current += 10; if (route[0]) throw new RangeError("key"); return "slot"; }
for (const failure of [false, true]) {
  log.length = 0; current = 0; const route: readonly [boolean] = [failure]; let output: Record<string, number> = {};
  function run(): void {
    log.push("run");
    const before = mark("before");
    const propertyKey = choose(route);
    const propertyValue = mark("value");
    const after = mark("after");
    output = { before, [propertyKey]: propertyValue, after };
  }
  if (failure) assert.throws(RangeError, run); else run();
  assert.compareArray(log, failure ? ["run", "before", "key"] : ["run", "before", "key", "value", "after"]);
  assert.sameValue(current, failure ? 11 : 13); assert.sameValue(output.before, failure ? undefined : 1); assert.sameValue(output.slot, failure ? undefined : 12); assert.sameValue(output.after, failure ? undefined : 13); assert.compareArray(Object.keys(output), failure ? [] : ["before", "slot", "after"]);
}
