// A module with a live exported binding, for live-bindings.ts.
export let count = 0;
export function increment(): number {
  count += 1;
  return count;
}
