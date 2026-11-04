/*---
description: "Control: Ordered chained-add retains the conversion before the next substitution read."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-interfaces, ts-class, ts-class-fields, ts-override, ts-accessors, ts-functions, ts-tuples, ts-arrays, ts-iteration, ts-objects, ts-unions, ts-unknown, ts-conversions, ts-to-primitive, ts-symbols, ts-strings]
---*/
// Left-associated string + through interface accessors; node interleaves each read and conversion, including fallback and custom hints.
const log: string[] = [];
let phase = 0;
interface TextValue { valueOf(): unknown; toString(): string; }
interface Source { readonly left: TextValue | string; readonly right: TextValue | string; }
class Ordinary implements TextValue {
  label: string;
  constructor(label: string) { log.push("new:" + label); this.label = label; }
  valueOf(): unknown { log.push("valueOf:" + this.label + ":" + phase); return ++phase; }
  toString(): string { log.push("toString:" + this.label + ":" + phase); return this.label + ++phase; }
}
class Fallback extends Ordinary {
  override valueOf(): unknown { log.push("fallback:" + this.label + ":" + phase); return this; }
}
class Exotic extends Ordinary {
  [Symbol.toPrimitive](hint: string): string { log.push("primitive:" + this.label + ":" + hint + ":" + phase); return this.label + ++phase; }
}
function render(source: Source): string {
  log.push("render");
  const left = source.left;
  const prefix = "" + left;
  const right = source.right;
  return prefix + right;
}
const rows: [TextValue | string, TextValue | string, string, string[]][] = [
  [new Ordinary("L"), new Ordinary("R"), "12", ["get:left", "valueOf:L:0", "get:right", "valueOf:R:1"]],
  [new Fallback("L"), new Fallback("R"), "L1R2", ["get:left", "fallback:L:0", "toString:L:0", "get:right", "fallback:R:1", "toString:R:1"]],
  [new Exotic("L"), new Exotic("R"), "L1R2", ["get:left", "primitive:L:default:0", "get:right", "primitive:R:default:1"]],
  ["L", "R", "LR", ["get:left", "get:right"]]
];
for (const row of rows) {
  const source: Source = {
    get left(): TextValue | string { log.push("get:left"); return row[0]; },
    get right(): TextValue | string { log.push("get:right"); return row[1]; }
  };
  log.length = 0; phase = 0;
  const result = render(source);
  assert.compareArray(log, ["render", ...row[3]]);
  assert.sameValue(result, row[2]);
  assert.sameValue(phase, typeof row[0] === "string" ? 0 : 2);
}
