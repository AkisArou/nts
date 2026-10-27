// The write must run even though this initializer produces only null.
let changed = 0;
export const y = (changed = 1, null);

export function read(n: number): number {
  return changed + n;
}
