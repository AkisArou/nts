// expect: a call of a function value in a program with no closures
//
// **The type now represents; this fixture has moved one link down its own
// chain.** It used to refuse with ``a property `cap` of unrepresentable type
// (`PromiseWithResolvers`)``, and the prose below is kept because the reasoning
// that made it the largest blocker in `fs` is what justified carrying the type.
//
// An object with function-valued members as a property type. 292 of `fs`'s
// 2,078 refusals were this one type -- 101 of them bare in
// `web-platform/src/streams/writable.ts` -- which made it the largest single
// blocker in the module by a wide margin. The `| null` form is the same refusal
// wearing a union and reads as "a union of `PromiseWithResolvers` | null";
// that similarity is what made a grouping key normalise the two together.
//
// `PromiseWithResolvers` is now named in `decompose.rs`'s carried list, so the
// library boundary no longer leaves it a placeholder. Measured across the three
// highest-yield modules, the union-typed property refusals roughly halve --
// fs 444 -> 216, stream 329 -> 143, net 287 -> 134 -- and the corpus profile
// moves 21,493 refusals to 19,670.
//
// # What stops it now, which is a different thing
//
// `this.cap.resolve()` is a call of a **function value held in a field**, and
// the refusal names the condition exactly: *in a program with no closures*.
// The closure call path is what a function value is called through, and it is
// not built for a program that has none of its own -- so a program whose only
// function values arrive from a library type falls between the two.
//
// That is a smaller and better-stated gap than the one it replaces, and the
// condition in the message is the real one rather than a coincidence of this
// program -- **measured, not predicted**. Adding a single unrelated closure
//
//     export function withAClosure(n: number): number {
//       const add = (v: number): number => v + 1;
//       return add(n & 3);
//     }
//
// does not merely change the refusal, it **removes it**: the file compiles.
// So nothing is wrong with the call, the field, or the type. What is missing is
// the closure call path, which this program never causes to be built.
export class Holder {
  cap: PromiseWithResolvers<void> = Promise.withResolvers<void>();

  settle(): void {
    this.cap.resolve();
  }
}
