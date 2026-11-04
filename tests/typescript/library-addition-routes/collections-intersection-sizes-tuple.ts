/*---
description: "intersection selects and reads the set-like protocol through a tuple route."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-accessors, ts-readonly, ts-objects, ts-function-types, ts-this-parameter, ts-this, ts-unions, ts-null-undefined, ts-spread, ts-instanceof, ts-tuples, ts-type-aliases]
---*/
// intersection crosses a tuple route with Set, Map and a logging class; node preserves member-read order, size branches, exact result order and the receiver.
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
type Route = readonly [Set<number>, ReadonlySetLike<number>];
function apply(route: Route): Set<number> {
  log.push("apply"); const left = route[0], other = route[1];
  return left.intersection(other);
}
const choices: number[][] = [[2,0],[2,0,3],[2,0,3,4],[2,0,1],[6,7],[],[2,0,1,3],[],[3]];
const answers: number[][] = [[2,0],[0,2],[0,2],[0,1,2],[],[],[0,1,2],[],[]];
for (const offset of [2, 10]) for (let mode = 0; mode < choices.length; mode++) {
  const original = mode >= 7 ? [] : [offset, offset + 1, offset + 2], values: number[] = [];
  for (const value of choices[mode]) values.push(offset + value);
  const map = new Map<number, string>(); for (const value of values) map.set(value, "v" + value);
  const candidates: ReadonlySetLike<number>[] = [new Set(values), new Other(values), map];
  const histories: string[][] = [["keys", "next:0", "next:1", "next:2"], ["has:" + (offset + 0), "has:" + (offset + 1), "has:" + (offset + 2)], ["has:" + (offset + 0), "has:" + (offset + 1), "has:" + (offset + 2)],
    ["has:" + (offset + 0), "has:" + (offset + 1), "has:" + (offset + 2)], ["keys", "next:0", "next:1", "next:2"], ["keys", "next:0"],
    ["has:" + (offset + 0), "has:" + (offset + 1), "has:" + (offset + 2)], [], []];
  for (const other of candidates) {
    const left = new Set(original); const route: Route = [left, other];
    log.length = 0; const result = apply(route);
    const expectedLog = other instanceof Other ? ["apply", "get:size", "get:has", "get:keys", ...histories[mode]] : ["apply"];
    assert.compareArray(log, expectedLog);
    const stored: ReadonlySet<number>[] = [result], view = stored[0], expected: number[] = [];
    for (const value of answers[mode]) expected.push(offset + value);
    assert.compareArray([...view], expected); assert.sameValue(view.size, expected.length); assert.sameValue(view === left, false); assert.sameValue(view === other, false); assert.sameValue(view instanceof Set, true);
    assert.compareArray([...left], original); assert.sameValue(left.size, original.length);
  }
}
