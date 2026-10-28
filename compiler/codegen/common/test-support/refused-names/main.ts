export function work(n: number): number {
  const bytes = new Uint8Array([n]);
  function uniqueRefusedNeedle(): number { return bytes.indexOf(n); }
  return uniqueRefusedNeedle();
}
export function kept(n: number): number { return n + 1; }
