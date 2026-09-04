// The control: the same scan over an array that needs no tag, because the
// element type says what is in it.
export function erasureStoredTyped(seed: number): number {
  const values: number[] = new Array(2000);
  for (let i = 0; i < 2000; i++) {
    values[i] = seed + i;
  }
  let total = 0;
  for (let round = 0; round < 100; round++) {
    for (let i = 0; i < 2000; i++) {
      total = total + values[i];
    }
  }
  return total;
}
