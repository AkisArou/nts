// Generators, which this compiler compiles.
//
// This file was here for the *refusal*: so that it said `yield` rather than
// "this expression", because a message that names no construct cannot be
// grouped, ranked or counted, and every `yield` in the node profile was landing
// in the same anonymous bucket as everything else unhandled. Naming it is what
// made the feature visible enough to build.
//
// Node's `readline` key decoder is a generator-based state machine over
// terminal escape sequences, so this was never hypothetical.
function* counter(limit: number): Generator<number, void, unknown> {
  let i = 0;
  while (i < limit) {
    yield i;
    i = i + 1;
  }
}

export function total(limit: number): number {
  let sum = 0;
  for (const value of counter(limit)) {
    sum = sum + value;
  }
  return sum;
}
