// **Ours, not upstream's: a placeholder `null as unknown as T`, assigned
// before it is read, ends the program.** React keeps the fiber it is rendering
// in `let currentlyRenderingFiber: Fiber = null as unknown as Fiber;`
// (ReactFiberHooks.ts:306), Flow's `(null: any)` written in TypeScript, and
// assigns a real fiber before any read. Compiled, the module's own
// initialisation stops at the placeholder with "nts: refused: The asserted
// native representation requires a present value", so every native React
// program ends before its first line runs.
//
// Bisected by the React lane (9533b3a5e good, 46168ddfb bad) to e6d7961f2, "a
// lone null erases as null": before it, the lone `null` erased as a present
// reference, which the cast to `Placeholder` then accepted.
//
// The control differs in one thing and agrees: the binding typed
// `Placeholder | null` and initialised with a bare `null`, with no cast. The
// abort ends the program before `done()` reports any observation, so the
// record shows only the abort; the control alone, as its own program, prints
// `root` on both e6d7961f2 and its parent.
//
// **Expected, confirmed under node:**
//
//     cast through unknown          root
//     typed with null (control)     root
class Placeholder {
  readonly name: string = "root";
}

let nullable: Placeholder | null = null;
nullable = new Placeholder();
observe("typed with null (control)", nullable.name);

let cast: Placeholder = null as unknown as Placeholder;
cast = new Placeholder();
observe("cast through unknown", cast.name);
done();
