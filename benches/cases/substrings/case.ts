// Slicing: splitting a text into words and looking at each one.
//
// This is the shape of every parser, tokenizer and CSV reader, and it is the
// one place a string implementation's representation shows. `substring` is
// O(1) for anything that can return a *view* of its input -- C++'s
// `string_view`, V8's sliced strings -- and O(n) with an allocation for
// anything that must copy.
//
// It depends on `seed`, so none of it folds away at compile time.
export function work(seed: number): number {
  const text =
    "the quick brown fox jumps over the lazy dog and then some more words follow here";
  const step = seed | 0;
  let total = 0;

  for (let round = 0; round < 64; round++) {
    let start = 0;
    for (let i = 0; i <= text.length; i++) {
      if (i === text.length || text.charCodeAt(i) === 32) {
        const word = text.substring(start, i);
        total = (total + word.length * step) | 0;
        if (word.length > 0) {
          total = (total + word.charCodeAt(0)) | 0;
        }
        start = i + 1;
      }
    }
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
