// A third `pick`, overloaded as well, so both sides of an ambiguity are
// signatures rather than one of each.

export function pick(n: number): number;
export function pick(n: number, m: number): number;
export function pick(n: number, m?: number): number {
  return n * 10 + (m ?? 1);
}
