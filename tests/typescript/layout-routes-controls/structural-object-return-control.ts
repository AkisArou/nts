/*---
description: "Control for structural-object-return; use plain field records and explicit kind metadata."
features: [ts-layout-routes, ts-layout-route-structural, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-optional-properties]
---*/
// Plain records replace Alpha, Beta and Gamma; kind stays beside their data and replaces instanceof, while all field reads and writes remain.
type LayoutRef = { id: number };
type LayoutRow = { num: number; text: string; ref: LayoutRef; big: bigint };
const refs: LayoutRef[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
const rows: LayoutRow[] = [{ num: -0, text: "", ref: refs[0], big: 0n }, { num: NaN, text: "text", ref: refs[1], big: -3n }, { num: 4.5, text: "0", ref: refs[2], big: 7n }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type LayoutData = { num: number; text: string; ref: LayoutRef; extra?: bigint; pad?: null; missing?: undefined; enabled?: boolean; tail?: string };
type LayoutView = { num: number; text: string; ref: LayoutRef };
function inspect(value: LayoutData, row: LayoutRow, original: LayoutRow, kind: string, actualKind: string): void {
  same(value.num, row.num); same(value.text, row.text); same(value.ref, row.ref);
  same("num" in value, true); same("absent" in value, false); same("extra" in value, kind === "alpha"); same("pad" in value, kind === "beta");
  same("missing" in value, kind === "beta"); same("enabled" in value, kind === "gamma"); same("tail" in value, kind === "gamma");
  same(actualKind === "alpha", kind === "alpha"); same(actualKind === "beta", kind === "beta"); same(actualKind === "gamma", kind === "gamma");
  if (actualKind === "alpha") same(value.extra, original.big);
  if (actualKind === "beta") { same(value.pad, null); same(value.missing, undefined); }
  if (actualKind === "gamma") { same(value.enabled, false); same(value.tail, original.text + "!"); }
}
function carry(value: LayoutData): LayoutView { return value; }
const kinds = ["alpha", "beta", "gamma"];
for (let i = 0; i < rows.length; i++) {
  const row = rows[i], next = rows[(i + 1) % rows.length];
  const sources: { kind: string; value: LayoutData }[] = [
    { kind: "alpha", value: { num: row.num, text: row.text, ref: row.ref, extra: row.big } },
    { kind: "beta", value: { pad: null, ref: row.ref, text: row.text, num: row.num, missing: undefined } },
    { kind: "gamma", value: { enabled: false, text: row.text, num: row.num, ref: row.ref, tail: row.text + "!" } }
  ];
  for (let j = 0; j < sources.length; j++) {
    const entry = sources[j], source = entry.value, kind = kinds[j];
    const view = carry(source);
    same(view, source); inspect(view, row, row, kind, entry.kind);
    view.num = next.num; view.text = next.text; view.ref = next.ref;
    same(source.num, next.num); same(source.text, next.text); same(source.ref, next.ref); inspect(view, next, row, kind, entry.kind);
    source.num = row.num; source.text = row.text; source.ref = row.ref;
    inspect(view, row, row, kind, entry.kind);
  }
}
