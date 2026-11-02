/*---
description: Plain string-hook record control for A matcher selected at runtime and stored in an interface field controls instanceof.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-unions, ts-function-types, ts-narrowing, ts-numbers, ts-strings, ts-record]
---*/
// String hook record: A Holder field carries one of two typed instance matchers; node uses the selected predicate and binds its receiver to that matcher.
const hookKey = "hook:instance", log: unknown[] = [];
interface Candidate { code: number; }
type Direction = "positive" | "negative";
interface Matcher { direction: Direction; keys: string[]; hooks: Record<string, (self: Matcher, value: unknown) => boolean>; }
interface Holder { matcher: Matcher; }
function make(direction: Direction): Matcher {
  return { direction, keys: [hookKey], hooks: { [hookKey]: (self, value) => {
    log.push(self, self.direction, value);
    if (typeof value !== "object" || value === null || !("code" in value) || typeof value.code !== "number") return false;
    return self.direction === "positive" ? value.code > 0 : value.code < 0;
  } } };
}
function accepts(holder: Holder, candidate: Candidate): boolean {
  const target = holder.matcher; if (!target.keys.includes(hookKey)) throw new TypeError("matcher");
  return target.hooks[hookKey](target, candidate);
}
const directions: Direction[] = ["positive", "negative"], candidates: Candidate[] = [{ code: -3 }, { code: 0 }, { code: 5 }];
const choices: Matcher[] = [make("positive"), make("negative")];
for (let index = 0; index < directions.length; index++) {
  const direction = directions[index], holder: Holder = { matcher: choices[index] };
  for (const candidate of candidates) {
    log.length = 0; assert.sameValue(accepts(holder, candidate), direction === "positive" ? candidate.code > 0 : candidate.code < 0);
    assert.compareArray(log, [holder.matcher, direction, candidate]); assert.sameValue(holder.matcher, choices[index]);
  }
}
