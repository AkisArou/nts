// A generator walked to the end, which is the whole of what a `for...of` over
// one does.
//
// Exactly one managed object exists in this program: the frame. It is made by
// the caller, read by the resumption, and dies with the loop -- and everything
// else here is a number.

function* upTo(limit: number): Generator<number, void, unknown> {
  let i = 0;
  while (i < limit) {
    yield i * 2;
    i = i + 1;
  }
}

export function work(n: number): number {
  let total = 0;
  for (const value of upTo(16 + n)) {
    total = total + value;
  }
  return total;
}
