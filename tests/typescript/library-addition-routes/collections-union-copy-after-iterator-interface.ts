/*---
description: "Set union copies the receiver after acquiring the keys iterator through an interface return."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-accessors, ts-objects, ts-function-types, ts-unions, ts-null-undefined, ts-spread, ts-instanceof, ts-closures]
---*/
// union reaches its set-like operand through an interface return; node includes keys/next-getter additions made before the copy and excludes the addition made by the first next call.
const log: string[] = [];
interface Route { read(): ReadonlySetLike<number>; }
for (const offset of [2, 10]) {
  const left = new Set([offset, offset + 1]);
  const source: ReadonlySetLike<number> = {
    get size(): number { log.push("get:size"); return 1; },
    get has(): (value: number) => boolean { log.push("get:has"); return function(value: number): boolean { log.push("has:" + value); return false; }; },
    get keys(): () => Iterator<number, undefined> { log.push("get:keys"); return function(): Iterator<number, undefined> {
      log.push("keys"); left.add(offset + 2); let index = 0;
      return { get next(): () => IteratorResult<number, undefined> {
        log.push("get:next"); left.add(offset + 3);
        return function(): IteratorResult<number, undefined> { log.push("next:" + index); left.add(offset + 5); return index++ === 0 ? { done: false, value: offset + 4 } : { done: true, value: undefined }; };
      } };
    }; }
  };
  const route: Route = { read(): ReadonlySetLike<number> { log.push("read"); return source; } };
  function apply(route: Route): Set<number> { log.push("apply"); const other = route.read();
    return left.union(other);
  }
  log.length = 0; const result = apply(route);
  assert.compareArray(log, ["apply", "read", "get:size", "get:has", "get:keys", "keys", "get:next", "next:0", "next:1"]);
  assert.compareArray([...result], [offset, offset + 1, offset + 2, offset + 3, offset + 4]);
  assert.compareArray([...left], [offset, offset + 1, offset + 2, offset + 3, offset + 5]);
  assert.sameValue(result.size, 5); assert.sameValue(left.size, 5); assert.sameValue(result === left, false); assert.sameValue(result instanceof Set, true);
}
