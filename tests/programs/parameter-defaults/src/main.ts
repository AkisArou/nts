// A parameter default that reads the parameters before it.
//
// JavaScript evaluates a default in the *callee's* scope, and this compiler
// evaluates it at the call -- which is the same moment and a different scope.
// That difference was refused rather than reconciled, and it did not need to
// be: the caller has already computed every argument the default can read, so
// binding the callee's names to those values for the length of one expression
// is all it takes. `f(a, b = a + 1)` called as `f(2)` evaluates `a + 1` with
// `a` meaning the two the caller just passed.
//
// TypeScript refuses a default that reads a *later* parameter itself (TS2372),
// so the only direction that reaches here is the one that works.

export function oneBack(n: number, step = n + 1): number {
  return n * 100 + step;
}

export function twoBack(n: number, step = n + 1, span = step * 2): number {
  return n * 10000 + step * 100 + span;
}

// A chain where each default reads the one before it, so a lowering that bound
// only the first parameter answers the first case and not the fourth.
export function chained(a: number, b = a, c = b + 1, d = c + 1): number {
  return a * 1000 + b * 100 + c * 10 + d;
}

// Supplied at every arity, so the bound value has to be the *argument* where
// one was given and the default where it was not.
// The written arguments are constants rather than expressions in `n`, so a
// structural check can tell "the call wrote this" from "the default computed it
// from the first argument". With `twoBack(n, n + 5)` both are derived from `n`
// and the two are indistinguishable in the HIR.
export function everyArity(n: number): number {
  return twoBack(n) + twoBack(n, 5) + twoBack(n, 5, 9);
}

// A default that reads a parameter *and* something from the enclosing module,
// so the binding must not displace the ordinary scope.
const OFFSET = 7;
export function withAModuleConstant(n: number, k = n + OFFSET): number {
  return n * 100 + k;
}

// Recursive, which is the one case where the caller has its own binding for the
// same symbol: `count` calling `count(n - 1)` must not leave its own `n`
// pointing at the argument it just passed.
function count(n: number, acc = n): number {
  // `!(n > 0)` rather than `n <= 0`, so a NaN stops. `NaN <= 0` is false and
  // `NaN - 1` is NaN, so the second spelling recurses for ever -- which the
  // JVM lane reported as a `StackOverflowError` and the C lane did not report
  // at all, because its stack outlasted the harness's per-case timeout. Two
  // lanes, one unbounded recursion, and only one of them said so.
  if (!(n > 0)) {
    return acc;
  }
  return count(n - 1, acc + n);
}

export function recursiveDefault(n: number): number {
  return count(n % 6);
}

// The shape that actually needs the binding *restored*, which the one above
// does not: a function that calls **itself** while omitting the default, and
// then reads its own parameter afterwards.
//
// Lowering `deep(n - 1)` binds the callee's `n` -- the same symbol as this
// function's own -- to `n - 1` so the default can be evaluated. Without putting
// the old binding back, the `+ n` below reads `n - 1`, and every level of the
// recursion is off by one.
function deep(n: number, seed = n * 2): number {
  // `!(n > 0)` rather than `n <= 0`, so a NaN terminates. The pool supplies
  // one, `NaN <= 0` is false, and `NaN - 1` is NaN -- which recurses until the
  // stack runs out. Node throws a RangeError there and this compiler segfaults,
  // so the two disagree about a program neither of them should be asked about.
  if (!(n > 0)) {
    return seed;
  }
  const inner = deep(n - 1);
  return inner + n;
}

export function recursionRestoresItsOwnName(n: number): number {
  return deep(n % 5);
}

// A method, where the receiver is argument zero and the declared parameters
// start at one -- so an off-by-one in the binding shows here and nowhere else.
class Span {
  base: number;
  constructor(base: number) {
    this.base = base;
  }
  widen(by: number, times = by + 1): number {
    return this.base * 100 + by * 10 + times;
  }
}

export function throughAMethod(n: number): number {
  const s = new Span(n);
  return s.widen(2) + s.widen(2, 3);
}

// A default whose value is a string, so the binding works for a managed
// representation as well as a number.
function label(name: string, decorated = name + "!"): string {
  return decorated;
}

export function managedDefault(n: number): string {
  return label("a" + n) + "|" + label("b" + n, "given");
}

// A default that is a call reading an earlier parameter, so the bound value
// crosses a call boundary rather than only an arithmetic one.
function twice(x: number): number {
  return x * 2;
}

function viaACall(a: number, b = twice(a)): number {
  return a * 100 + b;
}

export function defaultThroughACall(n: number): number {
  return viaACall(n) + viaACall(n, 1);
}

// The hazard the old refusal named, made observable.
//
// Its comment said filling a default that reads `a` "would evaluate `a` twice,
// and twice is a different program whenever it has an effect". That is true of
// re-lowering the argument *expression* and false of what happens here: the
// binding names the value the call already computed, so the expression runs
// once however many defaults read it.
let effects = 0;

function bump(by: number): number {
  effects = effects + 1;
  return by;
}

function readsItTwice(a: number, b = a * 2, c = a + b): number {
  return a + b + c;
}

export function theArgumentIsEvaluatedOnce(n: number): number {
  effects = 0;
  const total = readsItTwice(bump(n % 4));
  // Two defaults read `a` and `bump` ran once, so `effects` is 1 rather than 2
  // or 3 -- which is what the refusal this replaced was afraid of.
  return total * 100 + effects;
}
