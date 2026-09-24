// **Lowers as of 2026-09-24**, and kept for its matrix: the four spellings below
// are what said the cause was neither recursion, nor the arrow, nor the `const`,
// but the three together in a function body. `examples/closure-capturing-itself`
// carries the fix's account; this one carries the reduction that aimed it.
//
// A recursive arrow bound to a `const` **inside a function body**. The same
// arrow at module scope compiles, and so does every `function` spelling of it.
//
//     const down = … down(n - 1)   inside a function body   refuses
//     const down = … down(n - 1)   at module scope          compiles
//     function down(n) { … down(n - 1) }  nested            compiles
//     function down(n) { … down(n - 1) }  at module scope   compiles
//
// So it is not recursion, not the arrow, and not the `const`. It is the three
// together in a function body, and the message is about capture order: the
// arrow's body names `down` while the binding it names has no value yet.
//
// In JavaScript that is fine, because the name is read when the arrow is
// *called* and not when it is written. `let x = () => x` is legal and useful,
// and the scope makes no difference to it.
//
// # The fourth of its kind today
//
// This is the fourth construct found this day where **one spelling compiles and
// another spelling of the same thing does not**:
//
//     await  compiles          .then / .catch / .finally    refuse
//     a method compiles        the identical getter          refuses
//     an interface property compiles   the same member in method syntax  refuses
//     a recursive arrow at module scope compiles   the same inside a function  refuses
//
// Each is a smaller piece of work than the diagnostic suggests and a more
// confusing one to meet, because the thing the message describes is present and
// working a few lines away.
//
// Found by a sweep of statement forms asking whether recursion to a depth of
// 100 agrees with node. It does not get that far.

// The matrix above was four lines of comment and **one** exported arm taking no
// argument, so `nts check` drove a single case whose answer did not depend on
// any input. All four spellings are arms now, each taking the depth, so a
// disagreement between them is a compared case rather than a paragraph.
//
// `n & 7` bounds the depth: unbounded, this recursion segfaults on a driver
// input large enough, where node throws a catchable `RangeError`. That is the
// deep-recursion gap and not what this example is about.

/** Under test: a recursive arrow bound to a `const` inside a function body. */
export function insideAFunction(n: number): number {
  const down = (k: number): number => (k <= 0 ? 0 : 1 + down(k - 1));
  return down(n & 7);
}

const downAtModuleScope = (k: number): number =>
  k <= 0 ? 0 : 1 + downAtModuleScope(k - 1);

/** Control: the same arrow at module scope, which always compiled. */
export function atModuleScope(n: number): number {
  return downAtModuleScope(n & 7);
}

/** Control: a nested `function` declaration, hoisted, which always compiled. */
export function nestedDeclaration(n: number): number {
  function down(k: number): number {
    return k <= 0 ? 0 : 1 + down(k - 1);
  }
  return down(n & 7);
}

function downAsAModuleFunction(k: number): number {
  return k <= 0 ? 0 : 1 + downAsAModuleFunction(k - 1);
}

/** Control: a module-scope `function` declaration, the fourth spelling. */
export function moduleDeclaration(n: number): number {
  return downAsAModuleFunction(n & 7);
}
