/*---
description: "isDisjointFrom selects and reads the set-like protocol through a private route. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-accessors, ts-readonly, ts-objects, ts-function-types, ts-this-parameter, ts-this, ts-unions, ts-null-undefined, ts-spread, ts-instanceof, ts-private-fields, ts-errors]
---*/
// isDisjointFrom crosses a private route with Set, Map and a logging class; node preserves member-read order, size branches, exact result order and the receiver. The control spells out the same steps.
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
class Route {
  #other: ReadonlySetLike<number>;
  constructor(other: ReadonlySetLike<number>) { log.push("route"); this.#other = other; }
  apply(left: Set<number>): boolean {
  log.push("apply"); const other = this.#other;
  const numberSize = +other.size; if (Number.isNaN(numberSize)) throw new TypeError("size");
  const size = Math.trunc(numberSize); if (size < 0) throw new RangeError("size");
  const has = other.has; if (typeof has !== "function") throw new TypeError("has");
  const keys = other.keys; if (typeof keys !== "function") throw new TypeError("keys");
  if (left.size <= size) { for (const value of left) if (has.call(other, value)) return false; return true; }
  const cursor = keys.call(other), next = cursor.next;
  while (true) { const step = next.call(cursor); if (step.done) return true; if (left.has(step.value)) { const close = cursor.return; if (close !== undefined) close.call(cursor); return false; } }
  }
}
const choices: number[][] = [[2,0],[2,0,3],[2,0,3,4],[2,0,1],[6,7],[],[2,0,1,3],[],[3]];
const answers: boolean[] = [false,false,false,false,true,true,false,true,true];
for (const offset of [2, 10]) for (let mode = 0; mode < choices.length; mode++) {
  const original = mode >= 7 ? [] : [offset, offset + 1, offset + 2], values: number[] = [];
  for (const value of choices[mode]) values.push(offset + value);
  const map = new Map<number, string>(); for (const value of values) map.set(value, "v" + value);
  const candidates: ReadonlySetLike<number>[] = [new Set(values), new Other(values), map];
  const histories: string[][] = [["keys", "next:0", "return"], ["has:" + (offset + 0)], ["has:" + (offset + 0)],
    ["has:" + (offset + 0)], ["keys", "next:0", "next:1", "next:2"], ["keys", "next:0"],
    ["has:" + (offset + 0)], [], []];
  for (const other of candidates) {
    const left = new Set(original); const route = new Route(other);
    log.length = 0; const result = route.apply(left);
    const expectedLog = other instanceof Other ? ["apply", "get:size", "get:has", "get:keys", ...histories[mode]] : ["apply"];
    assert.compareArray(log, expectedLog);
    const stored: readonly boolean[] = [result], view = stored[0];
    assert.sameValue(view, answers[mode]); assert.sameValue(typeof view, "boolean");
    assert.compareArray([...left], original); assert.sameValue(left.size, original.length);
  }
}
