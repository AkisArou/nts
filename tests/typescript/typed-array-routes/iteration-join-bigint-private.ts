/*---
description: "Join formats exact signed bigint elements with each supplied separator."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-class, ts-class-fields, ts-private-fields, ts-tuples, ts-strings]
---*/

// Join formats exact signed bigint elements with each supplied separator. Route: a private signed bigint array.
// Node prints iteration-join-bigint-private:ok.
type Values = BigInt64Array;
class WideText {
  #data: Values = new BigInt64Array([-1n, 9007199254740993n]);
  join(separator: string): string { return this.#data.join(separator); }
}
const holder = new WideText();
const rows: readonly [string, string][] = [["|", "-1|9007199254740993"], ["", "-19007199254740993"], ["::", "-1::9007199254740993"]];
for (const [separator, expected] of rows) assert.sameValue(holder.join(separator), expected);
console.log("iteration-join-bigint-private:ok");
