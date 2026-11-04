/*---
description: "Control for suspensions-yield-compound-uint8; Compound Uint8Array addition retains the old view, index and number across yield while wrapping only its store."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-typed-array-conversion, ts-conversions, ts-tuples, ts-destructuring, ts-typeof-operator]
---*/
// An interface-held Uint8Array routes computed += across yield; node keeps the earlier view/index/read, returns the unwrapped sum and overwrites the caller mutation with its wrapped byte. The control saves each evaluated part and yields in its own statement.
const log: string[] = [];
interface Route { view: Uint8Array; index: number; }
function target(route: Route): Uint8Array { log.push("view"); return route.view; }
function key(route: Route): number { log.push(`index:${route.index}`); return route.index; }
function pause(): number { log.push("pause"); return 7; }
function* update(route: Route): Generator<number, number, number> {
  log.push("start");
  const receiver = target(route);
  const index = key(route);
  const left = receiver[index];
  const outgoing = pause();
  const incoming = yield outgoing;
  const result = left + incoming;
  receiver[index] = result;
  log.push("complete"); return result;
}
const rows: [number, number, number, number][] = [[255, 1, 256, 0], [0, -1, -1, 255], [254, 5, 259, 3]];
for (const [initial, sent, expected, stored] of rows) {
  const cell = new Uint8Array([initial, 77]), other = new Uint8Array([90, 91]), route: Route = { view: cell, index: 0 };
  log.length = 0; const iterator = update(route); assert.compareArray(log, []); const first = iterator.next();
  assert.compareArray(log, ["start", "view", "index:0", "pause"]); assert.sameValue(first.value, 7); assert.sameValue(first.done, false);
  log.push("mutate"); cell[0] = 100; route.view = other; route.index = 1;
  const second = iterator.next(sent); const finished = iterator.next(999);
  assert.compareArray(log, ["start", "view", "index:0", "pause", "mutate", "complete"]);
  assert.sameValue(second.value, expected); assert.sameValue(typeof second.value, "number"); assert.sameValue(second.done, true);
  assert.sameValue(cell[0], stored); assert.sameValue(cell[1], 77); assert.sameValue(other[0], 90); assert.sameValue(other[1], 91); assert.sameValue(route.view, other); assert.sameValue(route.index, 1);
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
