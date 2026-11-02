/*---
description: Class and literal interface factories return Generator objects whose return-yield expression returns the sent value once and then stays completed.
features: [ts-generator-route-sending-completion, ts-generators, ts-iteration, ts-arrays, ts-class, ts-interfaces, ts-unions, ts-null-undefined, ts-errors]
---*/
// Explicit state-number control; An interface factory returns a full Generator; node yields the initial input, returns the resumed yield value by identity and runs finally once.
type Value = number | string | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Factory { open(value: Value, log: unknown[]): Generator<Value, Value, Value>; }
function check(step: { value: unknown; done?: boolean }, value: unknown, done: boolean, seen: object[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
class ExplicitCursor extends Iterator<Value, Value, Value> {
  state: number = 0; initial: Value; log: unknown[];
  constructor(initial: Value, log: unknown[]) { super(); this.initial = initial; this.log = log; }
  [Symbol.iterator](): Generator<Value, Value, Value> { return this; }
  next(sent?: Value): Step { if (this.state === 0) { this.state = 1; this.log.push("start", this.initial); return { value: this.initial, done: false }; } if (this.state === 1) { this.state = 2; this.log.push("finally"); return { value: sent, done: true }; } return { value: undefined, done: true }; }
  return(value?: Value): Step { if (this.state === 1) this.log.push("finally"); this.state = 2; return { value, done: true }; }
  throw(error?: unknown): Step { if (this.state === 1) this.log.push("finally"); this.state = 2; throw error; }
}
class Source { open(value: Value, log: unknown[]): Generator<Value, Value, Value> { return new ExplicitCursor(value, log); } }
const literal: Factory = { open(value: Value, log: unknown[]): Generator<Value, Value, Value> { return new ExplicitCursor(value, log); } };
const makers: Factory[] = [new Source(), literal];
const identity = { id: 53 }, incoming = { id: 59 }, inputs: Value[] = [-0, NaN, undefined, identity], sends: Value[] = [-0, NaN, "sent", undefined, incoming];
for (const make of makers) for (const value of inputs) for (const sent of sends) {
  const log: unknown[] = [], seen: object[] = [], cursor = make.open(value, log);
  check(cursor.next("ignored"), value, false, seen); check(cursor.next(sent), sent, true, seen);
  check(cursor.next(identity), undefined, true, seen); check(cursor.next(), undefined, true, seen); assert.compareArray(log, ["start", value, "finally"]);
}
