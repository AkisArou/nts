// String keys a table compares by their contents, where one side of each
// lookup is a string built at run time and the other an equal literal: the
// same key, and not the same string. The JVM passes a string key it can prove
// is never absent to the table unboxed (`fuse::unboxed_keys`), through a
// lookup that compares by `equals`. Its identity lookup is the one strings
// were kept out of, because it would find none of these.
//
// `countBuilt` stores under built keys and reads under literals, `countLiteral`
// the other way round, through `||`, `??` and `in`; `tally` does both through
// a `Map`. `undefinedKeys` is the control: a key that may be absent keeps its
// box, because the erasure says so, and `undefined` and the string
// "undefined" stay two keys of one `Map`. Until 4ac6f9901 the absence was
// erased as though it could not happen; the guard for that is
// tests/outcomes/a-map-key-that-may-be-absent-erased-as-a-string.

export function countBuilt(seed: number): number {
  const counts: Record<string, number> = {};
  const n = (seed | 0) & 7;
  for (let i = 0; i < 8; i++) counts["w" + i] = i + n;
  counts["w" + 3] = counts["w" + 3] + 100;
  return counts["w3"] + counts["w7"] * 10 + (counts["w9"] ?? -1000);
}

export function countLiteral(seed: number): number {
  const counts: Record<string, number> = { w0: 1, w1: 2 };
  const n = (seed | 0) & 3;
  const key = "w" + (n & 1);
  counts[key] = (counts[key] || 0) + 1;
  const missing = "w" + (n + 2);
  counts[missing] = (counts[missing] ?? 50) + 1;
  return counts.w0 * 1000 + counts.w1 * 100 + (("w" + n) in counts ? 10 : 0) + counts["w" + (n + 2)];
}

export function tally(seed: number): number {
  const seen = new Map<string, number>();
  const n = ((seed | 0) & 15) + 1;
  for (let i = 0; i < n; i++) {
    const word = "k" + (i % 3);
    seen.set(word, (seen.get(word) ?? 0) + i);
  }
  return (seen.get("k0") ?? 0) * 10000 + (seen.get("k1") ?? 0) * 100 + (seen.has("k2") ? 1 : 0);
}

export function undefinedKeys(seed: number): number {
  const keys = new Map<string | undefined, number>();
  keys.set(undefined, 1);
  keys.set("undefined", 2);
  const pick: string | undefined = (seed | 0) % 2 === 0 ? undefined : "undef" + "ined";
  keys.set(pick, (keys.get(pick) ?? 0) + 10);
  return keys.size * 1000 + (keys.get(undefined) ?? 0) * 100 + (keys.get("undefined") ?? 0);
}
