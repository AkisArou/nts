// Two names swapped in a loop whose trip count the compiler cannot know:
// `const t = a; a = b; b = t;`. The loop's block parameters then form a
// cycle, and a cycle of parallel copies needs a scratch to break it.
//
// The C backend declared every scratch `double`, on the reasoning that "a swap
// only ever moves a value into a slot of its own type" -- which is true, and
// the slot was the wrong type for anything but a number: two arrays, two
// strings or two objects swapped this way was C that did not compile
// (`incompatible types when assigning to type 'double' from type
// 'NtsArray *'`). A scratch is now declared per cycle depth and per C type.
//
// A `for` loop with a counter did not show it, because the counter's copy
// orders the others; a `while` whose condition is the doubled width does.

interface Box {
  v: number;
}

export function arrays(n: number): number {
  let a = [1, 2];
  let b = [3];
  let w = 1;
  while (w < n) {
    w = w * 2;
    const t = a;
    a = b;
    b = t;
  }
  return a.length * 10 + b.length;
}

export function strings(n: number): string {
  let a = "left";
  let b = "right";
  let w = 1;
  while (w < n) {
    w = w * 2;
    const t = a;
    a = b;
    b = t;
  }
  return a + "|" + b;
}

export function objects(n: number): number {
  let a: Box = { v: 1 };
  let b: Box = { v: 2 };
  let w = 1;
  while (w < n) {
    w = w * 2;
    const t = a;
    a = b;
    b = t;
  }
  return a.v * 10 + b.v;
}

// Numbers, which always worked, beside them.
export function numbers(n: number): number {
  let a = 1;
  let b = 2;
  let w = 1;
  while (w < n) {
    w = w * 2;
    const t = a;
    a = b;
    b = t;
  }
  return a * 10 + b;
}
