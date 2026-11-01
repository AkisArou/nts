/*---
description: Control for generator-yield-string-codepoints; the same protocol steps are explicit.
features: [ts-iterator-route-generators, ts-iteration, ts-generators, ts-interfaces, ts-unions, ts-arrays, ts-strings]
---*/
// Control: explicit protocol calls keep the same values, arguments, event order and final state.
interface StringSource { text: string; }
interface CompletionState { value: unknown; finished: number; }
const rows: { text: string; parts: string[] }[] = [
  { text: "", parts: [] }, { text: "A", parts: ["A"] }, { text: "\ud83d\ude00", parts: ["\ud83d\ude00"] },
  { text: "\ud800", parts: ["\ud800"] }, { text: "\udfff", parts: ["\udfff"] },
  { text: "a\u00e9\ud83d\ude00\ud800\u4e2d\udfff", parts: ["a", "\u00e9", "\ud83d\ude00", "\ud800", "\u4e2d", "\udfff"] }
];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function* expand(holder: StringSource, state: CompletionState, log: unknown[]): Generator<string, undefined, string> {
  const iterator = holder.text[Symbol.iterator](); let step = iterator.next(undefined);
  while (!step.done) { const sent: string = yield step.value; step = iterator.next(sent); }
  const completion: undefined = step.value; state.value = completion; state.finished++; log.push("complete", completion); return completion;
}
for (const row of rows) {
  const holder: StringSource = { text: row.text }, state: CompletionState = { value: "unset", finished: 0 }, log: unknown[] = [];
  const iterator = expand(holder, state, log); log.push("next", "ignored"); let step = iterator.next("ignored");
  const out: string[] = [];
  while (!step.done) { out.push(step.value); log.push("take", step.value); log.push("next", "sent"); step = iterator.next("sent"); }
  log.push("done", step.value); const expected: unknown[] = ["next", "ignored"];
  for (const value of row.parts) expected.push("take", value, "next", "sent");
  expected.push("complete", undefined, "done", undefined);
  assert.compareArray(log, expected); assert.compareArray(out, row.parts); same(step.value, undefined); same(state.value, undefined);
  assert.sameValue(state.finished, 1); assert.sameValue(holder.text, row.text); assert.sameValue(holder.text.length, row.text.length);
}
