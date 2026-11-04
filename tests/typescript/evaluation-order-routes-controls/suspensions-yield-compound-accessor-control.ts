/*---
description: "Control for suspensions-yield-compound-accessor; Compound accessor assignment retains its target and old value across yield and returns the sum before setter transformation."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-accessors, ts-objects, ts-this, ts-tuples, ts-destructuring, ts-closures, ts-typeof-operator]
---*/
// An interface-held accessor carries += across yield; node keeps the original receiver/read while the caller mutates it and replaces the holder. The control saves each evaluated part and yields in its own statement.
const log: string[] = [];
interface Cell { id: string; raw: number; value: number; }
interface Route { current: Cell; }
function target(route: Route): Cell { log.push(`target:${route.current.id}`); return route.current; }
function pause(): number { log.push("pause"); return 7; }
function* update(route: Route): Generator<number, number, number> {
  log.push("start");
  const receiver = target(route);
  const left = receiver.value;
  const outgoing = pause();
  const incoming = yield outgoing;
  const result = left + incoming;
  receiver.value = result;
  return result;
}
const rows: [number, number][] = [[-2, 3], [0, -4], [8, 5]];
for (const [initial, sent] of rows) {
  const cell: Cell = { id: "first", raw: initial, get value(): number { log.push(`get:first:${this.raw}`); return this.raw; }, set value(next: number) { log.push(`set:first:${next}`); this.raw = next * 2; } };
  const other: Cell = { id: "other", raw: 90, value: 90 }, route: Route = { current: cell };
  log.length = 0; const iterator = update(route); assert.compareArray(log, []); const first = iterator.next();
  assert.compareArray(log, ["start", "target:first", `get:first:${initial}`, "pause"]); assert.sameValue(first.value, 7); assert.sameValue(first.done, false);
  log.push("mutate"); cell.raw = 100; route.current = other;
  const second = iterator.next(sent); const finished = iterator.next(999);
  assert.compareArray(log, ["start", "target:first", `get:first:${initial}`, "pause", "mutate", `set:first:${initial + sent}`]);
  assert.sameValue(second.value, initial + sent); assert.sameValue(typeof second.value, "number"); assert.sameValue(second.done, true);
  assert.sameValue(cell.raw, (initial + sent) * 2); assert.sameValue(other.raw, 90); assert.sameValue(other.value, 90); assert.sameValue(route.current, other);
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
