// A module of named exports, for namespace-import.ts and re-exports.ts.
export const pi = 3.14;
export function square(n: number): number {
  return n * n;
}
export class Vector {
  constructor(readonly x: number, readonly y: number) {}
}
