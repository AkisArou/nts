/*---
description: "A nonconstructor new target captured through Object.assign throws only after all arguments repair the tuple."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-this, ts-new-target, ts-type-aliases, ts-tuples, ts-construct-signatures, ts-arrow-functions, ts-closures, ts-objects, ts-unions, ts-null-undefined, ts-unknown, ts-errors, ts-instanceof, ts-narrowing, ts-unsound-object-assign, ts-template-literals]
---*/
// A typed constructor tuple is ordinarily overwritten; node captures that old value, evaluates both arguments and throws TypeError even though the first argument installs a valid constructor.
const log: string[] = [];
class Item { values: number[]; target: Function; constructor(a: number, b: number) { log.push(`construct:${a}:${b}`); this.values = [a, b]; this.target = new.target; } }
type Ctor = new(a: number, b: number) => Item;
type Slot = [Ctor];
let state = 0;
const arrow = (a: number, b: number): number => { log.push(`arrow:${a}:${b}`); return a + b; };
function first(slot: Slot, n: number): number { log.push(`first:${n}`); slot[0] = Item; state = n; return n + 1; }
function second(): number { log.push(`second:${state}`); return state + 2; }
function run(slot: Slot, n: number): Item { log.push("run"); return new slot[0](first(slot, n), second()); }
const rows: [unknown, boolean][] = [[0, false], ["text", false], [null, false], [undefined, false], [{}, false], [arrow, false], [Item, true]];
for (const row of rows) for (const n of [0, 3]) {
  const slot: Slot = [Item]; Object.assign(slot, { 0: row[0] }); state = 9; log.length = 0; let result: Item | undefined, caught: unknown;
  try { result = run(slot, n); } catch (error: unknown) { caught = error; log.push("catch"); }
  assert.compareArray(log, ["run", `first:${n}`, `second:${n}`, row[1] ? `construct:${n + 1}:${n + 2}` : "catch"]);
  assert.sameValue(slot[0], Item); assert.sameValue(state, n);
  if (row[1]) { assert.sameValue(caught, undefined); assert.sameValue(result instanceof Item, true); if (result instanceof Item) { assert.compareArray(result.values, [n + 1, n + 2]); assert.sameValue(result.target, Item); } }
  else { assert.sameValue(result, undefined); assert.sameValue(caught instanceof TypeError, true); if (caught instanceof TypeError) assert.sameValue(caught.constructor, TypeError); }
}
