// Ignoring an erased result must release it under RC. A callable result is
// still carried through the closure's uniform ABI before the slot drops it.
interface Reader { read(x: number): void }
interface Wide { read(x: number | string): string }
function call(reader: Reader, n: number): void { reader.read(n); }
export function result(n: number): number {
  const base = "x";
  const literal: Wide = {
    read(x: number | string): string { return base + String(x); },
  };
  for (let i = 0; i < 5; i++) call(literal, n);
  return n + 1;
}
