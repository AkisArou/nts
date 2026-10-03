// A postfix increment in a loop's condition is carried round the loop.
//
// Until e46ddae84 the loop header's block parameters carried the body's
// variables and not one written by the condition: `count + 1` was computed and
// dropped, so `while (count++ < 9)` tested the entry value forever -- an
// infinite loop on every backend, found by the Builtins lane as a
// Temporal.Duration parse hang. outcomes/a-postfix-increment-in-a-loop-
// condition-is-not-carried is the guard (C); this runs the same shapes on every
// backend, and `padded` is the one that hung.
//
// `inBody` is the control: the same loop with the increment in the body.
export function padded(n: number): number {
  let count = n & 7;
  let fraction = 1;
  while (count++ < 9) fraction *= 10;
  return fraction + count;
}

export function inFor(n: number): number {
  let count = n & 7;
  let steps = 0;
  for (let i = 0; i < 20 && count++ < 9; i++) steps++;
  return steps * 100 + count;
}

export function inWhile(n: number): number {
  let count = n & 7;
  let steps = 0;
  let i = 0;
  while (i < 20 && count++ < 9) {
    steps++;
    i = i + 1;
  }
  return steps * 100 + count;
}

export function inBody(n: number): number {
  let count = n & 7;
  let steps = 0;
  while (count < 9) {
    count++;
    steps++;
  }
  return steps * 100 + count;
}
