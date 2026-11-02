/*---
description: An instance matcher held in a declared tuple receives the candidate and its own receiver.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-tuples, ts-this, ts-narrowing, ts-numbers, ts-symbols]
---*/
// Symbol.hasInstance: A Candidate and Matcher share a typed tuple; node dispatches instanceof to the matcher and keeps positive and negative candidates distinct.
const log: unknown[] = [];
interface Candidate { code: number; }
interface Matcher { wanted: number; [Symbol.hasInstance](value: unknown): boolean; }
function make(wanted: number): Matcher {
  return { wanted, [Symbol.hasInstance](value: unknown): boolean {
    log.push(this, value); return typeof value === "object" && value !== null && "code" in value && value.code === this.wanted;
  } };
}
function accepts(pair: [Candidate, Matcher]): boolean { return pair[0] instanceof pair[1]; }
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
