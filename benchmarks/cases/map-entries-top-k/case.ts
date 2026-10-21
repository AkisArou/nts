// The top-k idiom over a word count: a `Map`'s entries spread into an array,
// sorted by count, and the first k taken.
//
// `[...counts.entries()].sort((a, b) => ...).slice(0, k)` is the commonest
// way real JavaScript turns a `Map` into a ranked list. Each live entry
// becomes a fresh `[word, count]` pair, the sort reads both slots of two
// pairs per comparison, and `slice` keeps the first sixteen. Counting the
// words first is part of the idiom and of the row, as it is of the program
// that writes it.
//
// Ties on a count are broken by the word, so the order is total: node, the
// C++ `unordered_map` (which has no insertion order) and Java's `HashMap`
// all rank the same sixteen.
//
// The comparison is `std::vector<std::pair<std::string, double>>` sorted with
// `std::sort`, and `ArrayList<Map.Entry<String, Double>>` with `List.sort`.
//
// Everything depends on `seed`, and the trip count carries it so nothing folds.
//
// The count's read and write of one word share one lookup (`hir::entries`)
// on every backend whose tables answer an entry -- Wasm's as well as the C
// runtime's -- and not on the JVM's, which answer none:
// expect-ir: c llvm wasm: count call.extern(nts_map_entry) in topWords >= 1
// expect-ir: jvm: count call.extern(nts_map_entry) in topWords == 0
const vocabulary: string[] = [];
for (let i = 0; i < 256; i++) {
  vocabulary.push("word" + i);
}

export function topWords(seed: number): number {
  const counts = new Map<string, number>();
  // A small non-negative integer whatever `seed` is.
  const s = (seed | 0) & 1023;
  const rounds = 1021 + s;
  // A small generator whose two bytes, multiplied, favour the low words: a
  // few are counted often, many rarely, some never, as words in text are.
  // Every product is exact in a double and in a 32-bit integer.
  let state = 1 + s;
  for (let i = 0; i < rounds; i++) {
    state = (state * 75 + 74) % 65537;
    const w = vocabulary[((state & 255) * ((state >> 8) & 255)) >> 8];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 16);
  let total = 0;
  for (let i = 0; i < top.length; i++) {
    total = (total + top[i][1] * (i + 1) + top[i][0].length * 1000) | 0;
  }
  return total;
}

/**
 * The input the harness calls `topWords` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
