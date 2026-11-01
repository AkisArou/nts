/*---
description: "Three subclass layouts preserve every field and bidirectional writes through a base-typed map."
features: [ts-layout-routes, ts-layout-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-instanceof, ts-map-set]
---*/
// Added, shared and redeclared fields cross a base-typed map; node keeps each layout, reference and writes in both directions.
type LayoutPoint = { id: number };
type LayoutValue = number | string | bigint | boolean | undefined | null | LayoutPoint;
type LayoutRow = { num: number; next: number; text: string; big: bigint; maybe: LayoutPoint | null | undefined; ref: LayoutPoint };
const firstRef: LayoutPoint = { id: 7 }, secondRef: LayoutPoint = { id: 11 }, thirdRef: LayoutPoint = { id: 13 };
const rows: LayoutRow[] = [{ num: -0, next: NaN, text: "", big: 0n, maybe: undefined, ref: firstRef }, { num: NaN, next: 3.5, text: "next", big: -2n, maybe: null, ref: secondRef }, { num: 3.5, next: -0, text: "last", big: 9n, maybe: firstRef, ref: thirdRef }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class LayoutBase { num: number; shared: LayoutValue; constructor(row: LayoutRow) { this.num = row.num; this.shared = row.text; } }
class LayoutAdded extends LayoutBase { note: string; extra: LayoutPoint; constructor(row: LayoutRow) { super(row); this.note = row.text; this.extra = row.ref; } }
class LayoutShared extends LayoutBase { big: bigint; marker: boolean; constructor(row: LayoutRow) { super(row); this.big = row.big; this.marker = false; this.shared = row.maybe; } }
class LayoutRedeclared extends LayoutBase { override shared: LayoutValue = undefined; extra: LayoutPoint; constructor(row: LayoutRow) { super(row); this.extra = row.ref; this.shared = row.big; } }
function observe(value: LayoutBase, row: LayoutRow, kind: number, num: number, shared: LayoutValue): void {
  same(value.num, num); same(value.shared, shared); same(value instanceof LayoutBase, true);
  same(value instanceof LayoutAdded, kind === 0); same(value instanceof LayoutShared, kind === 1); same(value instanceof LayoutRedeclared, kind === 2);
  same("num" in value, true); same("shared" in value, true); same("note" in value, kind === 0); same("extra" in value, kind !== 1); same("big" in value, kind === 1); same("marker" in value, kind === 1); same("missing" in value, false);
  if (value instanceof LayoutAdded) { same(value.num, num); same(value.shared, shared); same(value.note, row.text); same(value.extra, row.ref); }
  else if (value instanceof LayoutShared) { same(value.num, num); same(value.shared, shared); same(value.big, row.big); same(value.marker, false); }
  else if (value instanceof LayoutRedeclared) { same(value.num, num); same(value.shared, shared); same(value.extra, row.ref); }
  else throw new Error("unexpected layout");
}
function writeSubclass(value: LayoutBase, row: LayoutRow): void {
  if (value instanceof LayoutAdded) { value.num = row.num; value.shared = row.maybe; }
  else if (value instanceof LayoutShared) { value.num = row.num; value.shared = row.maybe; }
  else if (value instanceof LayoutRedeclared) { value.num = row.num; value.shared = row.maybe; }
  else throw new Error("unexpected layout");
}
for (const row of rows) {
  const originals: LayoutBase[] = [new LayoutAdded(row), new LayoutShared(row), new LayoutRedeclared(row)];
  for (let kind = 0; kind < originals.length; kind++) {
    const original = originals[kind]; const carrier = new Map<string, LayoutBase>(); carrier.set("item", original); const value = carrier.get("item"); if (value === undefined) throw new Error("missing stored instance");
    same(value, original); observe(value, row, kind, row.num, kind === 0 ? row.text : kind === 1 ? row.maybe : row.big);
    value.num = row.next; value.shared = row.ref; observe(original, row, kind, row.next, row.ref);
    writeSubclass(original, row); observe(value, row, kind, row.num, row.maybe); same(carrier.get("item"), original);
  }
}
