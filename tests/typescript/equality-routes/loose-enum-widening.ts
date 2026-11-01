/*---
description: Widened numeric and string enum members preserve every loose-equality result and default-hint hook call.
features: [ts-equality-route-loose, ts-unions, ts-conversions, ts-to-primitive, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-symbols, ts-arrays, ts-functions, ts-enum, ts-enum-string]
---*/
// Route: Numeric and string enum values widen to LooseValue alongside all other kinds; node keeps their runtime comparison meanings.
type LooseValue = number | string | bigint | boolean | null | undefined | object;
const looseLog: unknown[] = [];
const looseValueHook = { valueOf(): number { looseLog.push("valueOf", undefined, this, arguments.length); return 1; } };
const looseTextHook = { valueOf(): object { looseLog.push("valueOf", undefined, this, arguments.length); return this; }, toString(): string { looseLog.push("toString", undefined, this, arguments.length); return "0"; } };
const loosePrimitiveHook = { [Symbol.toPrimitive](hint: string): bigint { looseLog.push("toPrimitive", hint, this, arguments.length); return 1n; } };
const looseIdentity = { id: 7 }, looseOther = { id: 7 };
enum LooseNumber { Zero = 0, One = 1 } enum LooseText { One = "1", Empty = "", Zero = "0" }
function looseWiden(value: LooseNumber | LooseText): LooseValue { return value; }
const looseInputs: LooseValue[] = [-0, looseWiden(LooseNumber.Zero), NaN, Infinity, looseWiden(LooseNumber.One), looseWiden(LooseText.One), looseWiden(LooseText.Empty), looseWiden(LooseText.Zero), 0n, 1n, true, false, null, undefined, 0.5, "1.0", "1_000", 9007199254740992, 9007199254740993n, "9007199254740993", -Infinity, looseIdentity, looseIdentity, looseOther, looseValueHook, looseTextHook, loosePrimitiveHook];
let looseTable = "";
for (const a of looseInputs) for (const b of looseInputs) {
  const pair: [boolean, boolean] = [a == b, a != b];
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
