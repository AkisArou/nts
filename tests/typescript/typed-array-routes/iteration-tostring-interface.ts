/*---
description: "ToString uses comma-separated numeric text for each receiver kind."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-bigint, ts-interfaces, ts-class, ts-class-fields, ts-tuples, ts-strings]
---*/

// ToString uses comma-separated numeric text for each receiver kind. Route: one interface implemented by numeric and bigint stores.
// Node prints iteration-tostring-interface:ok.
type Numbers = Uint16Array; type Bigints = BigInt64Array;
interface TextStore { text(): string; }
class NumberText implements TextStore { data: Numbers = new Uint16Array([3, 5]); text(): string { return this.data.toString(); } }
class BigText implements TextStore { data: Bigints = new BigInt64Array([-1n, 2n]); text(): string { return this.data.toString(); } }
const rows: readonly [TextStore, string][] = [[new NumberText(), "3,5"], [new BigText(), "-1,2"]];
for (const [store, expected] of rows) assert.sameValue(store.text(), expected);
console.log("iteration-tostring-interface:ok");
