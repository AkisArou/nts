/*---
description: A labelled break closes inner and outer typed iterators in that order before finally.
features: [ts-iterator-route-early-exit, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-arrays, ts-unions, ts-errors, ts-unknown]
---*/
// Route: nested mixed-value class iterators exit through an outer label; node closes the inner iterator before the outer one.
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
  const log: unknown[] = [], received: ExitValue[] = [], outer = new ClosingCursor("outer", items, log), inner = new ClosingCursor("inner", items, log), route: ExitRoute = { source: outer };
  try {
    outerLoop: for (const outerValue of route.source) {
      outer.seen = outerValue; received.push(outerValue); log.push("outer:value", outerValue);
      for (const innerValue of inner) { inner.seen = innerValue; received.push(innerValue); log.push("inner:value", innerValue, "label:break"); break outerLoop; }
    }
  } finally { log.push("finally", inner.closed, outer.closed); }
  const active = items.length > 0, expected: unknown[] = ["outer:iterator", 0, "outer:next", 0, undefined];
  if (active) expected.push("outer:value", input, "inner:iterator", 0, "inner:next", 0, undefined, "inner:value", input, "label:break", "inner:return", 0, undefined, "inner:clean", input, "outer:return", 0, undefined, "outer:clean", input);
  expected.push("finally", active ? 1 : 0, active ? 1 : 0); assert.compareArray(log, expected); assert.compareArray(received, active ? [input, input] : []);
  for (const cursor of [inner, outer]) { assert.sameValue(cursor.closed, active ? 1 : 0); assert.sameValue(cursor.index, active ? 1 : 0); assert.sameValue(Object.is(cursor.cleaned, active ? input : undefined), true); }
}
