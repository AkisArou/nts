// An `if` inside a loop, both arms assigning a loop-carried name. The merge
// needs block parameters and so does the header.
export function classify(n: number): number {
  let result = 0;
  let i = 0;
  while (i < n) {
    if (i > 5) {
      result = result + 2;
    } else {
      result = result + 1;
    }
    i = i + 1;
  }
  return result;
}

// An `if` with no `else` that assigns: the false edge reaches the merge
// directly, so it carries the merge's arguments on the branch itself.
export function atLeastTen(n: number): number {
  let v = n;
  if (n < 10) {
    v = 10;
  }
  return v;
}

// A name declared inside the loop body is fresh each iteration, not carried.
export function nested(n: number): number {
  let total = 0;
  let y = 0;
  while (y < n) {
    let x = 0;
    while (x < n) {
      total = total + 1;
      x = x + 1;
    }
    y = y + 1;
  }
  return total;
}

export function negate(x: number): number {
  return -x;
}

export function flip(b: boolean): boolean {
  return !b;
}

export function grouped(a: number, b: number): number {
  return (a + b) * (a - b);
}

export function always(): boolean {
  return true;
}
