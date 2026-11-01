/*---
description: Control for sort-default-tosorted-generic; explicit kind records preserve every comparison, stable order and conversion log.
features: [ts-equality-route-sorting, ts-arrays, ts-unions, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-functions, ts-generics, ts-generic-constraints]
---*/
// Control: explicit kind records select concrete conversions and comparisons; ordering, identities and logs remain the same.
interface SortObject { id: number; rank: number; }
const hookLog: unknown[] = []; const identity: SortObject = { id: 1, rank: 0 }, twin: SortObject = { id: 2, rank: 0 };
type SortRecord = { kind: "number"; value: number } | { kind: "string"; value: string } | { kind: "bigint"; value: bigint } | { kind: "boolean"; value: boolean } | { kind: "null"; value: null } | { kind: "undefined"; value: undefined } | { kind: "object"; hook: "plain"; value: SortObject };
const inputs: SortRecord[] = [{ kind: "number", value: -0 }, { kind: "number", value: 0 }, { kind: "number", value: NaN }, { kind: "number", value: Infinity }, { kind: "number", value: 1 }, { kind: "string", value: "1" }, { kind: "string", value: "" }, { kind: "string", value: "0" }, { kind: "bigint", value: 0n }, { kind: "bigint", value: 1n }, { kind: "boolean", value: true }, { kind: "boolean", value: false }, { kind: "null", value: null }, { kind: "undefined", value: undefined }, { kind: "object", hook: "plain", value: identity }, { kind: "object", hook: "plain", value: identity }, { kind: "object", hook: "plain", value: twin }, { kind: "number", value: 10 }, { kind: "number", value: 2 }, { kind: "string", value: "10" }, { kind: "string", value: "2" }, { kind: "number", value: -Infinity }, { kind: "number", value: 1.5 }, { kind: "number", value: 2147483648 }];
function textOf(item: SortRecord): string { switch (item.kind) {
  case "number": return String(item.value); case "string": return String(item.value); case "bigint": return String(item.value);
  case "boolean": return String(item.value); case "null": return String(item.value); case "undefined": return String(item.value); case "object": return String(item.value);
} }
function before(left: SortRecord, right: SortRecord): boolean { if (left.kind === "undefined") return false; if (right.kind === "undefined") return true; const a = textOf(left), b = textOf(right); return a < b; }
function ordered(values: SortRecord[]): SortRecord[] {
  const output = values.slice();
  for (let i = 1; i < output.length; i++) { const item = output[i]; let j = i; while (j > 0 && before(item, output[j - 1])) { output[j] = output[j - 1]; j--; } output[j] = item; }
  return output;
}
const expectedTable = "TTTTTTFTTTTTTTTTTTTTTFTTTTTTTTFTTTTTTTTTTTTTTFTTFFTFFFFFFFTTTTTTTFFFFFFFFFTTFFFFFFTTTTTTTFFFFFFFFFTTTTFFFTTTTTTTTTTTTFTTFFTTTTFFFTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTFTTTTTTTTFTTTTTTTTTTTTTTFTTFFTTTTFFFTTTTTTTTTTTTFTTFFFFFFFFFFTFFTFFFFFFFFFFFFFFFFFFFFTTTTFFFFFFFFFFFFFFFFFFFFTFTTFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTTTTTTFFFFFFFFFFFFFFFFFTTTTTTTFFFFFFFFFFFFFFFFFTTTTTTTFFFFFFFFFTTFFFFFFTTTTTTTTTTTFFTFFTTFFFFFFTTTTTTTFTFTFFTFFTTFFFFFFTTTTTTTTTTTFFTFFTTFFFFFFTTTTTTTFTFTFFTTTTTTTFTTTTTTTTTTTTTTTTTFFTTFFFFFFTTTTTTTTTTTFTTFFTTFFFFFFTTTTTTTFFFFFFT"; let table = "";
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const work = [inputs[i], inputs[j]], result = ordered(work); const same = Object.is(result[0], inputs[i]) && Object.is(result[1], inputs[j]); table += same ? "T" : "F";
  const wanted = expectedTable[i * inputs.length + j] === "T" ? [inputs[i], inputs[j]] : [inputs[j], inputs[i]]; assert.compareArray(result, wanted); assert.sameValue(Object.is(result, work), false);
  assert.compareArray(work, [inputs[i], inputs[j]]);
}
assert.sameValue(table, expectedTable); assert.sameValue(table.length, inputs.length * inputs.length);
hookLog.length = 0; const original = inputs.slice(), work = inputs.slice(), result = ordered(work);
assert.sameValue(Object.is(result, work), false); assert.sameValue(result.length, inputs.length);
const order: number[] = [6, 21, 0, 1, 7, 8, 4, 5, 9, 22, 17, 19, 18, 20, 23, 3, 2, 14, 15, 16, 11, 12, 10, 13];
for (let i = 0; i < order.length; i++) { assert.sameValue(result[i], inputs[order[i]]); assert.sameValue(typeof result[i].value, typeof inputs[order[i]].value); }
assert.compareArray(inputs, original);
assert.compareArray(work, original);
assert.compareArray(hookLog, []);
