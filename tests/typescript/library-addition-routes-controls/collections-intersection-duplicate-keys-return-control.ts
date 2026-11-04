/*---
description: "Set intersection deduplicates a cached keys iterator through a declared provider return. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-accessors, ts-objects, ts-function-types, ts-unions, ts-null-undefined, ts-spread, ts-instanceof, ts-closures, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-errors]
---*/
// intersection crosses an interface return and a class set-like value; node captures next once and retains first key order while deduplicating numbers, signed zero and NaN. The control spells out the same steps.
const log: string[] = [];
interface Provider { make(): ReadonlySetLike<number>; }
class Other {
  values: number[];
  constructor(values: number[]) { log.push("construct"); this.values = values; }
  get size(): number { log.push("get:size"); return 1; }
  get has(): (value: number) => boolean { log.push("get:has"); return function(value: number): boolean { log.push("has:" + value); return false; }; }
  get keys(): () => Iterator<number, undefined> { log.push("get:keys"); return function(this: Other): Iterator<number, undefined> {
    log.push("keys"); const values = this.values; let index = 0;
    return { get next(): () => IteratorResult<number, undefined> { log.push("get:next"); return function(): IteratorResult<number, undefined> {
      log.push("next:" + index); return index < values.length ? { done: false, value: values[index++] } : { done: true, value: undefined };
    }; } };
  }; }
}
for (const offset of [2, 10]) {
  const left = new Set([NaN, 0, offset, offset + 1]);
  const provider: Provider = { make(): ReadonlySetLike<number> { log.push("make"); return new Other([offset, offset, -0, 0, NaN, NaN]); } };
  function apply(provider: Provider): Set<number> { log.push("apply"); const other = provider.make();
    const numberSize = +other.size; if (Number.isNaN(numberSize)) throw new TypeError("size");
  const size = Math.trunc(numberSize); if (size < 0) throw new RangeError("size");
  const has = other.has; if (typeof has !== "function") throw new TypeError("has");
  const keys = other.keys; if (typeof keys !== "function") throw new TypeError("keys");
    const result = new Set<number>();
  if (left.size <= size) { for (const value of left) if (has.call(other, value)) result.add(value); }
  else { const cursor = keys.call(other), next = cursor.next; while (true) { const step = next.call(cursor); if (step.done) break; if (left.has(step.value)) result.add(step.value); } }
  return result;
  }
  log.length = 0; const result = apply(provider);
  assert.compareArray(log, ["apply", "make", "construct", "get:size", "get:has", "get:keys", "keys", "get:next", "next:0", "next:1", "next:2", "next:3", "next:4", "next:5", "next:6"]);
  assert.compareArray([...result], [offset, 0, NaN]); assert.sameValue([...result][1], 0); assert.sameValue(result.size, 3);
  assert.compareArray([...left], [NaN, 0, offset, offset + 1]); assert.sameValue(left.size, 4);
  assert.sameValue(result === left, false); assert.sameValue(result instanceof Set, true);
}
