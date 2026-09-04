// String work: a scan by code unit, a substring search, and a membership test,
// which between them are what string-heavy code actually does.
//
// It depends on `seed`, so none of it folds away at compile time.
export function scan(seed: number): number {
  const text = "the quick brown fox jumps over the lazy dog";
  const step = seed | 0;
  let total = 0;
  for (let round = 0; round < 128; round++) {
    for (let i = 0; i < text.length; i++) {
      total = (total + text.charCodeAt(i) * step) | 0;
    }
    total = (total + text.indexOf("brown")) | 0;
    if (text.includes("jumps")) {
      total = (total + 1) | 0;
    }
    if (text.startsWith("the")) {
      total = (total + 2) | 0;
    }
  }
  return total;
}
