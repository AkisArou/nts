// expect: a top-level `await`
// The write must run even though this initializer produces only null.
let changed = 0;
export const y = await (changed = 1, null);

export function read(n: number): number {
  return changed + n;
}
