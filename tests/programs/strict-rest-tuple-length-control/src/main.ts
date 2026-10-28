// Control for tests/refusals/strict-arguments-length: only the binding uses a rest tuple.
"use strict";

function count(...values: [number]): number {
  return values.length;
}

export function argumentCount(value: number): number {
  return count(value);
}
