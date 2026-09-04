// An exception thrown and caught in one function.
//
// The thrown object reaches the handler through an `erase` and a block
// parameter, which is two steps of indirection that escape analysis and the
// counting pass both have to see through. If either cannot, this allocates once
// an iteration and counts the reference twice -- and both are visible here and
// nowhere else in the suite.

class Failure {
  code: number;
  constructor(code: number) {
    this.code = code;
  }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 8 + n; i++) {
    try {
      if (i % 2 === 0) {
        throw new Failure(i);
      }
      total = total + 1;
    } catch (e) {
      total = total + (typeof e === "object" ? 2 : 0);
    }
  }
  return total;
}
