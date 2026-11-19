// The six-string stability control from count-free-sort, with its whole joined
// answer consumed as a numeric checksum. The seeded string stays dynamic.
export function work(seed: number): number {
  const xs = ["ccc", "a", "bb", String(seed & 15), "dd", "e"];
  xs.sort((a, b) => a.length - b.length);
  const text = xs.join(",");
  let total = 0;
  for (let i = 0; i < text.length; i++) total = (total * 31 + text.charCodeAt(i)) | 0;
  return total;
}

export const seed = 7;
