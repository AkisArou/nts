/*---
description: "A binary expression retains its evaluated left number across yield while reading the later operand live."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-accessors, ts-objects, ts-tuples, ts-destructuring, ts-closures, ts-typeof-operator]
---*/
// An interface parameter carries addition around yield; node keeps the first number, accepts the sent operand, then reads the caller-mutated trailing number.
const log: string[] = [];
interface Input { left: number; right: number; }
function pause(): number { log.push("pause"); return 7; }
function* calculate(source: Input): Generator<number, number, number> {
  log.push("start");
  return source.left + (yield pause()) + source.right;
}
const rows: [number, number][] = [[-2, 3], [0, -4], [8, 5]];
for (const [initial, sent] of rows) {
  let left = initial, right = 2;
  const source: Input = { get left(): number { log.push(`left:${left}`); return left; }, get right(): number { log.push(`right:${right}`); return right; } };
  log.length = 0; const iterator = calculate(source); assert.compareArray(log, []);
  const first = iterator.next();
  assert.compareArray(log, ["start", `left:${initial}`, "pause"]); assert.sameValue(first.value, 7); assert.sameValue(first.done, false);
  log.push("mutate"); left = 100; right = 20;
  const second = iterator.next(sent); const finished = iterator.next(999);
  assert.compareArray(log, ["start", `left:${initial}`, "pause", "mutate", "right:20"]);
  assert.sameValue(second.value, initial + sent + 20); assert.sameValue(typeof second.value, "number"); assert.sameValue(second.done, true);
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true); assert.sameValue(left, 100); assert.sameValue(right, 20);
}
