// invalid HIR: `FellThrough { func: "pick", block: BlockId(2) }`. A function
// that returns a value on one path and falls off its end on another -- its
// return type `number | undefined`, inferred or declared -- has no `undefined`
// produced at the end, so the block falls through and `emit-c` writes nothing
// for the whole program. Strings and loops alike. The runtime never meets it
// because its sources return explicitly; test262 is JavaScript and does: four
// for-in/return files (an IIFE whose loop body always returns).
//
// One fact with `a-bare-return-in-a-function-returning-a-union` -- no
// `undefined` produced at an erased union -- at two sites: the compiler lane's
// fix for the bare `return;` did not reach this one. `close_body`'s comment
// said falling off such a function "cannot happen: TypeScript rejects" it,
// which holds only for a *declared* type excluding `undefined`; an inferred
// one is made `| undefined` by exactly this. And the case is not only one that
// fails to build: a valueless return left a `prepare` pass free to narrow the
// function's result from `erased` to `f64` and delete its `erase`, a silent
// miscompile that `verify` alone stood in front of.
//
// Control, measured as compiling: the same function ending `return
// undefined;`. Not an arm here because invalid HIR costs the whole program.
function pick(c: boolean) {
  if (c) return 42;
}
observe("taken", String(pick(true)));
observe("fell off", String(pick(false)));
done();
