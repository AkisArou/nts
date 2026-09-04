// A named function used as a value.
//
// `nextTick(finish, stream)` passes a function where JavaScript's answer is a
// function object. This compiler's answer is a closure with no captures whose
// `call` forwards to the function -- emitted once, as a static, so that two
// mentions of a name are the *same* object. That is not only cheaper: an event
// emitter removes a listener by identity, and the profile is full of them.

function inc(x: number): number {
  return x + 1;
}

function dbl(x: number): number {
  return x * 2;
}

function twice(f: (x: number) => number, v: number): number {
  return f(f(v));
}

function same(a: (x: number) => number, b: (x: number) => number): boolean {
  return a === b;
}

export function passedAsAnArgument(n: number): number {
  return twice(inc, n) + twice(dbl, n) * 1000;
}

// The reason for the static. Two mentions of `inc` are one object, and `inc`
// is not `dbl`.
export function identity(n: number): number {
  return (
    (same(inc, inc) ? 1 : 0) + (same(inc, dbl) ? 10 : 0) + (same(dbl, dbl) ? 100 : 0) + n * 0
  );
}

// ...and the reason it is *only* for named functions. Two arrow expressions
// make two objects even when they are written identically, so folding those to
// one instance would answer this wrongly.
export function arrowsAreNotShared(n: number): number {
  const a = (x: number): number => x + 1;
  const b = (x: number): number => x + 1;
  const c = a;
  return (same(a, b) ? 1 : 0) + (same(a, c) ? 10 : 0) + n * 0;
}

// A function is still called directly where it is called directly. Passing it
// somewhere does not turn its ordinary calls into dispatch.
export function stillCalledDirectly(n: number): number {
  return twice(inc, n) + inc(n) * 1000;
}

// Hoisting: the value is taken above the declaration.
export function usedBeforeDeclared(n: number): number {
  return twice(later, n);
}

function later(x: number): number {
  return x + 7;
}

// A callback that returns nothing, which is what most of them are.
let seen = 0;

function record(x: number): void {
  seen = seen + x;
}

function apply(f: (x: number) => void, v: number): void {
  f(v);
}

export function voidCallback(n: number): number {
  seen = 0;
  apply(record, n);
  apply(record, n);
  return seen;
}

// More than one parameter, and a function that recurses. The wrapper forwards
// rather than re-lowering the body, so `fact` calling itself still calls
// `fact` -- one definition, not two.
function add(a: number, b: number): number {
  return a + b;
}

function run2(f: (a: number, b: number) => number, x: number): number {
  return f(x, x);
}

function fact(x: number): number {
  return x <= 1 ? 1 : x * fact(x - 1);
}

export function severalShapes(n: number): number {
  // A bounded, finite depth on purpose: `n % 4` is `NaN` for a non-finite
  // argument, and `fact(NaN)` never reaches its base case in any language.
  return run2(add, n) + twice(fact, n > 0 ? 3 : 2) * 1000;
}

// A named function and an arrow reaching the same parameter, so both kinds of
// closure exist in one program and share the dispatch slot.
export function bothKinds(n: number): number {
  const base = n;
  return twice(inc, n) + twice((x) => x + base, n) * 1000;
}

// A function held in a *field*, which is storage rather than dispatch.
//
// `f(x: number): number` and `f: (x: number) => number` declare members of the
// same type and are not the same thing: the first is a method the dispatch
// table holds, the second is a field holding a closure. The checker says which
// -- `MemberKind` -- and the layout used to ask the *type* instead, which
// cannot tell them apart. Both were dropped, so reading one answered "`apply`,
// which `Ops` does not declare": a message about the type, for a field the
// compiler had removed.
class Ops {
  apply: (x: number) => number;
  scale: number;
  constructor(apply: (x: number) => number, scale: number) {
    this.apply = apply;
    this.scale = scale;
  }
}

export function throughAField(n: number): number {
  const ops = new Ops((x) => x * 2, 10);
  return ops.apply(n) * ops.scale;
}

// The field holds a closure that captured something, so what is stored is a
// pointer to an object with a field of its own rather than a bare code pointer.
export function throughAFieldCapturing(n: number): number {
  const base = n * 3;
  const ops = new Ops((x) => x + base, 1);
  return ops.apply(4);
}

// The same member on an object literal, which is the shape that reaches for it
// most often.
interface Handler {
  handle: (x: number) => number;
}

export function throughALiteral(n: number): number {
  const h: Handler = { handle: (x) => x * 7 };
  return h.handle(n);
}
