/*---
description: Control for exit-break-interface; explicit iterator calls preserve delivery and closing order.
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
  const log: unknown[] = [], received: ExitValue[] = [], closeError = new RangeError("close failed");
  const cursor = new ClosingCursor("it", items, log, undefined), route: ExitRoute = { source: cursor }; let caught: unknown;
  try {
    try {
      const iterator = route.source[Symbol.iterator](); while (true) {
        const step = iterator.next(); if (step.done) break; const value = step.value;
        received.push(value); cursor.seen = value; log.push("value", value, "break"); if (iterator.return) iterator.return(); break;
      }
    } finally { log.push("finally", cursor.closed, cursor.cleaned, cursor.index); }
  } catch (error: unknown) { caught = error; log.push("catch", error); }
  log.push("after"); const active = items.length > 0, expected: unknown[] = ["it:iterator", 0, "it:next", 0, undefined];
  if (active) expected.push("value", input, "break", "it:return", 0, undefined, "it:clean", input);
  expected.push("finally", active ? 1 : 0, active ? input : undefined, active ? 1 : 0);
   expected.push("after"); assert.compareArray(log, expected);
  assert.compareArray(received, active ? [input] : []); assert.sameValue(Object.is(cursor.seen, active ? input : undefined), true);
  assert.sameValue(cursor.closed, active ? 1 : 0); assert.sameValue(Object.is(cursor.cleaned, active ? input : undefined), true);
  assert.sameValue(caught, undefined);
}
