/*---
description: "Object grouping closes its input on callback failure through a tuple route. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-unions, ts-null-undefined, ts-function-types, ts-spread, ts-errors, ts-class, ts-class-fields, ts-this, ts-symbols, ts-tuples, ts-type-aliases, ts-readonly]
---*/
// Object.groupBy receives its iterable and callback from a tuple; node alternates next and callback, closes immediately after a callback throw, and does not publish a partial result. The control spells out the same steps.
const log: string[] = [];
class Source implements Iterable<number> {
  items: number[];
  constructor(items: number[]) { log.push("construct"); this.items = items; }
  [Symbol.iterator](): Iterator<number, undefined> { log.push("iterate"); const items = this.items; let index = 0; return {
    next(): IteratorResult<number, undefined> { log.push("next:" + index); return index < items.length ? { done: false, value: items[index++] } : { done: true, value: undefined }; },
    return(): IteratorResult<number, undefined> { log.push("return"); return { done: true, value: undefined }; }
  }; }
}
type Route = readonly [Iterable<number>, (value: number, index: number) => string];
function apply(route: Route): Partial<Record<PropertyKey, number[]>> { log.push("apply"); const items = route[0], callback = route[1];
  const result: Partial<Record<PropertyKey, number[]>> = Object.create(null); let index = 0;
  for (const value of items) { const raw = callback(value, index++), key = typeof raw === "symbol" ? raw : String(raw); const bucket = result[key]; if (bucket === undefined) result[key] = [value]; else bucket.push(value); }
  return result;
}
for (const failure of [-1, 0, 1]) {
  const items = [2, 3, 4], source = new Source(items), holder: { value: Partial<Record<PropertyKey, number[]>> | undefined } = { value: undefined };
  function select(value: number, index: number): string { log.push("callback:" + index + ":" + value); if (index === failure) throw new RangeError("callback"); return index % 2 === 0 ? "even" : "odd"; }
  const route: Route = [source, select];
  function invoke(): void { log.push("invoke"); holder.value = apply(route); }
  log.length = 0; if (failure < 0) invoke(); else assert.throws(RangeError, invoke);
  const histories: string[][] = [["next:0", "callback:0:2", "next:1", "callback:1:3", "next:2", "callback:2:4", "next:3"], ["next:0", "callback:0:2", "return"], ["next:0", "callback:0:2", "next:1", "callback:1:3", "return"]];
  assert.compareArray(log, ["invoke", "apply", "iterate", ...histories[failure + 1]]); assert.compareArray(items, [2, 3, 4]);
  if (failure < 0) { const result = holder.value; if (result === undefined) throw new Test262Error("missing result"); const even = result["even"], odd = result["odd"]; if (even === undefined || odd === undefined) throw new Test262Error("missing group"); assert.compareArray(Object.keys(result), ["even", "odd"]); assert.compareArray(even, [2, 4]); assert.compareArray(odd, [3]); assert.sameValue("valueOf" in result, false); }
  else assert.sameValue(holder.value, undefined);
}
