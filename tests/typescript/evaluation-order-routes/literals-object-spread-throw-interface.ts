/*---
description: "A throwing spread getter stops before the literal trailing property."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-objects, ts-record, ts-accessors, ts-spread, ts-errors, ts-closures]
---*/
// Getter effects cross an interface source field; node retains earlier reads and stops at the failing getter before the trailing value or result assignment.
const log: string[] = [];
interface Source { first: number; last: number; }
interface Holder { source: Source; }
let current = 0;
function mark(label: string): number { log.push(label); current += 1; return current; }
for (const failure of [false, true]) {
  log.length = 0; current = 0; let output: Record<string, number> = {};
  const holder: Holder = { source: { get first(): number { log.push("get:first"); current += 10; return current; }, get last(): number { log.push("get:last"); current += 100; if (failure) throw new RangeError("spread"); return current; } } };
  function run(): void {
    log.push("run");
    output = { before: mark("before"), ...holder.source, after: mark("after") };
  }
  if (failure) assert.throws(RangeError, run); else run();
  assert.compareArray(log, failure ? ["run", "before", "get:first", "get:last"] : ["run", "before", "get:first", "get:last", "after"]);
  assert.sameValue(current, failure ? 111 : 112); assert.sameValue(output.before, failure ? undefined : 1); assert.sameValue(output.first, failure ? undefined : 11); assert.sameValue(output.last, failure ? undefined : 111); assert.sameValue(output.after, failure ? undefined : 112); assert.compareArray(Object.keys(output), failure ? [] : ["before", "first", "last", "after"]);
}
