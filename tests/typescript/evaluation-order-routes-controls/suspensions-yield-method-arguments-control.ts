/*---
description: "Control for suspensions-yield-method-arguments; A method call retains its receiver, callee and early argument across yield while later arguments stay live."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-class-fields, ts-accessors, ts-function-types, ts-this, ts-this-parameter, ts-tuples, ts-destructuring, ts-type-aliases, ts-typeof-operator]
---*/
// An interface route carries a getter-selected method with yield in its arguments; node keeps the old method and receiver after caller replacement, then evaluates the last argument. The control saves each evaluated part and yields in its own statement.
const log: string[] = [];
type Call = (this: Receiver, first: number, middle: number, last: number) => number;
class Receiver {
  id: string; base: number; fn: Call;
  constructor(id: string, base: number, fn: Call) { log.push(`new:${id}`); this.id = id; this.base = base; this.fn = fn; }
  get method(): Call { log.push(`method:${this.id}`); return this.fn; }
}
interface Route { current: Receiver; firstValue: number; lastValue: number; }
function original(this: Receiver, first: number, middle: number, last: number): number { log.push(`call:${this.id}:${first}:${middle}:${last}:${this.base}`); return this.base + first * 100 + middle * 10 + last; }
function replacement(this: Receiver, first: number, middle: number, last: number): number { log.push(`replacement:${this.id}:${first}:${middle}:${last}`); return -1; }
function target(route: Route): Receiver { log.push(`target:${route.current.id}`); return route.current; }
function first(route: Route): number { log.push(`first:${route.firstValue}`); return route.firstValue; }
function last(route: Route): number { log.push(`last:${route.lastValue}`); return route.lastValue; }
function pause(): number { log.push("pause"); return 7; }
function* invoke(route: Route): Generator<number, number, number> {
  log.push("start");
  const receiver = target(route);
  const fn = receiver.method;
  const firstValue = first(route);
  const outgoing = pause();
  const incoming = yield outgoing;
  const lastValue = last(route);
  return fn.call(receiver, firstValue, incoming, lastValue);
}
const rows: [number, number][] = [[-2, 3], [0, -4], [5, 6]];
for (const [initial, sent] of rows) {
  const cell = new Receiver("first", 1, original), other = new Receiver("other", 90, replacement), route: Route = { current: cell, firstValue: initial, lastValue: 2 };
  log.length = 0; const iterator = invoke(route); assert.compareArray(log, []); const yielded = iterator.next();
  assert.compareArray(log, ["start", "target:first", "method:first", `first:${initial}`, "pause"]); assert.sameValue(yielded.value, 7); assert.sameValue(yielded.done, false);
  log.push("mutate"); cell.fn = replacement; cell.base = 100; route.current = other; route.firstValue = 900; route.lastValue = 40;
  const completed = iterator.next(sent); const finished = iterator.next(999);
  assert.compareArray(log, ["start", "target:first", "method:first", `first:${initial}`, "pause", "mutate", "last:40", `call:first:${initial}:${sent}:40:100`]);
  assert.sameValue(completed.value, 100 + initial * 100 + sent * 10 + 40); assert.sameValue(typeof completed.value, "number"); assert.sameValue(completed.done, true);
  assert.sameValue(cell.fn, replacement); assert.sameValue(cell.base, 100); assert.sameValue(other.base, 90); assert.sameValue(route.current, other); assert.sameValue(route.firstValue, 900); assert.sameValue(route.lastValue, 40);
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
