/*---
description: "ReduceRight visits from the last element and passes the evolving string accumulator. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-tuples, ts-arrow-functions, ts-strings]
---*/

function localUint8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localReduceRight(data: number[], callback: (text: string, value: number, index: number, self: number[]) => string, initial: string): string { let text = initial; for (let i = data.length - 1; i >= 0; i--) text = callback(text, data[i], i, data); return text; }
// ReduceRight visits from the last element and passes the evolving string accumulator. Route: a private byte array and a retained callback history.
// Node prints iteration-reduceright-text-private:ok.
type Values = number[];
class ReverseText {
  #data: Values; log: (string | number | boolean)[] = [];
  constructor(values: readonly number[]) { this.#data = localUint8Array(values); }
  text(): string { return localReduceRight(this.#data, (text, value, index, self) => { this.log.push(text, value, index, self === this.#data); return text + String(value); }, ""); }
}
const rows: readonly [readonly number[], string, readonly (string | number | boolean)[]][] = [[[1, 2, 3], "321", ["", 3, 2, true, "3", 2, 1, true, "32", 1, 0, true]], [[4, 5], "54", ["", 5, 1, true, "5", 4, 0, true]]];
for (const [values, expected, expectedLog] of rows) {
  const holder = new ReverseText(values); assert.sameValue(holder.text(), expected); assert.compareArray(holder.log, expectedLog);
}
console.log("iteration-reduceright-text-private:ok");
