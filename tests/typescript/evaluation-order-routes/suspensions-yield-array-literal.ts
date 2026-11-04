/*---
description: "An array literal keeps its early element across yield and reads its later element through a replaced tuple carrier."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-tuples, ts-destructuring, ts-type-aliases, ts-objects, ts-narrowing, ts-typeof-operator]
---*/
// An interface-held tuple supplies array elements around yield; node retains the first number, inserts the sent number, and reads the new tuple for the last number.
const log: string[] = [];
type Pair = [number, number];
type Triple = [number, number, number];
interface Route { pair: Pair; }
function first(route: Route): number { log.push(`first:${route.pair[0]}`); return route.pair[0]; }
function last(route: Route): number { log.push(`last:${route.pair[1]}`); return route.pair[1]; }
function pause(): number { log.push("pause"); return 7; }
function* build(route: Route): Generator<number, Triple, number> {
  log.push("start");
  return [first(route), yield pause(), last(route)];
}
const rows: [number, number][] = [[-2, 3], [0, -4], [8, 5]];
for (const [initial, sent] of rows) {
  const old: Pair = [initial, 2], replacement: Pair = [300, 40], route: Route = { pair: old };
  log.length = 0; const iterator = build(route); assert.compareArray(log, []); const yielded = iterator.next();
  assert.compareArray(log, ["start", `first:${initial}`, "pause"]); assert.sameValue(yielded.value, 7); assert.sameValue(yielded.done, false);
  log.push("mutate"); old[0] = 100; old[1] = 200; route.pair = replacement;
  const completed = iterator.next(sent); const finished = iterator.next(999);
  assert.compareArray(log, ["start", `first:${initial}`, "pause", "mutate", "last:40"]);
  assert.sameValue(completed.done, true); assert.sameValue(typeof completed.value, "object");
  if (completed.done) { assert.compareArray(completed.value, [initial, sent, 40]); assert.sameValue(Array.isArray(completed.value), true); assert.sameValue(completed.value.length, 3); }
  assert.sameValue(old[0], 100); assert.sameValue(old[1], 200); assert.sameValue(route.pair, replacement);
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
