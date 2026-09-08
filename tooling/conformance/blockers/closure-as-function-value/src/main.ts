// expect: emit-c --napi -> fails-to-compile incompatible pointer types assigning
//
// **The expectation names a clang error, not a string in `program.c`.** It said
// `emits-c <text>` and that is a substring match: a fragment taken from broken
// output can also occur in correct output, and this one did. It reported
// `reproduces` after the defect was fixed, and would have gone on doing so.
//
// A closure stored in a variable of a *function type* gets two different C
// types, and clang rejects the assignment:
//
//     error: incompatible pointer types assigning to 'NtsObj_Fn__4 *'
//            from 'NtsObj_Closure0 *'
//
// The variable is emitted as the structural function type `NtsObj_Fn__4`, the
// arrow assigned to it as `NtsObj_Closure0`, and nothing relates them. Both are
// correct descriptions of the same value: one names the type the declaration
// gives, the other names the object the expression makes.
//
// The named type alias is load-bearing. `let stored: Drain | undefined` is what
// produces the `NtsObj_Fn__` spelling; assigning the same arrow to a `let` with
// an inferred type does not. So this is about a function type being *written
// down* rather than about closures in general, which is why the profile hits it
// where it declares its host contracts and not everywhere it uses a callback.
//
// Reach on the 14:18 probe binary, once `duplicate-type-name` stopped crowding
// the error list: 4 sites in `events`, 4 in `stream`, 3 in `fs`. The second most
// common remaining error in the corpus, behind `erased-truthiness`.
//
// It refuses nothing -- `emit-c` reports success and publishes the wrapper -- so
// the expectation is against the emitted file. `emits-c NtsObj_Fn__` asserts the
// structural spelling is present at all; the day a closure and its declared type
// agree, that name stops being emitted for this shape and the fixture goes loud.

declare function nts_install(a: () => void, b: () => void): void;

type Drain = () => void;

const onTimers: Drain = () => {};
const onImmediates: Drain = () => {};

let stored: Drain | undefined = undefined;

export function install(): void {
  stored = onTimers;
  nts_install(onTimers, onImmediates);
}

export function later(): void {
  if (stored !== undefined) stored();
}
