/*---
description: "Map grouping closes its iterable on failure from a private callback field. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-unions, ts-null-undefined, ts-function-types, ts-spread, ts-errors, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-symbols]
---*/
// Map.groupBy reads its callback through a private field; node interleaves callback arguments with iterator pulls and closes before propagating a callback TypeError. The control spells out the same steps.
const log: string[] = [];
class Source implements Iterable<number> {
  items: number[];
  constructor(items: number[]) { log.push("construct"); this.items = items; }
  [Symbol.iterator](): Iterator<number, undefined> { log.push("iterate"); const items = this.items; let index = 0; return {
    next(): IteratorResult<number, undefined> { log.push("next:" + index); return index < items.length ? { done: false, value: items[index++] } : { done: true, value: undefined }; },
    return(): IteratorResult<number, undefined> { log.push("return"); return { done: true, value: undefined }; }
  }; }
}
class Route {
  #select: (value: number, index: number) => string;
  constructor(select: (value: number, index: number) => string) { log.push("route"); this.#select = select; }
  apply(items: Iterable<number>): Map<string, number[]> { log.push("apply"); const callback = this.#select;
    const result = new Map<string, number[]>(); let index = 0;
  for (const value of items) { const key = callback(value, index++), bucket = result.get(key); if (bucket === undefined) result.set(key, [value]); else bucket.push(value); }
  return result;
  }
}
for (const failure of [-1, 0, 1]) {
  const items = [2, 3, 4], source = new Source(items), holder: { value: Map<string, number[]> | undefined } = { value: undefined };
  function select(value: number, index: number): string { log.push("callback:" + index + ":" + value); if (index === failure) throw new TypeError("callback"); return index % 2 === 0 ? "even" : "odd"; }
  const route = new Route(select);
  function invoke(): void { log.push("invoke"); holder.value = route.apply(source); }
  log.length = 0; if (failure < 0) invoke(); else assert.throws(TypeError, invoke);
  const histories: string[][] = [["next:0", "callback:0:2", "next:1", "callback:1:3", "next:2", "callback:2:4", "next:3"], ["next:0", "callback:0:2", "return"], ["next:0", "callback:0:2", "next:1", "callback:1:3", "return"]];
  assert.compareArray(log, ["invoke", "apply", "iterate", ...histories[failure + 1]]); assert.compareArray(items, [2, 3, 4]);
  if (failure < 0) { const result = holder.value; if (result === undefined) throw new Test262Error("missing result"); const even = result.get("even"), odd = result.get("odd"); if (even === undefined || odd === undefined) throw new Test262Error("missing group"); assert.compareArray([...result.keys()], ["even", "odd"]); assert.sameValue(result.size, 2); assert.compareArray(even, [2, 4]); assert.compareArray(odd, [3]); }
  else assert.sameValue(holder.value, undefined);
}
