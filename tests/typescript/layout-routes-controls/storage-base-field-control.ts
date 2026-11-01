/*---
description: "Control for storage-base-field; retain named data fields and replace class identity by kind."
features: [ts-layout-routes, ts-layout-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-optional-properties]
---*/
// Plain literals keep the same fields, input values and alias writes; kind explicitly records the original subclass and base membership.
type LayoutPoint = { id: number };
type LayoutValue = number | string | bigint | boolean | undefined | null | LayoutPoint;
type LayoutRow = { num: number; next: number; text: string; big: bigint; maybe: LayoutPoint | null | undefined; ref: LayoutPoint };
const firstRef: LayoutPoint = { id: 7 }, secondRef: LayoutPoint = { id: 11 }, thirdRef: LayoutPoint = { id: 13 };
const rows: LayoutRow[] = [{ num: -0, next: NaN, text: "", big: 0n, maybe: undefined, ref: firstRef }, { num: NaN, next: 3.5, text: "next", big: -2n, maybe: null, ref: secondRef }, { num: 3.5, next: -0, text: "last", big: 9n, maybe: firstRef, ref: thirdRef }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type LayoutBase = { kind: number; num: number; shared: LayoutValue; note?: string; extra?: LayoutPoint; big?: bigint; marker?: boolean };
function observe(value: LayoutBase, row: LayoutRow, kind: number, num: number, shared: LayoutValue): void {
  same(value.num, num); same(value.shared, shared); same(value.kind >= 0 && value.kind <= 2, true);
  same(value.kind === 0, kind === 0); same(value.kind === 1, kind === 1); same(value.kind === 2, kind === 2);
  same("num" in value, true); same("shared" in value, true); same("note" in value, kind === 0); same("extra" in value, kind !== 1); same("big" in value, kind === 1); same("marker" in value, kind === 1); same("missing" in value, false);
  if (value.kind === 0) { same(value.num, num); same(value.shared, shared); same(value.note, row.text); same(value.extra, row.ref); }
  else if (value.kind === 1) { same(value.num, num); same(value.shared, shared); same(value.big, row.big); same(value.marker, false); }
  else if (value.kind === 2) { same(value.num, num); same(value.shared, shared); same(value.extra, row.ref); }
  else throw new Error("unexpected layout");
}
function writeSubclass(value: LayoutBase, row: LayoutRow): void {
  if (value.kind === 0) { value.num = row.num; value.shared = row.maybe; }
  else if (value.kind === 1) { value.num = row.num; value.shared = row.maybe; }
  else if (value.kind === 2) { value.num = row.num; value.shared = row.maybe; }
  else throw new Error("unexpected layout");
}
for (const row of rows) {
  const originals: LayoutBase[] = [{ num: row.num, shared: row.text, note: row.text, extra: row.ref, kind: 0 }, { num: row.num, shared: row.maybe, big: row.big, marker: false, kind: 1 }, { num: row.num, shared: row.big, extra: row.ref, kind: 2 }];
  for (let kind = 0; kind < originals.length; kind++) {
    const original = originals[kind]; const carrier = { value: original }; const value: LayoutBase = carrier.value;
    same(value, original); observe(value, row, kind, row.num, kind === 0 ? row.text : kind === 1 ? row.maybe : row.big);
    value.num = row.next; value.shared = row.ref; observe(original, row, kind, row.next, row.ref);
    writeSubclass(original, row); observe(value, row, kind, row.num, row.maybe); same(carrier.value, original);
  }
}
