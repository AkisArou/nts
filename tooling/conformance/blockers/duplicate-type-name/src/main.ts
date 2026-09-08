// expect: emit-c --napi -> once-c struct NtsObj_Context {
//
// **FIXED in ac27dac4-era, kept as a guard.** Emitted exactly once. `emits-c` cannot state this -- it holds for two
// as well, which is the bug -- so the guard is the count.
//
// The filing below is kept because what it argued is why the fix took the
// shape it did.
//
//
// Two distinct interfaces with the same name, in different modules, emit the
// same C struct name — and the second definition is a redefinition:
//
//     program.c:2968  struct NtsObj_Context { ... }
//     program.c:3048  struct NtsObj_Context { ... }
//     error: redefinition of 'NtsObj_Context'
//     error: static assertion failed ... is not the size nts computed
//
// The struct name is derived from the declared name alone, so it collides across
// modules that never import each other. `console` is where this surfaced, and
// `Blob` collides the same way in `fs` — a name common enough that two lanes of
// a runtime will both use it.
//
// **This is the fifth expectation form in `blockers-check.mjs` and it needed a
// new one**, because the defect is a *count* rather than a presence. `emits-c
// struct NtsObj_Context {` is true of a correct compiler as well — one
// definition is what it should emit — so the fixture would pass after the fix
// and prove nothing. `duplicates-c` asserts the text appears more than once.
//
// Found after the void-field fix, which was masking it: these modules failed on
// `field has incomplete type` first, in the same file.
import { useAlpha, type Context as AlphaContext } from "./alpha.ts";
import { useBeta, type Context as BetaContext } from "./beta.ts";

export function run(): string {
  const a: AlphaContext = { alpha: "a" };
  const b: BetaContext = { beta: 2 };
  return useAlpha(a) + useBeta(b).toString();
}
