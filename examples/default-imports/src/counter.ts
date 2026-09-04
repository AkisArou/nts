// A default export that is mutable module state, so the import is a read of a
// global rather than of a constant.
let count = 0;

export default function bump(by: number): number {
  count = count + by;
  return count;
}

export function seen(): number {
  return count;
}
