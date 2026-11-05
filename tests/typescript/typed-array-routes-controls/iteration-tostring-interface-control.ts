/*---
description: "ToString uses comma-separated numeric text for each receiver kind. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-bigint, ts-interfaces, ts-class, ts-class-fields, ts-tuples, ts-strings]
---*/

function localUint16Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localBigInt64Array(values: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localToString(data: readonly (number | bigint)[]): string { let text = ""; for (let i = 0; i < data.length; i++) text += (i === 0 ? "" : ",") + String(data[i]); return text; }
// ToString uses comma-separated numeric text for each receiver kind. Route: one interface implemented by numeric and bigint stores.
// Node prints iteration-tostring-interface:ok.
type Numbers = number[]; type Bigints = bigint[];
interface TextStore { text(): string; }
class NumberText implements TextStore { data: Numbers = localUint16Array([3, 5]); text(): string { return localToString(this.data); } }
class BigText implements TextStore { data: Bigints = localBigInt64Array([-1n, 2n]); text(): string { return localToString(this.data); } }
const rows: readonly [TextStore, string][] = [[new NumberText(), "3,5"], [new BigText(), "-1,2"]];
for (const [store, expected] of rows) assert.sameValue(store.text(), expected);
console.log("iteration-tostring-interface:ok");
