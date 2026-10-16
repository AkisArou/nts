// run: check
// A generator binds its parameters when called, before its first next().
// The subject omits the element; the control supplies the same initializer's
// value as that element. Node observes one call before next() in both arms.
// On main's 64fe6c9fc pin, all 29 subject cases disagree and all 29 controls
// agree. Its emitted C puts tick() in generated__resume, after the observer
// has read calls. The first next() consequently comes too late to bind it.
let calls = 0;

function tick(): number {
  calls += 1;
  return 7;
}

function* generated([value = tick()]: number[]): Generator<number> {
  yield value;
}

function observe(values: number[]): number {
  const iterator = generated(values);
  const before = calls;
  const next = iterator.next();
  return before * 100 + (next.done ? 0 : next.value);
}

export function defaultArgument(n: number): number {
  calls = 0;
  return observe([]) + (n | 0);
}

export function presentArgument(n: number): number {
  calls = 0;
  return observe([tick()]) + (n | 0);
}
