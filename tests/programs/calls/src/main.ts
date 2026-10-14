// Fixture for call-target resolution.
//
// A direct call is the whole point: knowing which function a call site reaches
// lets a backend emit a static call instead of a dispatch.

function helper(n: number): number {
  return n * 2;
}

// Overloaded — the call site must select the right one.
export function widen(x: number): number;
export function widen(x: string): string;
export function widen(x: number | string): number | string {
  return x;
}

export const direct = helper(3);
export const overloadedNumber = widen(1);
export const overloadedString = widen("s");
