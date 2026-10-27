// The inner allocation runs twice within one outer container's lifetime.
// Both sites repeat, but their instances are not made and retired in lockstep.
// The control replaces only the inner loop with two straight-line stores.
export function nested(n: number): number {
  let result = 0;
  const iterations = 1 + ((n | 0) & 7);
  for (let outer = 0; outer < iterations; outer++) {
    const a: { value: number }[] = [{ value: -1 }, { value: -1 }];
    for (let i = 0; i < 2; i++) {
      a[i] = { value: i };
    }
    result += a[0].value;
  }
  return result;
}

export function control(n: number): number {
  let result = 0;
  const iterations = 1 + ((n | 0) & 7);
  for (let outer = 0; outer < iterations; outer++) {
    const a: { value: number }[] = [{ value: -1 }, { value: -1 }];
    a[0] = { value: 0 };
    a[1] = { value: 1 };
    result += a[0].value;
  }
  return result;
}
