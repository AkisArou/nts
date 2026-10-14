// run: check

// Main aa913009a92a folds the result using the byte width and erases the
// checked read: out of range it answers 0 where node answers NaN (23 of 58).
// The control changes only the index to the initialized byte. A storage
// width describes the in-range value, not an unchecked promise of finiteness.

export function multipliedRead(index: number): number {
  const bytes = new Uint8Array(1);
  bytes[0] = 7;
  const x = bytes[index | 0]!;
  return x * 0;
}

export function multipliedReadControl(index: number): number {
  const bytes = new Uint8Array(1);
  bytes[0] = 7;
  const x = bytes[(index | 0) & 0]!;
  return x * 0;
}
