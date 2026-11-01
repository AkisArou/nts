/*---
description: A class instance holding a symbol throws while supported fields become a plain graph.
features: [ts-structuredclone-route-errors, ts-errors, ts-objects, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-interfaces, ts-index-signatures, ts-map-set, ts-arrays, ts-tuples, ts-numbers, ts-null-undefined, ts-unknown, ts-narrowing, ts-class, ts-class-fields, ts-symbols]
---*/
// A class-typed value owns a symbol-or-data field; node rejects the unsupported value and otherwise erases the class prototype.
type CloneValue = number | undefined | symbol | CloneCell;
interface CloneCell { [key: string]: CloneValue; }
type Snapshot = [string[], CloneValue[], unknown];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function remember(value: CloneValue, memo: Map<CloneCell, Snapshot>): void {
  if (typeof value !== "object" || memo.has(value)) return;
  memo.set(value, [Object.keys(value), Object.values<CloneValue>(value), Object.getPrototypeOf(value)]);
  for (const part of Object.values<CloneValue>(value)) remember(part, memo);
}
function inspect(source: CloneValue, copy: CloneValue, memo: Map<CloneCell, CloneCell>): void {
  if (typeof source !== "object") { same(copy, source); return; }
  if (typeof copy !== "object") throw new Error("missing object");
  const prior = memo.get(source); if (prior !== undefined) { same(copy, prior); return; }
  same(Array.from(memo.values()).includes(copy), false); memo.set(source, copy); same(Object.is(source, copy), false); same(Object.getPrototypeOf(copy), Object.prototype);
  assert.compareArray(Object.keys(copy), Object.keys(source));
  for (const key of Object.keys(source)) inspect(source[key], copy[key], memo);
}
class Carrier implements CloneCell { [key: string]: CloneValue; value: CloneValue; constructor(value: CloneValue) { this.value = value; } }
const child: CloneCell = { value: -0 }, shared: CloneCell = { other: child, value: child }, cycle: CloneCell = { value: NaN };
cycle.other = cycle;
const inputs: [CloneValue, boolean][] = [[undefined, false], [-0, false], [NaN, false], [{}, false], [shared, false], [cycle, false], [{ value: { value: -0 }, other: { value: -0 } }, false],
  [Symbol("local"), true], [Symbol.for("clone-route"), true], [{ value: Symbol.iterator }, true]];
for (const [input, fail] of inputs) {
  const source: Carrier = new Carrier(input);
  const snapshots = new Map<CloneCell, Snapshot>(), copies = new Map<CloneCell, CloneCell>(); remember(source, snapshots);
  let copy: CloneValue, caught: unknown, threw = false;
  try { copy = structuredClone(source); } catch (error) { caught = error; threw = true; }
  if (fail) { if (!(caught instanceof DOMException)) throw new Error("missing DataCloneError");
    same(caught.name, "DataCloneError"); same(Object.getPrototypeOf(caught), DOMException.prototype);
  } else { same(threw, false); inspect(source, copy, copies); }
  for (const [original, before] of snapshots) {
    assert.compareArray(Object.keys(original), before[0]); assert.compareArray(Object.values<CloneValue>(original), before[1]); same(Object.getPrototypeOf(original), before[2]);
  }
  if (!fail) same(copy instanceof Carrier, false);
  if (!fail) for (const [original, built] of copies) {
    const before = original.mark; built.mark = 17; same(original.mark, before); original.mark = 23; same(built.mark, 17);
  }
}
