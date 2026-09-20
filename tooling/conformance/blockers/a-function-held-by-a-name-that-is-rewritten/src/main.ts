// The half of the closure-global question that is still refused, and should be.
//
// A global's slot has one type. A closure's type **is its captures**, so the
// two arrows below are two layouts, and there is no slot that is both. The
// refusal says so by name --- *"a module-scope `let` holding a function, which
// may be reassigned with a closure of another layout"* --- which is strictly
// better than the alternative it replaced, where lowering accepted the program
// and clang declined to assign an `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`.
//
// The counterpart is `examples/a-function-held-by-a-name-nothing-rewrites`: a
// `let` nothing writes again now compiles, because the keyword was never the
// question. This file is what keeps that widening honest.
//
// **The third arm is the one that matters.** `viaDestructuring` writes through
// an array literal, and the obvious implementation --- reusing
// `assigned_symbols`, which reports bare identifiers only --- reports nothing
// written for it and would have let this slot through. It is here because a
// control that cannot fail proves nothing about the thing it controls.
//
// Lifting this is one design rather than a patch: a closure global would need a
// representation that spans layouts --- a tag and an indirect call --- and that
// is a different feature from the one the arms above exercise.

const a = 1;
const b = 2;

let plain = (n: number): number => n + 1;
plain = (n: number): number => n + 2;

let captures = (n: number): number => n + a;
captures = (n: number): number => n + b;

let viaDestructuring = (n: number): number => n + a;
[viaDestructuring] = [(n: number): number => n + b];

export function usePlain(n: number): number {
  return plain(n);
}

export function useCaptures(n: number): number {
  return captures(n);
}

export function useDestructured(n: number): number {
  return viaDestructuring(n);
}
