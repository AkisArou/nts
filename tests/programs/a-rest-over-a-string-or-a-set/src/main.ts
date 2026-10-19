// A rest element over a sequence that is not an array: a string, which a
// rest collects by code point, and a `Set`. Each carries a length, which was
// the test for slicing it, so each went to `nts_array_slice` as if it were an
// array -- C that clang rejects. They are collected through their iterators
// now. `overAnArray` is the control: an array is sliced, and agreed before.

export function overAString(n: number): string {
  const [...chars] = `ab${n & 7}`;
  return `${chars.length}:${chars.join(",")}`;
}

export function overAStringOutsideTheBmp(n: number): number {
  const [...points] = `x\u{1F600}${n & 1}`;
  return points.length;
}

export function overASet(n: number): string {
  const [...items] = new Set([n & 3, (n & 3) + 1, n & 3]);
  return items.join(",");
}

export function overAnArray(n: number): string {
  const [...items] = [n & 3, (n & 3) + 1, n & 3];
  return items.join(",");
}
