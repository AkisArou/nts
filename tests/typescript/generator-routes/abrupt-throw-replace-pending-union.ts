/*---
description: A narrowed generator catches a second throw in its finally, yields recovery, then replaces the original pending error with that caught error.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-narrowing, ts-interfaces, ts-function-types]
---*/
// A union narrows to a generator cursor; node catches the cleanup injection, yields again, then exposes the replacement error by identity.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (value: Value, log: unknown[]) => Cursor;
function* declared(value: Value, log: unknown[]): Generator<Value, Value, Value> { try { log.push("body", value); yield value; return "natural"; } finally { log.push("cleanup"); try { yield "cleanup"; } catch (error) { log.push("cleanup:catch", error); const sent: Value = yield "caught"; log.push("cleanup:sent", sent); throw error; } } }
const expression = function* (value: Value, log: unknown[]): Generator<Value, Value, Value> { try { log.push("body", value); yield value; return "natural"; } finally { log.push("cleanup"); try { yield "cleanup"; } catch (error) { log.push("cleanup:catch", error); const sent: Value = yield "caught"; log.push("cleanup:sent", sent); throw error; } } };
const makers: Factory[] = [declared, expression];
type Choice = { kind: "ready"; cursor: Cursor } | { kind: "empty"; label: string };
const identity = { id: 67 }, first = new RangeError("first"), second = new TypeError("second"), inputs: Value[] = [-0, NaN, undefined, identity];
for (const make of makers) for (const value of inputs) {
  const log: unknown[] = [], seen: Step[] = [], choices: Choice[] = [{ kind: "empty", label: "skip" }, { kind: "ready", cursor: make(value, log) }];
  for (const choice of choices) if (choice.kind === "ready") {
    check(choice.cursor.next(), value, false, seen); check(choice.cursor.throw(first), "cleanup", false, seen); check(choice.cursor.throw(second), "caught", false, seen);
    let caught: unknown = undefined; assert.throws(TypeError, () => { try { choice.cursor.next(identity); } catch (error) { caught = error; throw error; } });
    assert.sameValue(caught, second); check(choice.cursor.next(), undefined, true, seen);
    assert.compareArray(log, ["body", value, "cleanup", "cleanup:catch", second, "cleanup:sent", identity]);
  }
}
