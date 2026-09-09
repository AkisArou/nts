// expect: `down`, captured above its own declaration, where it has no value yet
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

export function countDown(): number {
  const down = (n: number): number => (n <= 0 ? 0 : 1 + down(n - 1));
  return down(3);
}
