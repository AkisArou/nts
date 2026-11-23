// A counted loop's index is whole and finite on the taken strict comparison.
// Even with an unknown bound, i % 1000 + 100 therefore fits c_int. The
// literal control changes only the argument passed to the same scalar slot.
import type { c_int } from "@nts/scalars";

function accept(value: c_int): number {
  return value;
}

function remainder(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += accept(100 + (i % 1000));
  return total;
}

function literal(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += accept(100);
  return total;
}

// Bound execution at the caller. Written-scalar obligations must be proved
// locally in remainder, independently of what its callers happen to pass.
export function counted(n: number): number {
  return remainder(n & 2047);
}

export function control(n: number): number {
  return literal(n & 2047);
}

console.log(counted(1002), control(1002));
