import { broadFirst, literalFirst } from "./throwers.ts";

function call(callback: (n: number) => number, n: number): number {
  try {
    return callback(n);
  } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}

export function literalFirstValue(n: number): number {
  return call(literalFirst, n);
}

export function broadFirstValue(n: number): number {
  return call(broadFirst, n);
}

export function literalFirstAlias(n: number): number {
  const alias = literalFirst;
  return call(alias, n);
}

export function generalDirect(n: number): number {
  return literalFirst(n & 3);
}

export function literalDirect(n: number): number {
  const literal: 1 = literalFirst(0);
  return literal + (n & 3);
}
