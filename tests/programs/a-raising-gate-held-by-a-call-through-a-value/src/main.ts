// A `try` around a call into a closure is carried only where every closure in
// the program can carry what its callees throw: one call no raising copy could
// contain holds that gate off for the whole program, and every such `try` is
// refused. Three calls through a value held it off, each found in React's
// reconciler, where they took every native React program's `main`. Each arm
// below is one of them, and with any one left, every arm is refused.

class Stepper {
  step(n: number): number {
    if (n < 0) {
      throw new RangeError("negative");
    }
    return n + 1;
  }
}

const stepper = new Stepper();
type Step = (n: number) => number;

// A `const` holding an arrow: React's `reconcileChildFibers`. Read as a raiser
// no copy can be made of, rather than a value whose closure carries the throw.
const step: Step = (n) => stepper.step(n);
function viaConst(n: number): number {
  return step(n);
}

// A call's result, called: React's `specialFiberFor(type)!(props, ...)`. The
// callee has no symbol, and its declared type is a function type with no body.
function pick(n: number): Step | null {
  return n > 1000 ? null : step;
}
function viaResult(n: number): number {
  return pick(n)!(n) * 2;
}

// A function used as a value that calls an arrow it writes: React's
// `UnknownOwner`. Its copy could not contain the call, and a function used as
// a value with no copy holds the gate off by itself.
function owner(n: number): number {
  return ((m: number) => stepper.step(m))(n) * 3;
}
const owners: Array<(n: number) => number> = [owner];

function attempt(task: () => number): number {
  try {
    return task();
  } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}

export function constArm(n: number): number {
  return attempt(() => viaConst(n));
}

export function resultArm(n: number): number {
  return attempt(() => viaResult(n));
}

export function ownerArm(n: number): number {
  return attempt(() => owners[0]!(n));
}
