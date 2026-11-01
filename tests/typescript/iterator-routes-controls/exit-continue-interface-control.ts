/*---
description: Control for exit-continue-interface; explicit iterator calls preserve delivery and closing order.
features: [ts-iterator-route-early-exit, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-arrays, ts-unions, ts-errors, ts-unknown]
---*/
// Control: replace the consumer with a next loop and explicit return calls at the same exits.
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
  const log: unknown[] = [], received: ExitValue[] = [], cursor = new ClosingCursor("it", items, log), route: ExitRoute = { source: cursor };
  try {
      const iterator = route.source[Symbol.iterator](); while (true) {
        const step = iterator.next(); if (step.done) break; const value = step.value;
        received.push(value); cursor.seen = value; log.push("value", value); if (cursor.index === 1) { log.push("continue"); continue; } log.push("tail", value);
      }
  } finally { log.push("finally", cursor.closed, cursor.cleaned, cursor.index); }
  const expected: unknown[] = ["it:iterator", 0];
  for (let i = 0; i <= items.length; i++) { expected.push("it:next", 0, undefined); if (i < items.length) { expected.push("value", items[i]); if (i === 0) expected.push("continue"); else expected.push("tail", items[i]); } }
  expected.push("finally", 0, undefined, items.length); assert.compareArray(log, expected); assert.compareArray(received, items);
  assert.sameValue(cursor.closed, 0); assert.sameValue(cursor.cleaned, undefined); assert.sameValue(cursor.index, items.length);
  assert.sameValue(Object.is(cursor.seen, items[items.length - 1]), true);
}
