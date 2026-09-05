// A default that reads an earlier parameter, in a loop.
//
// The default is one expression evaluated where the call is, with the callee's
// name bound to the value the caller already has. Binding a name is not a
// value, so there is nothing to allocate and nothing to count.

function span(from: number, to = from + 1, step = to - from): number {
  return (to - from) * step;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    total = total + span(i) + span(i, i + 3) + span(i, i + 3, 2);
  }
  return total;
}
