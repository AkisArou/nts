import type { c_int } from "c:types";
import {
  counter_clamp, counter_new, counter_destroy, counter_read, counter_bump,
} from "c:counter";

export function clamped(n: number): number {
  return counter_clamp(n as c_int, 0 as c_int, 10 as c_int) + 0.25;
}

export function roundTrip(n: number): number {
  const counter = counter_new(n as c_int);
  if (counter === null) return -1;
  counter_bump(counter, 2 as c_int);
  const value = counter_read(counter);
  counter_destroy(counter);
  // The C result participates in ordinary TypeScript number arithmetic.
  return value + 0.25;
}
