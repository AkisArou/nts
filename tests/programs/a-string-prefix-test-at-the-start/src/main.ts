// Control: only the second argument to startsWith is omitted.
export function work(n: number): number {
  const text = n < 0 ? "other" : "value";
  return text.startsWith("v") ? 1 : 0;
}
