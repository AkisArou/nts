import type { TimeZoneRules } from "../../../../../runtime/ecmascript/src/time/provider.ts";

function checkEpoch(raw: TimeZoneRules, cached: TimeZoneRules, time: number): void {
  if (raw.offsetMilliseconds(time) !== cached.offsetMilliseconds(time))
    throw new Error(raw.id + ": cached epoch offset differs at " + time);
}

function checkLocal(raw: TimeZoneRules, cached: TimeZoneRules, time: number): void {
  if (
    raw.localOffsetMilliseconds(time, true) !== cached.localOffsetMilliseconds(time, true) ||
    raw.localOffsetMilliseconds(time, false) !== cached.localOffsetMilliseconds(time, false)
  )
    throw new Error(raw.id + ": cached local offset differs at " + time);
}

// An ABI/cache differential, rather than another JS conformance corpus. Walk
// every public ICU transition from 1800 through 2099 and compare both local
// interpretations at each edge. Nonsequential lookups exercise cache eviction.
export function timeZoneCacheAudit(raw: TimeZoneRules, cached: TimeZoneRules): number {
  const start = -5364662400000;
  const stop = 4102444800000;
  let comparisons = 0;
  for (const time of [0, -1, 1, -8640000000000000, 8640000000000000, start, stop]) {
    checkEpoch(raw, cached, time);
    checkLocal(raw, cached, time);
    comparisons += 3;
  }
  let time = start;
  while (true) {
    const next = raw.transition(time, true);
    if (next === null || next >= stop) break;
    if (next <= time) throw new Error("Time-zone transition search did not advance");
    const before = raw.offsetMilliseconds(next - 1);
    const after = raw.offsetMilliseconds(next);
    for (const delta of [0, -1, 1, -86400000, 86400000]) checkEpoch(raw, cached, next + delta);
    const low = next + Math.min(before, after);
    const high = next + Math.max(before, after);
    for (const wall of [
      low - 1,
      low,
      low + 1,
      Math.floor((low + high) / 2),
      high - 1,
      high,
      high + 1,
    ])
      checkLocal(raw, cached, wall);
    checkEpoch(raw, cached, start);
    checkEpoch(raw, cached, stop);
    checkLocal(raw, cached, low);
    checkLocal(raw, cached, high);
    checkEpoch(raw, cached, next - 1);
    checkEpoch(raw, cached, next);
    comparisons += 27;
    time = next;
  }
  return comparisons;
}
