/*---
description: "Join keeps signed-zero and NaN text while null and undefined contribute empty fields through a private array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-unions, ts-numbers, ts-strings, ts-null-undefined]
---*/

type LocalJoinValue = number | string | boolean | null | undefined | readonly LocalJoinValue[];
function localJoin(items: readonly LocalJoinValue[], separator: string = ","): string {
  let text: string = "";
  for (let i = 0; i < items.length; i++) {
    if (i > 0) text += separator;
    const value = items[i];
    if (value === null || value === undefined) continue;
    text += typeof value === "object" ? localJoin(value, ",") : "" + value;
  }
  return text;
}
// Join keeps signed-zero and NaN text while null and undefined contribute empty fields; route: a private array field.
// Node prints copies-join-private-field-nullish:ok.
class JoinBox {
  #items: (number | string | null | undefined)[] = [-0, NaN, "tail", null, undefined];
  render(separator?: string): string { return localJoin(this.#items, separator); }
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
