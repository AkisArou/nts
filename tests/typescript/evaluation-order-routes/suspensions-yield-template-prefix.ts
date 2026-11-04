/*---
description: "A template converts its first object before yield and converts its later object after caller mutation."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-objects, ts-tuples, ts-destructuring, ts-readonly, ts-template-literals, ts-conversions, ts-to-primitive, ts-typeof-operator]
---*/
// A readonly tuple of conversion objects carries a template with yield; node saves the first string before suspension, uses the sent number, and converts the updated last object on resumption.
const log: string[] = [];
interface TextValue { label: string; text: string; count: number; toString(): string; valueOf(): number; }
class Word implements TextValue {
  label: string; text: string; count: number = 0;
  constructor(label: string, text: string) { log.push(`new:${label}`); this.label = label; this.text = text; }
  toString(): string { log.push(`string:${this.label}:${this.text}`); this.count++; return this.text; }
  valueOf(): number { log.push(`wrong-valueOf:${this.label}`); return 0; }
}
function pause(): number { log.push("pause"); return 7; }
function* render(source: readonly [TextValue, TextValue]): Generator<number, string, number> {
  log.push("start");
  return `${source[0]}|${yield pause()}|${source[1]}`;
}
const rows: [string, number][] = [["before", 3], ["", -2], ["L", 0]];
for (const [before, sent] of rows) {
  const left = new Word("left", before);
  const right: TextValue = { label: "right", text: "old", count: 0, toString(): string { log.push(`string:${this.label}:${this.text}`); this.count++; return this.text; }, valueOf(): number { log.push(`wrong-valueOf:${this.label}`); return 0; } };
  const source: readonly [TextValue, TextValue] = [left, right]; log.length = 0; const iterator = render(source); assert.compareArray(log, []); const yielded = iterator.next();
  assert.compareArray(log, ["start", `string:left:${before}`, "pause"]); assert.sameValue(yielded.value, 7); assert.sameValue(yielded.done, false); assert.sameValue(left.count, 1); assert.sameValue(right.count, 0);
  log.push("mutate"); left.text = "changed"; right.text = "after";
  const completed = iterator.next(sent); const finished = iterator.next(999);
  assert.compareArray(log, ["start", `string:left:${before}`, "pause", "mutate", "string:right:after"]);
  assert.sameValue(completed.value, `${before}|${sent}|after`); assert.sameValue(typeof completed.value, "string"); assert.sameValue(completed.done, true);
  assert.sameValue(left.count, 1); assert.sameValue(right.count, 1); assert.sameValue(left.text, "changed"); assert.sameValue(right.text, "after");
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
