/*---
description: "Set difference iterates its initial copy when has mutates the receiver through a generic route."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-accessors, ts-objects, ts-function-types, ts-unions, ts-null-undefined, ts-spread, ts-instanceof, ts-closures, ts-generics]
---*/
// difference receives a set-like value returned by a generic helper; node visits the copied entries even after has deletes them from the receiver and adds a new entry.
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
    return left.difference(other);
  }
  log.length = 0; const result = apply(keep(source));
  assert.compareArray(log, ["keep", "apply", "get:size", "get:has", "get:keys", "has:" + offset, "has:" + (offset + 1), "has:" + (offset + 2)]);
  assert.compareArray([...result], [offset + 1]); assert.sameValue(result.size, 1);
  assert.compareArray([...left], [offset, offset + 3]); assert.sameValue(left.size, 2);
  assert.sameValue(result === left, false); assert.sameValue(result instanceof Set, true);
}
