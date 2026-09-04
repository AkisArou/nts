// Generators, which this compiler refuses.
//
// Here so the refusal says `yield` rather than "this expression". A message
// that names no construct cannot be grouped, ranked, or counted, and every
// `yield` in the node profile was landing in the same anonymous bucket as
// everything else the expression lowering does not handle.
//
// Node's `readline` key decoder is a generator-based state machine over
// terminal escape sequences, so this is not hypothetical.
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
