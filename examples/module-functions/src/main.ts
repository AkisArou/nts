// A module-scope `const` holding a function.
//
// `const double = (x: number) => x * 2` at the top of a file was refused as "a
// module-scope variable holding a function", with the reason in that refusal's
// own comment: the global was typed by the *declared* type, and what goes in it
// is a closure.
//
// I carried "nineteen bindings in `runtime/node`" as the motivation for three
// files before counting them. There are **four**: `nop` twice, `fn`, and
// `shorthand`. The seven others I had counted are `let`, and they are still
// refused -- see below, and see the record, because that ratio is the finding
// rather than a footnote to it.
//
// Those are two different objects. A function type is `Managed(Object(..))`
// like any other object, and so is the closure the arrow becomes, but they have
// different layouts. Both are references, so nothing between the lowering and
// the backend objected; it surfaced as clang refusing to assign an
// `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`. The same species as the array whose
// elements were `i32` reaching a slot of `f64`: a coarse representation asked a
// question only the fine one can answer.
//
// So the slot takes the closure's type, and the argument that this is sound is
// one word: `const`. A binding that cannot be reassigned holds exactly the
// closure that initialized it. A `let` can be given a *second* arrow, which is
// a second layout, and one slot cannot be both -- so `let` keeps the refusal,
// and `examples/unsupported` says so in those words.

const scale = 3;

// The simplest one: no captures, no globals read.
const double = (x: number): number => x * 2;

// Reads another module-scope binding. Not a capture -- a global is reachable
// from anywhere, so the closure has no field for it.
const scaled = (x: number): number => x * scale;

// Calls another module-scope arrow: one global reading another. The order the
// two are declared in is the order `module#init` assigns them, and neither is
// *called* until after both are assigned.
const inc = (x: number): number => x + 1;
const twice = (x: number): number => inc(inc(x));

// Declared before the arrow it calls, which is the case that would break if
// initialization order were call order rather than assignment order.
const early = (x: number): number => late(x) + 1;
const late = (x: number): number => x * 10;

// Recursive: the arrow names the binding it is being assigned to. It reads the
// global at call time, by which point `module#init` has filled it.
//
// `!(n > 1)` rather than `n <= 1`, and that is not style: `NaN <= 1` is false
// and `NaN - 1` is `NaN`, so the second spelling never reaches a base case for
// a non-finite argument, and the differential passes those. Node answers that
// with a RangeError; this compiler has no stack limit and would take the
// signal. Total on every double is the property to want.
const fact = (n: number): number => (!(n > 1) ? 1 : n * fact(n - 1));

// Exported, so the binding is visible outside the module.
export const negate = (x: number): number => -x;

// No parameters.
const seven = (): number => 7;

// More than one.
const add = (a: number, b: number): number => a + b;

// Strings in and out.
const shout = (s: string): string => s + "!";

// Returns nothing, and writes through a global -- the shape a callback usually
// has.
let seen = 0;
const record = (x: number): void => {
  seen = seen + x;
};

// A block body rather than an expression.
const clamp = (x: number): number => {
  if (x < 0) {
    return 0;
  }
  return x > 100 ? 100 : x;
};

// An *alias* of a declared function. This already worked before any of the
// above, and it is here as the control: it is a different mechanism -- the
// static wrapper `examples/function-values` describes -- and it should keep
// answering the same.
function triple(x: number): number {
  return x * 3;
}
const thrice = triple;

function apply(f: (x: number) => number, v: number): number {
  return f(v);
}

function same(a: (x: number) => number, b: (x: number) => number): boolean {
  return a === b;
}

export function called(n: number): number {
  return double(n);
}

export function readsAGlobal(n: number): number {
  return scaled(n);
}

export function chained(n: number): number {
  return twice(n);
}

export function declaredBeforeItsCallee(n: number): number {
  return early(n);
}

export function recursive(n: number): number {
  // Bounded so the depth is finite for every argument, including a huge one.
  return fact(n > 20 ? 20 : n);
}

export function exported(n: number): number {
  return negate(n);
}

export function noParameters(n: number): number {
  return seven() + n * 0;
}

export function twoParameters(n: number): number {
  return add(n, n);
}

export function strings(n: number): number {
  const width = n > 0 && n < 8 ? n : 1;
  return shout("a".repeat(width)).length;
}

export function returnsNothing(n: number): number {
  seen = 0;
  record(n);
  record(n);
  return seen;
}

export function blockBody(n: number): number {
  return clamp(n);
}

export function alias(n: number): number {
  return thrice(n);
}

// Passed as a value rather than called, so the closure reaches a parameter of
// the *function* type -- which is the store the layouts disagreed about.
export function passedAsAnArgument(n: number): number {
  return apply(double, n) + apply(negate, n) * 1000;
}

// Two mentions of one binding are one object, because the binding is one slot
// holding one closure. Unlike two identically written arrows, which are two --
// `examples/function-values` pins that other half.
export function identity(n: number): number {
  return (
    (same(double, double) ? 1 : 0) +
    (same(double, negate) ? 10 : 0) +
    (same(negate, negate) ? 100 : 0) +
    n * 0
  );
}
