/*---
description: "Join formats exact signed bigint elements with each supplied separator. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-class, ts-class-fields, ts-private-fields, ts-tuples, ts-strings]
---*/

function localBigInt64Array(values: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localJoin(data: bigint[], separator: string = ","): string { let result = ""; for (let i = 0; i < data.length; i++) result += (i === 0 ? "" : separator) + String(data[i]); return result; }
// Join formats exact signed bigint elements with each supplied separator. Route: a private signed bigint array.
// Node prints iteration-join-bigint-private:ok.
type Values = bigint[];
class WideText {
  #data: Values = localBigInt64Array([-1n, 9007199254740993n]);
  join(separator: string): string { return localJoin(this.#data, separator); }
}
const holder = new WideText();
const rows: readonly [string, string][] = [["|", "-1|9007199254740993"], ["", "-19007199254740993"], ["::", "-1::9007199254740993"]];
for (const [separator, expected] of rows) assert.sameValue(holder.join(separator), expected);
console.log("iteration-join-bigint-private:ok");
