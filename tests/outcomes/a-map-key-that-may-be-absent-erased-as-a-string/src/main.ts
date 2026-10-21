// run: check
//
// A `Map` whose key may be absent: `string | undefined` and `string | null`,
// each holding the absence and the string that spells it as two keys.
// Lowering types the key `managed<str>`, holds the absence as a null string,
// and erases it with `absent: Impossible` -- the erasure says a key that may
// be undefined or null cannot be absent. C tags the null pointer `STRING`, and
// hashing it is a segmentation fault (signal 11), on every case. The JVM agrees
// because its `ofString(null)` is `NULL_VALUE` whatever the erasure claims,
// which for `string | undefined` stores `undefined` as `null` and is right only
// while nothing else is a `null` key. A `string | null | undefined` key lowers
// another way and agrees everywhere.
//
// Found by the JVM's string-key fusion (codegen/jvm `fuse::unboxed_keys`),
// which trusts the erasure's `absent` and passed these keys to the string
// lookup; it answers as the boxed path does, so it adds no wrong answer.
//
// The one-change control, `...-control`, types the keys `string` and spells
// each absence as a string of its own, and agrees.

export function undefinedKeys(seed: number): number {
  const keys = new Map<string | undefined, number>();
  keys.set(undefined, 1);
  keys.set("undefined", 2);
  const pick: string | undefined = (seed | 0) % 2 === 0 ? undefined : "undef" + "ined";
  keys.set(pick, (keys.get(pick) ?? 0) + 10);
  return keys.size * 1000 + (keys.get(undefined) ?? 0) * 100 + (keys.get("undefined") ?? 0);
}

export function nullKeys(seed: number): number {
  const keys = new Map<string | null, number>();
  keys.set(null, 1);
  keys.set("null", 2);
  const pick: string | null = (seed | 0) % 2 === 0 ? null : "nu" + "ll";
  keys.set(pick, (keys.get(pick) ?? 0) + 10);
  return keys.size * 1000 + (keys.get(null) ?? 0) * 100 + (keys.get("null") ?? 0);
}
