// expect: `arguments.length`, a read of the `arguments` object
// Compiler lane: strict arguments-object reads; see the rest-tuple control.
"use strict";

function count(_value: number): number {
  return arguments.length;
}

export function argumentCount(value: number): number {
  return count(value);
}
