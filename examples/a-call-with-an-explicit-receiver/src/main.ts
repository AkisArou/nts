// `f.call(receiver, ...rest)` -- an explicit JavaScript receiver.
//
//     const callback = handler.callback;
//     const result = callback.call(this, ...args);
//
// That is `EventEmitter#emit`, and the comment above it in
// `runtime/node/events` says why the receiver is written: calling
// `handler.callback(...)` would make the private `ListenerRecord` the receiver
// and leak an implementation detail as `this`.
//
// The receiver is **dropped**, and this fixture is what says that is a
// substitution rather than a narrowing. A body that could observe `this` does
// not compile -- a `function` reading its own `this` is refused, a method
// cannot be taken as a value, and an arrow has no `this` of its own -- so no
// value reaching here has a receiver to observe.
// `blockers/a-call-with-a-receiver-that-is-read` holds those three.
//
// `f.call()` with no argument at all is absent deliberately: under
// `strictBindCallApply` it is `TS2555 Expected at least 1 arguments, but got 0`,
// so the empty case is unreachable from TypeScript and a fixture for it would
// be testing the checker rather than this lowering. The lowering handles it
// anyway, because a `split_first` that finds nothing has to do something.

function twoArgs(a: number, b: number): number {
  return a * 10 + b;
}

function withRest(...rest: number[]): number {
  let total = 0;
  for (let i = 0; i < rest.length; i++) total += rest[i]! * (i + 1);
  return total;
}

function noArgs(): number {
  return 7;
}

/** The plain form: a receiver and two ordinary arguments. */
export function plainCall(n: number): number {
  const f = twoArgs;
  return f.call(undefined, n & 3, 2);
}

/** The `emit` shape: a receiver and a spread into a rest parameter. */
export function spreadIntoRest(n: number): number {
  const f = withRest;
  const rest = [n & 3, 2, 5];
  return f.call(undefined, ...rest);
}

/** A receiver and nothing else. */
export function receiverOnly(n: number): number {
  const f = noArgs;
  return f.call(undefined) + (n & 0);
}

/**
 * **The receiver is evaluated even though it is dropped.**
 *
 * `f.call(g(), x)` calls `g`. Discarding the value is not discarding its
 * effects, and a lowering that skipped the expression would lose the write to
 * `order` with nothing to show for it.
 */
export function receiverIsEvaluated(n: number): string {
  // Everything local. A module-scope accumulator would still be holding its
  // string when the run ends, and the reference-counting harness compares what
  // is held after the first case against what is held at the end -- so a global
  // that only some cases write reads as growth. It reported
  // `held 0 object(s) after the first case and 1 at the end`, which was true
  // and was about the fixture rather than about this lowering.
  let seen = "";
  const mark = (tag: string): number => {
    seen += tag;
    return 0;
  };
  const f = twoArgs;
  mark("a");
  f.call(mark("b"), n & 1, 1);
  mark("c");
  return seen;
}

function sumParts(...parts: number[]): number {
  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i]! * (i + 1);
  return total;
}

/**
 * `f.apply(receiver, list)` -- the arguments as one array.
 *
 * The receiver is dropped for the same reason and by the same argument. What
 * differs is the arguments, which is why this is a separate lowering and not
 * the same one under another name.
 *
 * **The array is copied, not passed through.** A rest parameter is fresh on
 * every call, so handing the caller's array to the callee would alias it.
 */
export function applyWithAList(n: number): number {
  const f = sumParts;
  const list = [n & 3, 2, 5];
  return f.apply(undefined, list);
}

/** The empty list, which is where an off-by-one in the copy would show. */
export function applyWithNothing(n: number): number {
  const f = sumParts;
  const list: number[] = [];
  return f.apply(undefined, list) + (n & 0);
}

/** An arrow, whose `this` is the enclosing one and not the call's. */
export function anArrowIgnoresTheReceiver(n: number): number {
  const f = (k: number): number => k + 1;
  return f.call(undefined, n & 7);
}
