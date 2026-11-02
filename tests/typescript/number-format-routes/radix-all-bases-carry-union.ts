/*---
description: "A discriminated field union observes radix-squared carries in every valid base."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-type-aliases, ts-objects, ts-unions, ts-narrowing, ts-discriminated-unions, ts-literal-types, ts-conversions]
---*/
// A direct-or-nested numeric field logs its branch and radix; Node carries the last two digits to "100" and then "101", preserving negative signs.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type FormatInput = { kind: "direct"; value: number } | { kind: "nested"; field: { value: number } };
const expected: string[][] = [
  ["11","100","101","-11","-100","-101"], ["22","100","101","-22","-100","-101"],
  ["33","100","101","-33","-100","-101"], ["44","100","101","-44","-100","-101"],
  ["55","100","101","-55","-100","-101"], ["66","100","101","-66","-100","-101"],
  ["77","100","101","-77","-100","-101"], ["88","100","101","-88","-100","-101"],
  ["99","100","101","-99","-100","-101"], ["aa","100","101","-aa","-100","-101"],
  ["bb","100","101","-bb","-100","-101"], ["cc","100","101","-cc","-100","-101"],
  ["dd","100","101","-dd","-100","-101"], ["ee","100","101","-ee","-100","-101"],
  ["ff","100","101","-ff","-100","-101"], ["gg","100","101","-gg","-100","-101"],
  ["hh","100","101","-hh","-100","-101"], ["ii","100","101","-ii","-100","-101"],
  ["jj","100","101","-jj","-100","-101"], ["kk","100","101","-kk","-100","-101"],
  ["ll","100","101","-ll","-100","-101"], ["mm","100","101","-mm","-100","-101"],
  ["nn","100","101","-nn","-100","-101"], ["oo","100","101","-oo","-100","-101"],
  ["pp","100","101","-pp","-100","-101"], ["qq","100","101","-qq","-100","-101"],
  ["rr","100","101","-rr","-100","-101"], ["ss","100","101","-ss","-100","-101"],
  ["tt","100","101","-tt","-100","-101"], ["uu","100","101","-uu","-100","-101"],
  ["vv","100","101","-vv","-100","-101"], ["ww","100","101","-ww","-100","-101"],
  ["xx","100","101","-xx","-100","-101"], ["yy","100","101","-yy","-100","-101"],
  ["zz","100","101","-zz","-100","-101"],
];
function route(source: FormatInput, radix: number, basePosition: number, position: number, input: number, log: unknown[]): string {
  let observed: number;
  if (source.kind === "direct") { observed = source.value; log.push("direct", observed); }
  else { observed = source.field.value; log.push("nested", observed); }
  same(observed, input); same(radix, basePosition + 2); log.push("radix", radix);
  const text: string = observed.toString(radix); log.push("text", text); return text;
}
let basePosition = 0;
for (const row of expected) {
  const radix = basePosition + 2, square = radix * radix, inputs: number[] = [square - 1, square, square + 1, 1 - square, -square, -square - 1]; let position = 0;
  for (const input of inputs) {
    const direct = position < 3, source: FormatInput = direct ? { kind: "direct", value: input } : { kind: "nested", field: { value: input } }, log: unknown[] = [];
    const text = route(source, radix, basePosition, position, input, log); same(text, row[position]);
    exact(log, [source.kind, input, "radix", radix, "text", row[position]]); position++;
  }
  same(position, 6); basePosition++;
}
same(basePosition, 35);
