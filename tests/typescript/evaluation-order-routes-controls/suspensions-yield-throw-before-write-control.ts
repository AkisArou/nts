/*---
description: "Control for suspensions-yield-throw-before-write; An injected throw at a yielded compound operand preserves earlier effects and prevents the late operand and write."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-accessors, ts-objects, ts-this, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-instanceof, ts-narrowing, ts-typeof-operator]
---*/
// An interface accessor carries += with yield in its RHS; node retains the earlier read, runs finally on an injected RangeError, and skips the late helper and setter. The control saves each evaluated part and yields in its own statement.
const log: string[] = [];
interface Cell { id: string; raw: number; value: number; }
interface Route { current: Cell; tail: number; }
function target(route: Route): Cell { log.push(`target:${route.current.id}`); return route.current; }
function tail(route: Route): number { log.push(`tail:${route.tail}`); return route.tail; }
function pause(): number { log.push("pause"); return 7; }
function* update(route: Route): Generator<number, number, number> {
  log.push("start");
  try { const receiver = target(route);
    const left = receiver.value;
    const outgoing = pause();
    const incoming = yield outgoing;
    const trailing = tail(route);
    const right = incoming + trailing;
    const result = left + right;
    receiver.value = result;
    return result; }
  finally { log.push("finally"); }
}
for (const fail of [false, true]) for (const initial of [-2, 5]) {
  const cell: Cell = { id: "first", raw: initial, get value(): number { log.push(`get:first:${this.raw}`); return this.raw; }, set value(next: number) { log.push(`set:first:${next}`); this.raw = next * 2; } };
  const other: Cell = { id: "other", raw: 90, value: 90 }, route: Route = { current: cell, tail: 2 }, failure = new RangeError("injected");
  log.length = 0; const iterator = update(route); assert.compareArray(log, []); const first = iterator.next();
  assert.compareArray(log, ["start", "target:first", `get:first:${initial}`, "pause"]); assert.sameValue(first.value, 7); assert.sameValue(first.done, false);
  log.push("mutate"); cell.raw = 100; route.current = other; route.tail = 40;
  let caught: unknown; let completed: IteratorResult<number, number> | undefined;
  try { completed = fail ? iterator.throw(failure) : iterator.next(3); } catch (error) { log.push("caught"); caught = error; }
  const finished = iterator.next(999), expected = ["start", "target:first", `get:first:${initial}`, "pause", "mutate"];
  if (!fail) expected.push("tail:40", `set:first:${initial + 43}`); expected.push("finally"); if (fail) expected.push("caught");
  assert.compareArray(log, expected);
  assert.sameValue(caught, fail ? failure : undefined); assert.sameValue(caught instanceof RangeError, fail); assert.sameValue(completed === undefined, fail);
  if (completed !== undefined) { assert.sameValue(completed.done, true); assert.sameValue(completed.value, initial + 43); assert.sameValue(typeof completed.value, "number"); }
  assert.sameValue(cell.raw, fail ? 100 : (initial + 43) * 2); assert.sameValue(other.raw, 90); assert.sameValue(other.value, 90); assert.sameValue(route.current, other); assert.sameValue(route.tail, 40);
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
