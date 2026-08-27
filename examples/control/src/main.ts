export function max(a: number, b: number): number {
  if (a > b) {
    return a;
  }
  return b;
}

export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) {
    return lo;
  } else if (n > hi) {
    return hi;
  } else {
    return n;
  }
}

// `switch`, with the fall-through Are We Fast Yet's own test exercises: a clause
// without a `break` runs the next one, and `default` is reached only when every
// case has been tried, wherever it was written.
export function classify(n: number): number {
  let result = 0;
  switch (n) {
    case 0:
      result += 2;
    case 1:
      result += 4;
      break;
    case 2:
      result += 8;
    default:
      result += 32;
      break;
    case 4:
      result += 64;
  }
  return result;
}

// `do` runs its body before it asks, so this is `n` for every `n` above zero
// and one for the rest.
export function countUp(n: number): number {
  let i = 0;
  do {
    i = i + 1;
  } while (i < n);
  return i;
}

// `break` leaves with what the body reached, not with what the header held --
// the sum includes the iteration that broke.
export function upTo(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    total += i;
    if (i > 3) {
      break;
    }
  }
  return total;
}

// `continue` in a `for` must still run the update, or the loop never ends.
export function odds(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    if (i % 2 === 0) {
      continue;
    }
    total += i;
  }
  return total;
}

// A `continue` written inside a `switch` belongs to the loop around it: a
// `switch` is something to break out of, not something to continue.
export function throughSwitch(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    switch (i % 3) {
      case 0:
        continue;
      case 1:
        total += 1;
        break;
      default:
        total += 100;
    }
    total += 1000;
  }
  return total;
}
