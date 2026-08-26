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
