/*---
description: Continuing an outer typed loop closes each inner iterator but exhausts the outer iterator without closing it.
features: [ts-iterator-route-early-exit, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-arrays, ts-unions, ts-errors, ts-unknown]
---*/
// Route: a labelled continue leaves the inner class iterator and resumes the outer interface; node closes only the inner iterator.
type ExitValue = number | string | undefined | { id: number };
const marker = { id: 7 }, inputs: ExitValue[] = [-0, NaN, 1.5, 2147483648, "", "\u00e9\u4e2d", undefined, marker];
class ClosingCursor implements IterableIterator<ExitValue, undefined, ExitValue> {
  name: string; items: ExitValue[]; log: unknown[]; fault: Error | undefined;
  index: number = 0; closed: number = 0; seen: ExitValue = undefined; cleaned: ExitValue = undefined;
  constructor(name: string, items: ExitValue[], log: unknown[], fault?: Error) {
    this.name = name; this.items = items; this.log = log; this.fault = fault;
  }
  [Symbol.iterator](): ClosingCursor { this.log.push(this.name + ":iterator", arguments.length); return this; }
  next(sent?: ExitValue): IteratorResult<ExitValue, undefined> {
    this.log.push(this.name + ":next", arguments.length, sent);
    return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] };
  }
  return(sent?: ExitValue): IteratorResult<ExitValue, undefined> {
    this.log.push(this.name + ":return", arguments.length, sent); this.closed++; this.cleaned = this.seen; this.log.push(this.name + ":clean", this.cleaned);
    if (this.fault) { this.log.push("close:throw", this.fault); throw this.fault; } return { done: true, value: undefined };
  }
  throw(error?: unknown): IteratorResult<ExitValue, undefined> { this.log.push(this.name + ":throw", arguments.length, error); throw error; }
}
interface ExitRoute { source: IterableIterator<ExitValue, undefined, ExitValue>; }
for (const input of inputs) for (const items of [[], [input], [input, "tail", undefined]]) {
  const log: unknown[] = [], received: ExitValue[] = [], inners: ClosingCursor[] = [], outer = new ClosingCursor("outer", items, log), route: ExitRoute = { source: outer };
  try {
    outerLoop: for (const outerValue of route.source) {
      outer.seen = outerValue; log.push("outer:value", outerValue); const inner = new ClosingCursor("inner", [outerValue, "skip"], log); inners.push(inner);
      for (const innerValue of inner) { inner.seen = innerValue; received.push(innerValue); log.push("inner:value", innerValue, "label:continue"); continue outerLoop; }
    }
  } finally { log.push("finally", outer.closed, inners.length); }
  const expected: unknown[] = ["outer:iterator", 0];
  for (const value of items) expected.push("outer:next", 0, undefined, "outer:value", value, "inner:iterator", 0, "inner:next", 0, undefined, "inner:value", value, "label:continue", "inner:return", 0, undefined, "inner:clean", value);
  expected.push("outer:next", 0, undefined, "finally", 0, items.length); assert.compareArray(log, expected); assert.compareArray(received, items);
  assert.sameValue(outer.closed, 0); assert.sameValue(outer.cleaned, undefined); assert.sameValue(outer.index, items.length);
  for (let i = 0; i < inners.length; i++) { assert.sameValue(inners[i].closed, 1); assert.sameValue(inners[i].index, 1); assert.sameValue(Object.is(inners[i].cleaned, items[i]), true); }
}
