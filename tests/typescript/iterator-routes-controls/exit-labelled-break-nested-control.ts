/*---
description: Control for exit-labelled-break-nested; explicit iterator calls preserve delivery and closing order.
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
  const log: unknown[] = [], received: ExitValue[] = [], outer = new ClosingCursor("outer", items, log), inner = new ClosingCursor("inner", items, log), route: ExitRoute = { source: outer };
  try {
    outerLoop: { const outerIterator = route.source[Symbol.iterator](); while (true) {
      const outerStep = outerIterator.next(); if (outerStep.done) break; const outerValue = outerStep.value;
      outer.seen = outerValue; received.push(outerValue); log.push("outer:value", outerValue); const innerIterator = inner[Symbol.iterator]();
      while (true) { const innerStep = innerIterator.next(); if (innerStep.done) break; const innerValue = innerStep.value;
        inner.seen = innerValue; received.push(innerValue); log.push("inner:value", innerValue, "label:break"); innerIterator.return(); if (outerIterator.return) outerIterator.return(); break outerLoop;
      }
    } }
  } finally { log.push("finally", inner.closed, outer.closed); }
  const active = items.length > 0, expected: unknown[] = ["outer:iterator", 0, "outer:next", 0, undefined];
  if (active) expected.push("outer:value", input, "inner:iterator", 0, "inner:next", 0, undefined, "inner:value", input, "label:break", "inner:return", 0, undefined, "inner:clean", input, "outer:return", 0, undefined, "outer:clean", input);
  expected.push("finally", active ? 1 : 0, active ? 1 : 0); assert.compareArray(log, expected); assert.compareArray(received, active ? [input, input] : []);
  for (const cursor of [inner, outer]) { assert.sameValue(cursor.closed, active ? 1 : 0); assert.sameValue(cursor.index, active ? 1 : 0); assert.sameValue(Object.is(cursor.cleaned, active ? input : undefined), true); }
}
