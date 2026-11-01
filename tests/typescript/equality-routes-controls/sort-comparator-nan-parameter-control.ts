/*---
description: Control for sort-comparator-nan-parameter; explicit kind records preserve every comparison, stable order and conversion log.
features: [ts-equality-route-sorting, ts-arrays, ts-unions, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-functions, ts-function-types]
---*/
// Control: explicit kind records select concrete conversions and comparisons; ordering, identities and logs remain the same.
interface SortObject { id: number; rank: number; }
const hookLog: unknown[] = []; const identity: SortObject = { id: 1, rank: 0 }, twin: SortObject = { id: 2, rank: 0 };
type SortRecord = { kind: "number"; value: number } | { kind: "string"; value: string } | { kind: "bigint"; value: bigint } | { kind: "boolean"; value: boolean } | { kind: "null"; value: null } | { kind: "undefined"; value: undefined } | { kind: "object"; hook: "plain"; value: SortObject };
const inputs: SortRecord[] = [{ kind: "number", value: -0 }, { kind: "number", value: 0 }, { kind: "number", value: NaN }, { kind: "number", value: Infinity }, { kind: "number", value: 1 }, { kind: "string", value: "1" }, { kind: "string", value: "" }, { kind: "string", value: "0" }, { kind: "bigint", value: 0n }, { kind: "bigint", value: 1n }, { kind: "boolean", value: true }, { kind: "boolean", value: false }, { kind: "null", value: null }, { kind: "undefined", value: undefined }, { kind: "object", hook: "plain", value: identity }, { kind: "object", hook: "plain", value: identity }, { kind: "object", hook: "plain", value: twin }, { kind: "number", value: 10 }, { kind: "number", value: 2 }, { kind: "string", value: "10" }, { kind: "string", value: "2" }, { kind: "number", value: -Infinity }, { kind: "number", value: 1.5 }, { kind: "number", value: 2147483648 }];
function finiteKey(value: number): number { return Number.isNaN(value) ? 5 : value === Infinity ? 4 : value === -Infinity ? -4 : value; }
function numeric(item: SortRecord): number { switch (item.kind) {
  case "number": return Number(item.value); case "string": return Number(item.value); case "bigint": return Number(item.value);
  case "boolean": return Number(item.value); case "null": return Number(item.value); case "undefined": return Number(item.value);
  case "object": return item.value.rank;
} }
function compare(left: SortRecord, right: SortRecord): number { const a = finiteKey(numeric(left)), b = finiteKey(numeric(right)); return a === b ? NaN : a < b ? -1 : 1; }
function ordered(values: SortRecord[], comparator: (left: SortRecord, right: SortRecord) => number): SortRecord[] {
  const present: SortRecord[] = [], absent: SortRecord[] = []; for (const item of values) { if (item.kind === "undefined") absent.push(item); else present.push(item); }
  present.sort(comparator); let at = 0; for (const item of present) values[at++] = item; for (const item of absent) values[at++] = item; return values;
}
const answers: number[] = [];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const result = compare(inputs[i], inputs[j]); answers.push(result); assert.sameValue(typeof result, "number");
}
assert.compareArray(answers, [NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, 1, 1, NaN, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, NaN, 1, 1, 1, -1, 1, -1, 1, 1, 1, -1, 1, 1, -1, NaN, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, -1, 1, -1, 1, 1, 1, -1, 1, 1, -1, -1, NaN, NaN, 1, 1, 1, NaN, NaN, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, NaN, NaN, 1, 1, 1, NaN, NaN, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, NaN, NaN, 1, 1, 1, NaN, NaN, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, NaN, NaN, 1, 1, 1, NaN, NaN, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, 1, 1, NaN, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, NaN, 1, 1, 1, -1, 1, -1, 1, 1, 1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, NaN, NaN, -1, -1, -1, -1, NaN, NaN, NaN, -1, -1, NaN, NaN, -1, NaN, NaN, NaN, -1, -1, -1, -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, NaN, 1, NaN, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, -1, NaN, -1, NaN, 1, 1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, NaN, 1, NaN, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, -1, NaN, -1, NaN, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, NaN, -1, -1, 1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, NaN, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, NaN]); assert.sameValue(answers.length, inputs.length * inputs.length);
hookLog.length = 0; const original = inputs.slice(), work = inputs.slice(), result = ordered(work, compare);
assert.sameValue(Object.is(result, work), true); assert.sameValue(result.length, inputs.length);
const order: number[] = [21, 0, 1, 6, 7, 8, 11, 12, 14, 15, 16, 4, 5, 9, 10, 22, 18, 20, 3, 2, 17, 19, 23, 13];
for (let i = 0; i < order.length; i++) { assert.sameValue(result[i], inputs[order[i]]); assert.sameValue(typeof result[i].value, typeof inputs[order[i]].value); }
assert.compareArray(inputs, original);
assert.compareArray(hookLog, []);
