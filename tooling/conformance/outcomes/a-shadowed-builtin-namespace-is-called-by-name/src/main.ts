// **A local binding that shadows a builtin namespace is still called as the
// builtin.** `lower_special_call`, `intrinsic_of` and `lower_decided_static`
// match a call's receiver by its *text* -- `Object`, `Math`, `Number` -- not by
// the binding it denotes, so a program's own `const Math = { ... }` answers what
// the library's would:
//
//   Object.is(n, n + 1)   with a local `Object`   node true    nts false
//   Math.max(1, 2)        with a local `Math`     node 1       nts 2
//   Number.isNaN(1)       with a local `Number`   node true    nts false
//
// Found porting the integration branch's `Object.is` fix (7a1f7fb2a), whose
// example carried this root; that branch guarded `Object.is` alone, through
// checker declaration-origin metadata main's schema does not carry. The defect
// is every name-matched builtin, so the fix belongs at the one place that
// decides "this receiver is the library's", not at each builtin.
//
// **Control, one difference each:** the same three calls through the real
// namespaces, which agree.

function shadowedObject(n: number): boolean {
  const Object = { is: (a: number, b: number): boolean => a < b };
  return Object.is(n, n + 1);
}

function shadowedMath(): number {
  const Math = { max: (a: number, _b: number): number => a };
  return Math.max(1, 2);
}

function shadowedNumber(): boolean {
  const Number = { isNaN: (_v: number): boolean => true };
  return Number.isNaN(1);
}

observe("shadowed Object.is(1, 2)", String(shadowedObject(1)));
observe("shadowed Math.max(1, 2)", String(shadowedMath()));
observe("shadowed Number.isNaN(1)", String(shadowedNumber()));
observe("control Object.is(1, 2)", String(Object.is(1, 2)));
observe("control Math.max(1, 2)", String(Math.max(1, 2)));
observe("control Number.isNaN(1)", String(Number.isNaN(1)));
done();
