// Merging a reference does not change how often its allocation is reused.
// The control replaces only the inner loop with straight-line stores.
export function merged(n: number): number {
  let result = 0;
  const iterations = 1 + ((n | 0) & 7);
  for (let outer = 0; outer < iterations; outer++) {
    const a: { value: number }[] = [
      { value: -1 },
      { value: -1 },
      { value: -1 },
      { value: -1 },
    ];
    for (let i = 0; i < 4; i++) {
      const next = i < 2 ? { value: i } : { value: i + 1 };
      a[i] = next;
    }
    result += a[0].value;
  }
  return result;
}

export function control(n: number): number {
  let result = 0;
  const iterations = 1 + ((n | 0) & 7);
  for (let outer = 0; outer < iterations; outer++) {
    const a: { value: number }[] = [
      { value: -1 },
      { value: -1 },
      { value: -1 },
      { value: -1 },
    ];
    a[0] = { value: 0 };
    a[1] = { value: 1 };
    a[2] = { value: 3 };
    a[3] = { value: 4 };
    result += a[0].value;
  }
  return result;
}
