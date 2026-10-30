// expect: NTS1001 an `Object` static over something that is not an object here
// B-d validator reduction. Only Input differs from the one-change control.
type Input = unknown;
function inspect(value: Input): number {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.hasOwn(value, "id") ? 1 : 0;
}
export function work(n: number): number { return inspect({ id: n }); }
