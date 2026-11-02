/*---
description: A matcher selected at runtime and stored in an interface field controls instanceof.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-unions, ts-this, ts-narrowing, ts-numbers, ts-strings, ts-symbols]
---*/
// Symbol.hasInstance: A Holder field carries one of two typed instance matchers; node uses the selected predicate and binds its receiver to that matcher.
const log: unknown[] = [];
interface Candidate { code: number; }
type Direction = "positive" | "negative";
interface Matcher { direction: Direction; [Symbol.hasInstance](value: unknown): boolean; }
interface Holder { matcher: Matcher; }
function make(direction: Direction): Matcher {
  return { direction, [Symbol.hasInstance](value: unknown): boolean {
    log.push(this, this.direction, value);
    if (typeof value !== "object" || value === null || !("code" in value) || typeof value.code !== "number") return false;
    return this.direction === "positive" ? value.code > 0 : value.code < 0;
  } };
}
function accepts(holder: Holder, candidate: Candidate): boolean { return candidate instanceof holder.matcher; }
const directions: Direction[] = ["positive", "negative"], candidates: Candidate[] = [{ code: -3 }, { code: 0 }, { code: 5 }];
const choices: Matcher[] = [make("positive"), make("negative")];
for (let index = 0; index < directions.length; index++) {
  const direction = directions[index], holder: Holder = { matcher: choices[index] };
  for (const candidate of candidates) {
    log.length = 0; assert.sameValue(accepts(holder, candidate), direction === "positive" ? candidate.code > 0 : candidate.code < 0);
    assert.compareArray(log, [holder.matcher, direction, candidate]); assert.sameValue(holder.matcher, choices[index]);
  }
}
