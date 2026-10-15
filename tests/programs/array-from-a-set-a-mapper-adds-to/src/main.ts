// Array.from applies its mapper while consuming the iterator. An element
// added on the first callback is therefore visited by the same collection.
// Before the fix, lowering collected first and mapped the intermediate array,
// so the subject stopped after the two original elements even though its
// source Set had three. Keep the minimal outcome as a program guard.
//
// The control differs only in whether the mapper adds the third element.
// Both loops are bounded: the addition happens once, at output index zero.
function listed(n: number, addDuringMapping: boolean): string {
  const first = (n & 15) + 1;
  const source = new Set<number>();
  source.add(first);
  source.add(first + 1);
  const result = Array.from(source, (value, index) => {
    if (addDuringMapping && index === 0) source.add(first + 2);
    return value * 10 + index;
  });
  return result.join(",") + ":" + source.size;
}

export function control(n: number): string {
  return listed(n, false);
}

export function subject(n: number): string {
  return listed(n, true);
}
