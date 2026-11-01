/*---
description: A typed interface containing a reachable function throws without changing its original graph.
features: [ts-structuredclone-route-errors, ts-errors, ts-objects, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-interfaces, ts-index-signatures, ts-map-set, ts-arrays, ts-tuples, ts-numbers, ts-null-undefined, ts-unknown, ts-narrowing, ts-function-types, ts-arrow-functions]
---*/
// An interface holds functions or supported graphs; node throws only for reachable functions and otherwise copies every part.
type CloneValue = number | undefined | (() => number) | CloneCell;
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
interface Envelope extends CloneCell { value: CloneValue; }
const child: CloneCell = { value: -0 }, shared: CloneCell = { other: child, value: child }, cycle: CloneCell = { value: NaN };
cycle.other = cycle;
const inputs: [CloneValue, boolean][] = [[undefined, false], [-0, false], [NaN, false], [{}, false], [shared, false], [cycle, false], [{ value: { value: -0 }, other: { value: -0 } }, false],
  [() => -0, true], [{ value: () => NaN }, true]];
for (const [input, fail] of inputs) {
  const source: Envelope = { value: input };
  const snapshots = new Map<CloneCell, Snapshot>(), copies = new Map<CloneCell, CloneCell>(); remember(source, snapshots);
  let copy: CloneValue, caught: unknown, threw = false;
  try { copy = structuredClone(source); } catch (error) { caught = error; threw = true; }
  if (fail) { if (!(caught instanceof DOMException)) throw new Error("missing DataCloneError");
    same(caught.name, "DataCloneError"); same(Object.getPrototypeOf(caught), DOMException.prototype);
  } else { same(threw, false); inspect(source, copy, copies); }
  for (const [original, before] of snapshots) {
    assert.compareArray(Object.keys(original), before[0]); assert.compareArray(Object.values<CloneValue>(original), before[1]); same(Object.getPrototypeOf(original), before[2]);
  }
  if (!fail) for (const [original, built] of copies) {
    const before = original.mark; built.mark = 17; same(original.mark, before); original.mark = 23; same(built.mark, 17);
  }
}
