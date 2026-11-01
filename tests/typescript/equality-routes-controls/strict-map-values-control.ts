/*---
description: Control for strict-map-values; explicit kind records preserve the same complete comparison tables and empty conversion log.
features: [ts-equality-route-strict, ts-unions, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-expressions, ts-to-primitive, ts-map-set]
---*/
// Control: explicit kind records select same-kind comparisons; every input, table and hook-log assertion stays the same.
const hookLog: unknown[] = [];
const identity = { id: 1 }, twin = { id: 1 };
const numericHook: { id: number; valueOf(): number } = { id: 2, valueOf() { hookLog.push("valueOf", "none", this); return 1; } };
const textHook: { id: number; toString(): string } = { id: 3, toString() { hookLog.push("toString", "none", this); return "1"; } };
const primitiveHook: { id: number; [Symbol.toPrimitive](hint: string): number | string } = { id: 4, [Symbol.toPrimitive](hint) { hookLog.push("toPrimitive", hint, this); return hint === "string" ? "1" : 1; } };
type EqRecord = { kind: "number"; value: number } | { kind: "string"; value: string } | { kind: "bigint"; value: bigint } | { kind: "boolean"; value: boolean } | { kind: "null"; value: null } | { kind: "undefined"; value: undefined } | { kind: "object"; value: object };
const inputs: EqRecord[] = [{ kind: "number", value: -0 }, { kind: "number", value: 0 }, { kind: "number", value: NaN }, { kind: "number", value: Infinity }, { kind: "number", value: 1 }, { kind: "string", value: "1" }, { kind: "string", value: "" }, { kind: "string", value: "0" }, { kind: "bigint", value: 0n }, { kind: "bigint", value: 1n }, { kind: "boolean", value: true }, { kind: "boolean", value: false }, { kind: "null", value: null }, { kind: "undefined", value: undefined }, { kind: "object", value: identity }, { kind: "object", value: identity }, { kind: "object", value: twin }, { kind: "object", value: numericHook }, { kind: "object", value: textHook }, { kind: "object", value: primitiveHook }, { kind: "number", value: 1.5 }, { kind: "number", value: 2147483648 }, { kind: "number", value: -2147483648 }, { kind: "number", value: 9007199254740992 }, { kind: "bigint", value: 9007199254740993n }, { kind: "number", value: -Infinity }];
function equal(left: EqRecord, right: EqRecord, sameValue: boolean): boolean {
  switch (left.kind) {
    case "number": return right.kind === "number" && (sameValue ? Object.is(left.value, right.value) : left.value === right.value);
    case "string": return right.kind === "string" && left.value === right.value;
    case "bigint": return right.kind === "bigint" && left.value === right.value;
    case "boolean": return right.kind === "boolean" && left.value === right.value;
    case "null": return right.kind === "null" && left.value === right.value;
    case "undefined": return right.kind === "undefined" && left.value === right.value;
    case "object": return right.kind === "object" && left.value === right.value;
  }
}
function comparisons(left: EqRecord, right: EqRecord): boolean[] { return [equal(left, right, false), !equal(left, right, false), equal(left, right, true), equal(left, right, false)]; }
const stored: { key: number; value: EqRecord }[] = []; for (let i = 0; i < inputs.length; i++) stored.push({ key: i, value: inputs[i] });
function readStored(key: number): EqRecord { for (const entry of stored) if (entry.key === key) return entry.value; throw new Error("missing numeric key"); }
assert.sameValue(stored.length, inputs.length);
const tables: string[] = ["", "", "", ""];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const answers = comparisons(readStored(i), readStored(j));
  assert.sameValue(answers.length, 4); for (let at = 0; at < answers.length; at++) { assert.sameValue(typeof answers[at], "boolean"); tables[at] += answers[at] ? "T" : "F"; }
}
const expected: string[] = [
  "TTFFFFFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFT",
  "FFTTTTTTTTTTTTTTTTTTTTTTTTFFTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFFTTTTTTTTTTTTTTTTTTTTTTTTFFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTF",
  "TFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFT",
  "TTFFFFFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFFFFFFFT",
];
assert.compareArray(tables, expected); assert.compareArray(hookLog, []);
for (const table of tables) assert.sameValue(table.length, inputs.length * inputs.length);
