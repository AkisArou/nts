/*---
description: "Set difference iterates its initial copy when has mutates the receiver through a generic route. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-accessors, ts-objects, ts-function-types, ts-unions, ts-null-undefined, ts-spread, ts-instanceof, ts-closures, ts-generics, ts-errors]
---*/
// difference receives a set-like value returned by a generic helper; node visits the copied entries even after has deletes them from the receiver and adds a new entry. The control spells out the same steps.
const log: string[] = [];
function keep<T>(value: T): T { log.push("keep"); return value; }
for (const offset of [2, 10]) {
  const left = new Set([offset, offset + 1, offset + 2]);
  const source: ReadonlySetLike<number> = {
    get size(): number { log.push("get:size"); return 3; },
    get has(): (value: number) => boolean { log.push("get:has"); return function(value: number): boolean {
      log.push("has:" + value); if (value === offset) { left.delete(offset + 1); left.add(offset + 3); }
      if (value === offset + 1) left.delete(offset + 2); return value !== offset + 1;
    }; },
    get keys(): () => Iterator<number> { log.push("get:keys"); return function(): Iterator<number> { log.push("keys"); return [offset, offset + 2].values(); }; }
  };
  function apply(other: ReadonlySetLike<number>): Set<number> { log.push("apply");
    const numberSize = +other.size; if (Number.isNaN(numberSize)) throw new TypeError("size");
  const size = Math.trunc(numberSize); if (size < 0) throw new RangeError("size");
  const has = other.has; if (typeof has !== "function") throw new TypeError("has");
  const keys = other.keys; if (typeof keys !== "function") throw new TypeError("keys");
    const result = new Set(left);
  if (left.size <= size) { for (const value of result) if (has.call(other, value)) result.delete(value); }
  else { const cursor = keys.call(other), next = cursor.next; while (true) { const step = next.call(cursor); if (step.done) break; result.delete(step.value); } }
  return result;
  }
  log.length = 0; const result = apply(keep(source));
  assert.compareArray(log, ["keep", "apply", "get:size", "get:has", "get:keys", "has:" + offset, "has:" + (offset + 1), "has:" + (offset + 2)]);
  assert.compareArray([...result], [offset + 1]); assert.sameValue(result.size, 1);
  assert.compareArray([...left], [offset, offset + 3]); assert.sameValue(left.size, 2);
  assert.sameValue(result === left, false); assert.sameValue(result instanceof Set, true);
}
