/*---
description: Plain string-hook record control for An instance matcher held in a declared tuple receives the candidate and its own receiver.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-tuples, ts-function-types, ts-narrowing, ts-numbers, ts-record]
---*/
// String hook record: A Candidate and Matcher share a typed tuple; node dispatches instanceof to the matcher and keeps positive and negative candidates distinct.
const hookKey = "hook:instance", log: unknown[] = [];
interface Candidate { code: number; }
interface Matcher { wanted: number; keys: string[]; hooks: Record<string, (self: Matcher, value: unknown) => boolean>; }
function make(wanted: number): Matcher {
  return { wanted, keys: [hookKey], hooks: { [hookKey]: (self, value) => {
    log.push(self, value); return typeof value === "object" && value !== null && "code" in value && value.code === self.wanted;
  } } };
}
function accepts(pair: [Candidate, Matcher]): boolean {
  const target = pair[1]; if (!target.keys.includes(hookKey)) throw new TypeError("matcher");
  return target.hooks[hookKey](target, pair[0]);
}
for (const wanted of [-1, 0, 7]) {
  const matcher = make(wanted), candidates: Candidate[] = [{ code: wanted }, { code: wanted + 1 }];
  for (const candidate of candidates) {
    log.length = 0; const pair: [Candidate, Matcher] = [candidate, matcher];
    assert.sameValue(accepts(pair), candidate.code === wanted);
    assert.compareArray(log, [matcher, candidate]); assert.sameValue(matcher.wanted, wanted);
    matcher.wanted = wanted + 1;
    assert.sameValue(accepts(pair), candidate.code === wanted + 1);
    assert.compareArray(log, [matcher, candidate, matcher, candidate]); matcher.wanted = wanted;
  }
}
