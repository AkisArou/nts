// `Math.floor` is a proof of wholeness the way `| 0` is a proof of int32-ness,
// and a stronger one: it keeps the magnitude instead of wrapping it. But it
// only proves wholeness where the value is *bounded* -- `Math.floor(Infinity)`
// is `Infinity`, which is not an integer.

// Bounded first, so the proof lands. `hash | 0` gives int32, `Math.abs` makes
// it non-negative, dividing by a constant shrinks it, and `Math.floor` makes it
// whole again: [0, 32768], provably an integer.
export function shard(hash: number): number {
  const bounded = Math.abs(hash | 0);
  return Math.floor(bounded / 65536);
}

export function clampIndex(i: number, limit: 1000): number {
  return Math.max(0, Math.min(Math.trunc(i), limit));
}

// Unbounded, so nothing is provable however the author wrote it -- and the
// compiler says so by leaving these alone.
export function rounded(x: number): number {
  return Math.round(x);
}

export function distance(a: number, b: number): number {
  return Math.abs(a - b);
}

/** Moved here from `mathops-unsupported` on 2026-09-17, which is what its
 *  header asks for: `Math.max` and `Math.min` take any number of arguments now,
 *  by folding pairwise. Each step selects one of its operands, so the fold is
 *  exact -- unlike `Math.hypot`, whose refusal states the same distinction from
 *  the other side. */
export function widest(a: number, b: number, c: number): number {
  return Math.max(a, b, c);
}

export function narrowest(a: number, b: number, c: number): number {
  return Math.min(a, b, c, 2);
}

/** Also moved from `mathops-unsupported` on 2026-09-17, where they had been
 *  listed as unimplemented while being implemented. Nothing had run them
 *  against node, which is the difference between "it lowers" and "it agrees". */
export function hyperbolic(x: number): number {
  return Math.sinh(x);
}

export function root(x: number): number {
  return Math.sqrt(x);
}
