// expect: a call of a function value in a program with no closures
//
// **This fixture was `blockers/promise-with-resolvers` and has outlived its
// vehicle twice.** It began as ``a property `cap` of unrepresentable type
// (`PromiseWithResolvers`)`` -- 292 of `fs`'s 2,078 refusals were that one type,
// the largest single blocker in the module -- and moved down its own chain when
// `decompose.rs` carried the type across the library boundary. On 2026-09-16 it
// moved again: `PromiseWithResolvers<T>` is now *represented as* `Promise<T>`,
// so `this.cap.resolve()` is a settle and the old program compiles outright.
// `blockers-check.mjs` reported it as FIXED, which is the mechanism working.
//
// What it was actually about is untouched, so the program is now the smallest
// thing that reaches it rather than the thing that historically did.
//
// # The gap
//
// A call of a function value held in a field. The closure call path is what a
// function value is called through, and it is not built for a program that has
// none of its own -- so a program whose only function values arrive from a
// field's declared type falls between the two.
//
// The condition in the message is the real one rather than a coincidence of
// this program -- **measured, not predicted**. Adding a single unrelated
// closure
//
//     export function withAClosure(n: number): number {
//       const add = (v: number): number => v + 1;
//       return add(n & 3);
//     }
//
// does not merely change the refusal, it **removes it**: the file compiles.
// So nothing is wrong with the call, the field, or the type. What is missing is
// the closure call path, which this program never causes to be built.
//
// The capability half of the old subject is
// `blockers/a-promise-capability-taken-as-a-value`, which is the five sites in
// `runtime/node` that store `pending.resolve` rather than calling it.
export class Holder {
  fn: (() => void) | null = null;

  run(): void {
    if (this.fn !== null) {
      this.fn();
    }
  }
}
