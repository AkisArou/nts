/*---
description: Control for loose-union-return; explicit kind records and logged primitive calls reproduce every answer and conversion.
features: [ts-equality-route-loose, ts-unions, ts-conversions, ts-to-primitive, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-symbols, ts-arrays, ts-functions]
---*/
// Control: kind branches compare concrete payloads; explicit hooks replace coercion and preserve receiver, hint and argument count.
type LooseRecord = { kind: "number"; value: number } | { kind: "string"; value: string } | { kind: "bigint"; value: bigint } | { kind: "boolean"; value: boolean } | { kind: "null"; value: null } | { kind: "undefined"; value: undefined } | { kind: "object"; value: object; primitive: () => LooseRecord };
const looseLog: unknown[] = [];
const looseValueHook = { valueOf(): number { looseLog.push("valueOf", undefined, this, arguments.length); return 1; } };
const looseTextHook = { valueOf(): object { looseLog.push("valueOf", undefined, this, arguments.length); return this; }, toString(): string { looseLog.push("toString", undefined, this, arguments.length); return "0"; } };
const loosePrimitiveHook = { [Symbol.toPrimitive](hint: string): bigint { looseLog.push("toPrimitive", hint, this, arguments.length); return 1n; } };
const looseIdentity = { id: 7 }, looseOther = { id: 7 };
function looseReturn(value: LooseRecord): LooseRecord { return value; }
const looseInputs: LooseRecord[] = [{ kind: "number", value: -0 }, { kind: "number", value: 0 }, { kind: "number", value: NaN }, { kind: "number", value: Infinity }, { kind: "number", value: 1 }, { kind: "string", value: "1" }, { kind: "string", value: "" }, { kind: "string", value: "0" }, { kind: "bigint", value: 0n }, { kind: "bigint", value: 1n }, { kind: "boolean", value: true }, { kind: "boolean", value: false }, { kind: "null", value: null }, { kind: "undefined", value: undefined }, { kind: "number", value: 0.5 }, { kind: "string", value: "1.0" }, { kind: "string", value: "1_000" }, { kind: "number", value: 9007199254740992 }, { kind: "bigint", value: 9007199254740993n }, { kind: "string", value: "9007199254740993" }, { kind: "number", value: -Infinity }, { kind: "object", value: looseIdentity, primitive: () => { looseIdentity.valueOf(); return { kind: "string", value: looseIdentity.toString() }; } }, { kind: "object", value: looseIdentity, primitive: () => { looseIdentity.valueOf(); return { kind: "string", value: looseIdentity.toString() }; } }, { kind: "object", value: looseOther, primitive: () => { looseOther.valueOf(); return { kind: "string", value: looseOther.toString() }; } }, { kind: "object", value: looseValueHook, primitive: () => ({ kind: "number", value: looseValueHook.valueOf() }) }, { kind: "object", value: looseTextHook, primitive: () => { looseTextHook.valueOf(); return { kind: "string", value: looseTextHook.toString() }; } }, { kind: "object", value: loosePrimitiveHook, primitive: () => ({ kind: "bigint", value: loosePrimitiveHook[Symbol.toPrimitive]("default") }) }];
function looseEqual(a: LooseRecord, b: LooseRecord): boolean {
  if (a.kind === "number" && b.kind === "number") return a.value === b.value; if (a.kind === "string" && b.kind === "string") return a.value === b.value;
  if (a.kind === "bigint" && b.kind === "bigint") return a.value === b.value; if (a.kind === "boolean" && b.kind === "boolean") return a.value === b.value;
  if (a.kind === "object" && b.kind === "object") return a.value === b.value;
  if ((a.kind === "null" || a.kind === "undefined") && (b.kind === "null" || b.kind === "undefined")) return true;
  if (a.kind === "boolean") return looseEqual({ kind: "number", value: Number(a.value) }, b); if (b.kind === "boolean") return looseEqual(a, { kind: "number", value: Number(b.value) });
  if (a.kind === "number" && b.kind === "string") return a.value === Number(b.value); if (a.kind === "string" && b.kind === "number") return Number(a.value) === b.value;
  if (a.kind === "bigint" && b.kind === "string") { try { return a.value === BigInt(b.value); } catch (error) { if (error instanceof SyntaxError) return false; throw error; } }
  if (a.kind === "string" && b.kind === "bigint") return looseEqual(b, a);
  if (a.kind === "bigint" && b.kind === "number") return Number.isFinite(b.value) && Number.isInteger(b.value) && a.value === BigInt(b.value);
  if (a.kind === "number" && b.kind === "bigint") return looseEqual(b, a);
  if (a.kind === "object" && (b.kind === "number" || b.kind === "string" || b.kind === "bigint")) return looseEqual(a.primitive(), b);
  if (b.kind === "object" && (a.kind === "number" || a.kind === "string" || a.kind === "bigint")) return looseEqual(a, b.primitive());
  return false;
}
let looseTable = "";
for (const a of looseInputs) for (const b of looseInputs) {
  const pair: [boolean, boolean] = [looseEqual(looseReturn(a), looseReturn(b)), !looseEqual(looseReturn(a), looseReturn(b))];
  assert.sameValue(typeof pair[0], "boolean"); assert.sameValue(typeof pair[1], "boolean");
  looseTable += (pair[0] ? "T" : "F") + (pair[1] ? "T" : "F");
}
assert.sameValue(looseTable, "TFTFFTFTFTFTTFTFTFFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTTFTFFTFTFTFTTFTFTFFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFTFFTFTFTTFTFFTFTFTFTTFFTFTFTFTFTFTFTFTTFFTTFFTFTFTFTTFTFFTFTFTTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTTFTFTFFTFTFTFTTFFTTFFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFTFFTFTFTFTFTTFTFFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTTFTFFTFTFTFTTFTFTFFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTTFTFFTFTFTTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTTFFTFTFTFTTFTFFTFTFTTFTFFTFTFTFTTFFTFTFTFTFTFTFTFTTFFTTFTFTFFTFTFTFTTFTFTFFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTTFFTFTFTFTTFFTFTFTFTFTFTFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTFTFTTFTFFTFTFTTFTFFTFTFTFTTFFTFTFTFTFTFTFTFTTFFTFTTFTFFTFTFTFTFTTFTFFTFTTFFTFTFTFTFTFTFTFTFTFTFTFTFTTFFTFTFTFTFTTFTFFTFTFTTFTFFTFTFTFTFTFTFTFTFTFTFTFTFTFTFTTF");
const looseExpected: unknown[] = [];
for (const code of "vvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvftftppvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftftpppppppppppppppppppppppppppppppppppppp") {
  if (code === "v") looseExpected.push("valueOf", undefined, looseValueHook, 0); if (code === "f") looseExpected.push("valueOf", undefined, looseTextHook, 0);
  if (code === "t") looseExpected.push("toString", undefined, looseTextHook, 0); if (code === "p") looseExpected.push("toPrimitive", "default", loosePrimitiveHook, 1);
}
assert.compareArray(looseLog, looseExpected); assert.sameValue(looseLog.length, 1216);
