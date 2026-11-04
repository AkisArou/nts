/*---
description: "A nested short array pattern closes before a later outer property is read. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-objects, ts-accessors, ts-symbols, ts-unions, ts-null-undefined]
---*/
// An interface supplies a nested iterable and tail getter; node applies the optional default, closes the inner iterator, then observes the close effect at the tail. The control names each ordered part.
const log: string[] = [];
interface Source { pair: Iterable<number | undefined>; after: number; }
let current = 0;
function fallback(): number { log.push("default"); current += 10; return current; }
function read(source: Source): number[] {
  log.push("read");
  const sourcePart = source;
  const pairPart = sourcePart.pair;
  const open = pairPart[Symbol.iterator];
  const cursor = open.call(pairPart);
  const step = cursor.next();
  const firstPart = step.done ? undefined : step.value;
  let selected = firstPart;
  if (selected === undefined) { const replacement = fallback(); selected = replacement; }
  const first = selected;
  if (!step.done) { const close = cursor.return; if (close !== undefined) { const closed = close.call(cursor); } }
  const after = sourcePart.after;
  return [first, after];
}
for (const missing of [false, true]) for (const input of [3, 7]) {
  log.length = 0; current = input;
  const pair: Iterable<number | undefined> = { [Symbol.iterator](): Iterator<number | undefined, undefined> { log.push("iterator"); return {
    next(): IteratorResult<number | undefined, undefined> { log.push("next"); return { done: false, value: missing ? undefined : current }; },
    return(): IteratorResult<number | undefined, undefined> { log.push("return"); current += 100; return { done: true, value: undefined }; }
  }; } };
  const source: Source = { get pair(): Iterable<number | undefined> { log.push("get:pair"); return pair; }, get after(): number { log.push("get:after"); return current; } };
  const result = read(source);
  assert.compareArray(log, missing ? ["read", "get:pair", "iterator", "next", "default", "return", "get:after"] : ["read", "get:pair", "iterator", "next", "return", "get:after"]);
  assert.compareArray(result, [missing ? input + 10 : input, missing ? input + 110 : input + 100]); assert.sameValue(current, missing ? input + 110 : input + 100);
}
