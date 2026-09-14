import { local, sizeof, addrOf } from "c:memory";
import { malloc, free } from "c:stdlib";
import type { Ptr, Struct, c_int, c_uint8, c_double } from "c:types";

type State = Struct<{ flag: c_uint8; value: c_double; count: c_int; next: Ptr<c_int> | null }, "StorageState">;
/** This witness reads every field before TS initializes them, and checks alignment.
 * @ntsNoEscape states
 */
declare function witness(states: Ptr<State>, phase: c_int): c_int;
/** @ntsNoEscape p */
declare function readHeap(p: Ptr<c_int>): c_int;
function read(p: Ptr<c_int>): number { return p[0]; }
function forwarded(p: Ptr<c_int>): number { return read(p); }

export function stack(seed: number): number {
  const states = local<State>(2);
  if (witness(states, 0 as c_int) !== 1) return -1;
  const alias = seed > 0 ? addrOf(states[1], "count") : addrOf(states, "count");
  alias[0] = 17;
  states[0].value = 2.5;
  states[1].value = 3.5;
  if (witness(states, 1 as c_int) !== 1) return -2;
  const items = local<c_int>(1 + 2);
  for (let i = 0; i < 3; i++) items[i] = i + 1;
  return forwarded(alias) + items[0] + items[1] + items[2] + sizeof<State>() + sizeof<c_int>();
}
export function heap(bytes: number): number {
  const p = malloc<c_int>(bytes);
  if (p === null) return -1;
  try {
    p[0] = 37;
    return readHeap(p);
  } finally { free(p); }
}
export function nullFree(): void { free(null); }
export function fixedHeap(): number {
  const p = malloc<c_int>(3 * sizeof<c_int>());
  if (p === null) return -1;
  p[0] = 7; p[1] = 11; p[2] = 13;
  const result = readHeap(p) + p[1] + p[2];
  free(p);
  return result;
}

export function unused(): number { local<c_int>(); return 3; }

// This is deliberately a discarded allocation, not an ownership example.
// Code generation must still accept it under warnings-as-errors.
export function discarded(bytes: number): void { malloc<c_int>(bytes); }
