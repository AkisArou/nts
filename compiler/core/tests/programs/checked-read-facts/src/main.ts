export function unboundedByte(index: number): number {
  const bytes = new Uint8Array(1);
  bytes[0] = 7;
  return bytes[index | 0]! * 0;
}

export function boundedArray(index: number): number {
  const values = [7, 8];
  return values[(index | 0) & 1]! * 0;
}

export function ordinaryArray(index: number): number {
  const values = [7, 8];
  return values[index | 0]! * 0;
}

export function unusedRead(index: number): number {
  const bytes = new Uint8Array(1);
  bytes[0] = 7;
  bytes[index | 0];
  return 7;
}

// Every element is zero, so the read's value is a single constant: folding it
// to `0` would drop the read, and with it the refusal an unproven index owes.
export function allZero(index: number): number {
  const zeros = new Uint8Array(4);
  return zeros[index | 0]!;
}
