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
