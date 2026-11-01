// ARES-6 ML function-value control: only the source function changes.
export function work(n: number): number {
  const source = () => 0.5;
  return typeof source === "function" ? n : -1;
}
