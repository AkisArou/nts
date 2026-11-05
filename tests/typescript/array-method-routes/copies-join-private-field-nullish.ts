/*---
description: "Join keeps signed-zero and NaN text while null and undefined contribute empty fields through a private array field."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-unions, ts-numbers, ts-strings, ts-null-undefined]
---*/

// Join keeps signed-zero and NaN text while null and undefined contribute empty fields; route: a private array field.
// Node prints copies-join-private-field-nullish:ok.
class JoinBox {
  #items: (number | string | null | undefined)[] = [-0, NaN, "tail", null, undefined];
  render(separator?: string): string { return this.#items.join(separator); }
  read(): readonly (number | string | null | undefined)[] { return this.#items; }
}
const box: JoinBox = new JoinBox();
const rows: readonly [string | undefined, string][] = [[undefined, "0,NaN,tail,,"], ["|", "0|NaN|tail||"], ["", "0NaNtail"]];
for (const [separator, expected] of rows) {
  assert.sameValue(box.render(separator), expected);
  assert.compareArray(box.read(), [-0, NaN, "tail", null, undefined]);
  assert.sameValue(Object.is(box.read()[0], -0), true);
}
console.log("copies-join-private-field-nullish:ok");
