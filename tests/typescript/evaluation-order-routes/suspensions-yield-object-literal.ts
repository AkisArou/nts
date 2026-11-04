/*---
description: "An object literal retains its early field across yield and reads a later field from the caller-replaced class holder."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-tuples, ts-destructuring, ts-objects, ts-narrowing, ts-typeof-operator]
---*/
// A declared Holder.current field supplies values around yield; node stores the old first value, sent middle value and new current last value in source order.
const log: string[] = [];
interface Input { early: number; late: number; }
interface Output { first: number; middle: number; last: number; }
class Holder { current: Input; constructor(current: Input) { log.push("new"); this.current = current; } }
function first(route: Holder): number { log.push(`first:${route.current.early}`); return route.current.early; }
function last(route: Holder): number { log.push(`last:${route.current.late}`); return route.current.late; }
function pause(): number { log.push("pause"); return 7; }
function* build(route: Holder): Generator<number, Output, number> {
  log.push("start");
  return { first: first(route), middle: yield pause(), last: last(route) };
}
const rows: [number, number][] = [[-2, 3], [0, -4], [8, 5]];
for (const [initial, sent] of rows) {
  const old: Input = { early: initial, late: 2 }, replacement: Input = { early: 300, late: 40 }, route = new Holder(old);
  log.length = 0; const iterator = build(route); assert.compareArray(log, []); const yielded = iterator.next();
  assert.compareArray(log, ["start", `first:${initial}`, "pause"]); assert.sameValue(yielded.value, 7); assert.sameValue(yielded.done, false);
  log.push("mutate"); old.early = 100; old.late = 200; route.current = replacement;
  const completed = iterator.next(sent); const finished = iterator.next(999);
  assert.compareArray(log, ["start", `first:${initial}`, "pause", "mutate", "last:40"]);
  assert.sameValue(completed.done, true); assert.sameValue(typeof completed.value, "object");
  if (completed.done) { assert.sameValue(completed.value.first, initial); assert.sameValue(completed.value.middle, sent); assert.sameValue(completed.value.last, 40); assert.compareArray(Object.keys(completed.value), ["first", "middle", "last"]); }
  assert.sameValue(old.early, 100); assert.sameValue(old.late, 200); assert.sameValue(route.current, replacement);
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
