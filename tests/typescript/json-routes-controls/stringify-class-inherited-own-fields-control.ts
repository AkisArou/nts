/*---
description: Control for stringify-class-inherited-own-fields; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-inheritance, ts-private-fields, ts-accessors, ts-objects, ts-numbers, ts-strings]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
let getterReads = 0;
class JsonBaseRecord {
  base: number;
  #hidden: number;
  constructor(n: number) { this.base = n; this.#hidden = n + 100; }
  get hidden(): number { getterReads++; return this.#hidden; }
}
class JsonDerivedRecord extends JsonBaseRecord {
  label: string = "entry";
  amount: number;
  constructor(n: number) { super(n); this.amount = n + 0.5; }
  double(): number { return this.amount * 2; }
}
for (const n of [-2, 0, 7]) {
  getterReads = 0;
  const value = { base: n, label: "entry", amount: n + 0.5 };
  assert.compareArray(Object.keys(value), ["base", "label", "amount"]);
  assert.sameValue(JSON.stringify(value), `{"base":${n},"label":"entry","amount":${n + 0.5}}`);
  assert.sameValue(getterReads, 0);
}
