/*---
description: "Set symmetric difference compares repeated keys against the original receiver through a Record route. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-accessors, ts-objects, ts-function-types, ts-unions, ts-null-undefined, ts-spread, ts-instanceof, ts-closures, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-readonly, ts-type-aliases, ts-mapped-types, ts-utility-types, ts-errors]
---*/
// symmetricDifference crosses a Record field; node removes repeated original members once and keeps repeated new members once without toggling them back. The control spells out the same steps.
const log: string[] = [];
class Other {
  readonly values: readonly number[];
  constructor(values: readonly number[]) { log.push("construct"); this.values = values; }
  get size(): number { log.push("get:size"); return this.values.length; }
  get has(): (value: number) => boolean { log.push("get:has"); return function(this: Other, value: number): boolean { log.push("has:" + value); return this.values.includes(value); }; }
  get keys(): () => Iterator<number, undefined> { log.push("get:keys"); return function(this: Other): Iterator<number, undefined> { log.push("keys"); let index = 0; const values = this.values; return {
    next(): IteratorResult<number, undefined> { log.push("next:" + index); return index < values.length ? { done: false, value: values[index++] } : { done: true, value: undefined }; },
    return(): IteratorResult<number, undefined> { log.push("return"); return { done: true, value: undefined }; }
  }; }; }
}
type Routes = Record<"active", { receiver: Set<number>; other: ReadonlySetLike<number> }>;
function apply(routes: Routes): Set<number> { log.push("apply"); const left = routes.active.receiver, other = routes.active.other;
  const numberSize = +other.size; if (Number.isNaN(numberSize)) throw new TypeError("size");
  const size = Math.trunc(numberSize); if (size < 0) throw new RangeError("size");
  const has = other.has; if (typeof has !== "function") throw new TypeError("has");
  const keys = other.keys; if (typeof keys !== "function") throw new TypeError("keys");
  const cursor = keys.call(other), next = cursor.next;
  const result = new Set(left);
  while (true) { const step = next.call(cursor); if (step.done) break; if (left.has(step.value)) result.delete(step.value); else result.add(step.value); }
  return result;
}
for (const offset of [2, 10]) {
  const left = new Set([NaN, -0, offset]), other = new Other([-0, 0, offset + 1, offset + 1, NaN, NaN]);
  const routes: Routes = { active: { receiver: left, other } };
  log.length = 0; const result = apply(routes);
  assert.compareArray(log, ["apply", "get:size", "get:has", "get:keys", "keys", "next:0", "next:1", "next:2", "next:3", "next:4", "next:5", "next:6"]);
  assert.compareArray([...result], [offset, offset + 1]); assert.sameValue(result.size, 2);
  assert.compareArray([...left], [NaN, 0, offset]); assert.sameValue(left.size, 3);
  assert.sameValue(result === left, false); assert.sameValue(result instanceof Set, true);
}
