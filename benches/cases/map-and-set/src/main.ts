// A hash table: open addressing, linear probing, tombstones, power-of-two slots,
// with keys and values kept in insertion order beside the index.
//
// The comparison is `std::unordered_map` and node's `Map`. Both are real hash
// tables, so this row is not about a representation shortcut the way `bigint`
// and `symbol-keys` were -- it is whether ours is a good one.
//
// Everything depends on `seed`, and the trip count carries it so nothing folds.
export function table(seed: number): number {
  const seen = new Map<number, number>();
  const marks = new Set<number>();
  const rounds = 253 + (seed | 0);

  for (let i = 0; i < rounds; i++) {
    seen.set(i * 7, i);
    marks.add(i * 3);
  }
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total = (total + (seen.get(i * 7) ?? 0)) | 0;
    if (marks.has(i * 3)) {
      total = (total + 1) | 0;
    }
    // A miss on both, which is the probe that walks until it finds a hole.
    if (seen.has(i * 7 + 1)) {
      total = (total + 100) | 0;
    }
  }
  // Overwrite every key: the slot is there, so this must not grow anything.
  for (let i = 0; i < rounds; i++) {
    seen.set(i * 7, total);
  }
  return (total + seen.size + marks.size) | 0;
}
