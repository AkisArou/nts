// A string record's entry asked whether it is truthy, answered from the entry
// the lookup found rather than from a box built for the test: `||`, `!`, an
// `if` and a conditional, over the stored number the seed is -- NaN, both
// zeroes and the infinities among them -- a stored boolean, and a missing key.
//
// `passed` hands the read on erased, into a `number | string`, so its lookup
// keeps the box: the control.

function record(seed: number): Record<string, number> {
  const rec: Record<string, number> = {};
  rec.seed = seed;
  return rec;
}

/** `||`: the stored number where it is truthy, the default where it is not or is missing. */
export function either(seed: number): number {
  const rec = record(seed);
  return (rec.seed || 100) + (rec["absent"] || 1000) * 2;
}

/** `!`, an `if` and a conditional's test, as bits. */
export function tested(seed: number): number {
  const rec = record(seed);
  let bits = 0;
  if (!rec.seed) bits |= 1;
  if (rec.seed) bits |= 2;
  bits |= rec["seed"] ? 4 : 8;
  if (!rec.absent) bits |= 16;
  bits |= rec["absent"] ? 32 : 64;
  return bits;
}

/** The counting idiom, one key the seed's own text. */
export function counted(seed: number): number {
  const counts: Record<string, number> = {};
  const words = ["a", "b", String(seed)];
  for (let i = 0; i < 7; i++) {
    const w = words[i % 3];
    counts[w] = (counts[w] || 0) + 1;
  }
  return (counts.a ?? 0) * 100 + (counts["b"] ?? 0) * 10 + (counts[String(seed)] ?? 0);
}

/** A record of booleans: a stored `false` and a missing key are both falsy. */
export function seen(seed: number): number {
  const marks: Record<string, boolean> = {};
  marks.off = false;
  marks.on = seed > 0;
  let bits = 0;
  if (!marks.off) bits |= 1;
  if (marks.on) bits |= 2;
  if (!marks.missing) bits |= 4;
  return bits;
}

/** The control: the read handed on erased keeps its box. */
export function passed(seed: number): string {
  const rec = record(seed);
  const read = rec.seed || "none";
  return typeof read + ":" + String(read);
}
