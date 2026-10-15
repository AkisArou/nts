// Small direct calls, which the Wasm backend inlines into their callers: a
// function, one that returns early, one with a loop called inside a loop, and
// two methods. Each export answers what node answers, and calls none of them.

function square(x: number): number {
  return x * x;
}

function clamp(x: number, low: number, high: number): number {
  if (x < low) return low;
  if (x > high) return high;
  return x;
}

function sumTo(n: number): number {
  let total = 0;
  for (let i = 0; i < n && i < 100; i++) total += i;
  return total;
}

class Counter {
  count = 0;
  bump(by: number): void {
    this.count += by;
  }
  read(): number {
    return this.count;
  }
}

export function squares(n: number): number {
  return square(n) + square(n + 1);
}

export function clamped(n: number): number {
  return clamp(n, -3, 7) + clamp(n * 2, 0, 1);
}

export function sums(n: number): number {
  let total = 0;
  for (let k = 0; k < 3; k++) total += sumTo(n + k);
  return total;
}

export function counted(n: number): number {
  const counter = new Counter();
  for (let i = 0; i < 5; i++) counter.bump(n);
  return counter.read();
}
