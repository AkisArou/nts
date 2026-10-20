// A string record's missing key, asked whether it is there.
//
// Without `noUncheckedIndexedAccess` the checker types `rec[k]` as the
// record's value type, `number` here, and a missing key reads `undefined` all
// the same. Each consumer below asks only whether the entry is there, so the
// read reaches it as the erased value `nts_map_get` answers and the consumer
// answers from its tag. Before, the read was unerased to a number first: a
// missing key read as 0 on C, LLVM and the JVM, so `?? 1000` gave 0,
// `=== undefined` folded to `false` and `typeof` said "number", while Wasm
// stopped by name. `(counts[w] || 0) + 1` agreed by luck, 0 being falsy too.
//
// The other uses of a missing entry -- arithmetic, a store, an argument --
// stop by name: tests/outcomes/a-missing-record-key-read-as-a-number.
//
// The control, present-record-keys-asked-whether-present, sets every key
// these read.
const words = ["a", "b", "a", "c", "a", "b"];

function record(seed: number): Record<string, number> {
  const rec: Record<string, number> = {};
  if ((seed & 1) === 1) rec.one = seed;
  if ((seed & 2) === 2) rec.two = 0;
  return rec;
}

/** `||` and `??`: the default where the key is missing. */
export function defaults(seed: number): number {
  const rec = record(seed);
  return (rec.one || 100) + (rec["two"] ?? 1000) * 2;
}

/** The counting idiom. */
export function counted(seed: number): number {
  const counts: Record<string, number> = {};
  for (let i = 0; i < (seed & 7); i++) {
    const w = words[i % words.length];
    counts[w] = (counts[w] || 0) + 1;
  }
  return (counts.a ?? 0) * 100 + (counts["b"] ?? 0) * 10 + (counts.c ?? 0);
}

/** `=== undefined`, `!== undefined` and `== null`, either way round. */
export function compared(seed: number): number {
  const rec = record(seed);
  let bits = 0;
  if (rec.one === undefined) bits |= 1;
  if (rec["two"] !== undefined) bits |= 2;
  if (rec.three == null) bits |= 4;
  if (undefined === rec.one) bits |= 8;
  return bits;
}

/** `typeof`. */
export function typed(seed: number): string {
  const rec = record(seed);
  return typeof rec.one + " " + typeof rec["two"];
}

/** Truthiness: `!`, an `if` and a conditional's test. */
export function truthy(seed: number): number {
  const rec = record(seed);
  let bits = 0;
  if (!rec.one) bits |= 1;
  if (rec.two) bits |= 2;
  bits |= rec["one"] ? 4 : 8;
  return bits;
}

/** `??=` and `||=` write the default where the key is missing. */
export function assigned(seed: number): number {
  const rec = record(seed);
  rec.one ??= 7;
  rec.two ||= 9;
  return rec.one * 10 + rec.two;
}

/** A record of booleans, as a seen-set. */
export function seen(seed: number): number {
  const marks: Record<string, boolean> = {};
  let fresh = 0;
  for (let i = 0; i < (seed & 7); i++) {
    const w = words[i % words.length];
    if (!marks[w]) {
      marks[w] = true;
      fresh = fresh + 1;
    }
  }
  return fresh;
}

interface Scores {
  [player: string]: number;
}

/** An interface's string index signature reads as a record does. */
export function scored(seed: number): number {
  const scores: Scores = {};
  if ((seed & 1) === 1) scores.ann = 3;
  return (scores["ann"] ?? -1) + (scores.bo === undefined ? 10 : 20);
}
