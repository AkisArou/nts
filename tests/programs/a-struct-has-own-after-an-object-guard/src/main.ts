// B-d validator reduction. Only Input differs from the one-change control.
type Input = { id: number };
function inspect(value: Input): number {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.hasOwn(value, "id") ? 1 : 0;
}
export function work(n: number): number { return inspect({ id: n }); }
