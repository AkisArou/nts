// A closure is an object with one method.
//
// That is not a trick to make it fit. A closure is captured state plus code,
// which is what an object is -- so saying so means it gets the object machinery
// as written: a base-first layout (the signature type is the base, and it has no
// fields), escape analysis that leaves it in the frame when it does not outlive
// the call, reference counting with the same rules as everything else, and
// dispatch through a slot. None of the four needed a line of new code.
//
// What it costs is visible in the generated C. `twice` allocates nothing: the
// closure is a local struct and the call through its table is one clang
// devirtualizes. `makeAdder` returns one, so that one is on the heap and
// counted.

type Fn = (x: number) => number;

// The signature type is a parameter type, so it needs a layout of its own even
// though no program ever constructs one. Only closures do, and they have it as
// their base.
export function apply(f: Fn, v: number): number {
  return f(v);
}

// Captures nothing, so the object has no fields and never leaves the frame.
export function twice(v: number): number {
  const double = (x: number): number => x * 2;
  return double(double(v));
}

// Captures a parameter. Still frame-local: `apply` does not keep it.
export function scaled(by: number, v: number): number {
  return apply((x: number): number => x * by, v);
}

// Escapes, so it is allocated and reference counted. The capture is a field of
// it, and lives exactly as long as it does.
export function makeAdder(n: number): Fn {
  return (x: number): number => x + n;
}

export function useAdder(n: number, v: number): number {
  const add = makeAdder(n);
  return add(add(v));
}

// Two closures with the same signature and different bodies reach one call
// site. Nothing about the call site says which, which is the whole reason the
// slot exists -- and the reason two layouts of the same shape must not be
// merged into one.
export function pick(positive: boolean): Fn {
  if (positive) {
    return (x: number): number => x * 10;
  }
  return (x: number): number => x - 10;
}

export function bothWays(v: number): number {
  return pick(true)(v) + pick(false)(v);
}

// A closure over a reference. The array is the closure's now: it is retained
// when the field is written and given up when the closure is destroyed, which
// is the same rule a field of any other object follows.
export function sumWith(v: number): number {
  const weights: number[] = [1, 2, 3, 4];
  const weigh = (x: number): number => x * weights[0] + weights[3];
  return apply(weigh, v);
}

// A closure over a string, called in a loop. The capture is read from the same
// field every iteration, and nothing is allocated per call.
export function tagged(v: number): number {
  const label = "closure";
  const measure = (x: number): number => x + label.length;
  let total = 0;
  for (let i = 0; i < 4; i = i + 1) {
    total = total + measure(v + i);
  }
  return total;
}

// Higher order over the whole array, which is what `map` will be once it takes
// one of these.
export function applyToAll(v: number, times: number): number {
  const step = (x: number): number => x * 2 + 1;
  let total = 0;
  let at = 0;
  while (at < times) {
    total = total + step(v + at);
    at = at + 1;
  }
  return total;
}
