/*---
description: A generator selected from a discriminated union delegates code points and distinguishes closing while suspended from natural completion.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-narrowing, ts-strings, ts-function-types, ts-errors]
---*/
// A narrowed generator-object union carries string delegation; node preserves code points, keeps completion separate and skips the continuation on return.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
function* declared(text: string, log: unknown[]): Cursor { try { const result: unknown = yield* text; log.push("complete", result); return "natural"; } finally { log.push("finally"); } }
const expression = function* (text: string, log: unknown[]): Cursor { try { const result: unknown = yield* text; log.push("complete", result); return "natural"; } finally { log.push("finally"); } };
type Choice = { kind: "cursor"; iterator: Cursor } | { kind: "empty"; marker: string };
function select(choice: Choice): Cursor | undefined { return choice.kind === "cursor" ? choice.iterator : undefined; }
const factories: ((text: string, log: unknown[]) => Cursor)[] = [declared, expression];
const rows = [{ text: "", parts: [] }, { text: "A", parts: ["A"] }, { text: "a\ud83d\ude00\ud800z", parts: ["a", "\ud83d\ude00", "\ud800", "z"] }];
for (const make of factories) for (const row of rows) for (const finish of [false, true]) {
  const log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], iterator = select({ kind: "cursor", iterator: make(row.text, log) });
  if (iterator === undefined) throw new Error("missing cursor");
  for (const part of row.parts) check(iterator.next("ignored"), part, false, seen);
  if (finish) check(iterator.next(-0), "natural", true, seen); else check(iterator.return(NaN), NaN, true, seen);
  const expected: unknown[] = finish ? ["complete", undefined, "finally"] : row.parts.length === 0 ? [] : ["finally"];
  check(iterator.next("late"), undefined, true, seen); check(iterator.next(undefined), undefined, true, seen); assert.compareArray(log, expected);
  assert.sameValue(select({ kind: "empty", marker: "skip" }), undefined);
}
