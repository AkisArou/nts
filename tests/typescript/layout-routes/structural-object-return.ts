/*---
description: "Three field layouts preserve exact data and alias writes through a smaller object-type return."
features: [ts-layout-routes, ts-layout-route-structural, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-unions, ts-class, ts-class-fields, ts-structural-typing, ts-instanceof, ts-narrowing]
---*/
// Alpha, Beta and Gamma have reordered common fields and distinct extra fields; a smaller object-type return retains each value and both directions of alias writes in node.
type LayoutRef = { id: number };
type LayoutRow = { num: number; text: string; ref: LayoutRef; big: bigint };
const refs: LayoutRef[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
const rows: LayoutRow[] = [{ num: -0, text: "", ref: refs[0], big: 0n }, { num: NaN, text: "text", ref: refs[1], big: -3n }, { num: 4.5, text: "0", ref: refs[2], big: 7n }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class LayoutAlpha {
  num: number; text: string; ref: LayoutRef; extra: bigint;
  constructor(row: LayoutRow) { this.num = row.num; this.text = row.text; this.ref = row.ref; this.extra = row.big; }
}
class LayoutBeta {
  pad: null; ref: LayoutRef; text: string; num: number; missing: undefined;
  constructor(row: LayoutRow) { this.pad = null; this.ref = row.ref; this.text = row.text; this.num = row.num; this.missing = undefined; }
}
class LayoutGamma {
  enabled: boolean; text: string; num: number; ref: LayoutRef; tail: string;
  constructor(row: LayoutRow) { this.enabled = false; this.text = row.text; this.num = row.num; this.ref = row.ref; this.tail = row.text + "!"; }
}
type LayoutView = { num: number; text: string; ref: LayoutRef };
function inspect(value: LayoutView, row: LayoutRow, original: LayoutRow, kind: string): void {
  same(value.num, row.num); same(value.text, row.text); same(value.ref, row.ref);
  same("num" in value, true); same("absent" in value, false); same("extra" in value, kind === "alpha"); same("pad" in value, kind === "beta");
  same("missing" in value, kind === "beta"); same("enabled" in value, kind === "gamma"); same("tail" in value, kind === "gamma");
  same(value instanceof LayoutAlpha, kind === "alpha"); same(value instanceof LayoutBeta, kind === "beta"); same(value instanceof LayoutGamma, kind === "gamma");
  if (value instanceof LayoutAlpha) same(value.extra, original.big);
  if (value instanceof LayoutBeta) { same(value.pad, null); same(value.missing, undefined); }
  if (value instanceof LayoutGamma) { same(value.enabled, false); same(value.tail, original.text + "!"); }
}
function carry(value: LayoutAlpha | LayoutBeta | LayoutGamma): LayoutView { return value; }
const kinds = ["alpha", "beta", "gamma"];
for (let i = 0; i < rows.length; i++) {
  const row = rows[i], next = rows[(i + 1) % rows.length];
  const sources = [new LayoutAlpha(row), new LayoutBeta(row), new LayoutGamma(row)];
  for (let j = 0; j < sources.length; j++) {
    const source = sources[j], kind = kinds[j];
    const view = carry(source);
    same(view, source); inspect(view, row, row, kind);
    view.num = next.num; view.text = next.text; view.ref = next.ref;
    same(source.num, next.num); same(source.text, next.text); same(source.ref, next.ref); inspect(view, next, row, kind);
    source.num = row.num; source.text = row.text; source.ref = row.ref;
    inspect(view, row, row, kind);
  }
}
