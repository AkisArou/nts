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

// A declaration with no initializer, which is how a value decided by branches
// rather than by an expression gets written.
//
// The name has to be *something* from the declaration onward -- every block
// below reads it as a carried name and a merge takes it as a parameter -- so
// the whole of this is having a value to bind. Where the type admits no
// absence the checker has already proved the assignment comes first, so what
// that value is cannot be observed; where it admits one, it can be, and the
// placeholder is the `undefined` node reports.
export function assignedInBothArms(n: number): number {
  let picked: number;
  if (n > 10) {
    picked = n * 2;
  } else {
    picked = n - 1;
  }
  return picked;
}

// Read before it is written, which is the case the placeholder is observable
// in: `string | undefined` is one absence on a reference, so the null pointer
// *is* the `undefined`.
export function readBeforeWritten(n: number): string {
  let joined: string | undefined;
  const before = joined === undefined ? "u" : "s";
  if (n > 10) {
    joined = "big";
  }
  return before + ":" + (joined === undefined ? "still" : joined);
}

// A scalar union, which is erased rather than a pointer, so its `undefined` is
// a tag instead of a null.
export function scalarUnwritten(n: number): number {
  let held: number | undefined;
  const first = held === undefined ? 1 : 0;
  if (n > 10) {
    held = n;
  }
  return first * 100 + (held ?? -1);
}

// Written in a loop, which is where the merge the declaration feeds is a
// loop-carried name rather than a branch.
export function assignedInALoop(n: number): number {
  let last: number;
  last = 0;
  for (let i = 0; i < 4 + (n - n); i++) {
    let step: number;
    if (i % 2 === 0) {
      step = i * 3;
    } else {
      step = i;
    }
    last = last + step;
  }
  return last;
}

// A boolean, and a string, each declared and then written on every path.
export function twoKinds(n: number): string {
  let flag: boolean;
  let name: string;
  if (n > 10) {
    flag = true;
    name = "over";
  } else {
    flag = false;
    name = "under";
  }
  return name + (flag ? "!" : "-");
}

// Declared, then written in a `switch`, which is a merge with more than two
// ways in.
export function assignedInASwitch(n: number): number {
  let weight: number;
  switch (n % 3) {
    case 0:
      weight = 100;
      break;
    case 1:
      weight = 200;
      break;
    default:
      weight = 300;
      break;
  }
  return weight + n * 0;
}

// The shape `path.resolve` is written in: a declaration outside a loop, written
// inside it, and read after.
export function resolvedLikePath(n: number): string {
  const parts = ["a", "bb", "ccc"];
  let out: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.length > 1) {
      out = out === undefined ? part : out + "/" + part;
    }
  }
  return (out ?? "none") + String(n * 0);
}

// `let device;` — no annotation and no initializer, which is TypeScript's
// evolving `any`. Same question as an evolving array and the same answer: the
// type where it is written says nothing, and a later mention says what it
// became.
export function evolvedAny(n: number): string {
  let device;
  if (n > 10) {
    device = "big";
  } else {
    device = "small";
  }
  return device + ":" + String(device.length);
}

export function evolvedNumber(n: number): number {
  let held;
  if (n > 10) {
    held = n * 2;
  } else {
    held = n - 1;
  }
  return held + 1;
}
