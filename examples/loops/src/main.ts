export function sumTo(n: number): number {
  let total = 0;
  let i = 0;
  while (i < n) {
    total = total + i;
    i = i + 1;
  }
  return total;
}

// A label names the loop written under it, so a `break` or `continue` inside
// can say which loop it means. It is not a construct of its own: the loop takes
// the name when it pushes what `break` searches, and everything below is the
// same jump to the same block with a different one of them chosen.
//
// A label is not a binding, so the checker gives it no symbol and it is matched
// by text. Nesting is what makes that safe: the innermost loop carrying the
// name is the one the name refers to.
export function breaksOutOfTwo(n: number): number {
  let total = 0;
  outer: for (let i = 0; i < 3; i = i + 1) {
    for (let j = 0; j < 3; j = j + 1) {
      if (i + j > n) {
        break outer;
      }
      total = total + 1;
    }
    total = total + 100;
  }
  return total;
}

export function continuesTheOuter(n: number): number {
  let total = 0;
  outer: for (let i = 0; i < 4; i = i + 1) {
    for (let j = 0; j < 4; j = j + 1) {
      if (j > n) {
        continue outer;
      }
      total = total + 1;
    }
    total = total + 100;
  }
  return total;
}

// Three deep, with two labels: each `break` and `continue` names one of them.
export function twoLabels(n: number): number {
  let total = 0;
  outer: for (let i = 0; i < 3; i = i + 1) {
    middle: for (let j = 0; j < 3; j = j + 1) {
      for (let k = 0; k < 3; k = k + 1) {
        if (k > n) {
          continue middle;
        }
        if (i + j + k > 4) {
          break outer;
        }
        total = total + 1;
      }
      total = total + 10;
    }
    total = total + 100;
  }
  return total;
}

// A labelled `while`, which carries its names the same way a `for` does.
export function labelledWhile(n: number): number {
  let total = 0;
  let i = 0;
  loop: while (i < 5) {
    i = i + 1;
    let j = 0;
    while (j < 5) {
      j = j + 1;
      if (j > n) {
        continue loop;
      }
      total = total + 1;
    }
    total = total + 100;
  }
  return total;
}

// `break outer` leaves every `try` between it and the loop it names, so each
// one's `finally` runs on the way -- the label changes which loop is left, not
// what leaving one means.
export function breaksThroughAFinally(n: number): number {
  let total = 0;
  outer: for (let i = 0; i < 4; i = i + 1) {
    for (let j = 0; j < 4; j = j + 1) {
      try {
        if (i + j > n) {
          break outer;
        }
        total = total + 1;
      } finally {
        total = total + 10;
      }
    }
  }
  return total;
}
